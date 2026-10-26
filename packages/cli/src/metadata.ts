import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { request } from './http.js';
import type { AppInfo, LoginOptions, MetadataClaims } from './types.js';

const suffix = '.cloudflareaccess.com';
const cacheAge = 24 * 60 * 60 * 1000;
const refreshInterval = 60 * 1000;

export function validateAuthDomain(value: string): string {
  if (!value || value.includes('@') || value.includes('/') || value.includes('\\')) throw new Error('invalid Access auth domain');
  const host = value.toLowerCase().replace(/\.$/, '');
  if (host.includes(':') || !host.endsWith(suffix) || host === suffix.slice(1) || !/^[a-z0-9.-]+$/.test(host)) throw new Error('auth domain must be a Cloudflare Access domain');
  return host;
}

function cachePath(dir: string, host: string): string {
  return join(dir, `${createHash('sha256').update(host).digest('hex')}.jwks.json`);
}

async function fetchKeys(host: string, options: LoginOptions): Promise<JWK[]> {
  const dir = options.cacheDir ?? join(homedir(), '.cf-access');
  const path = cachePath(dir, host);
  const response = await request(`https://${host}/cdn-cgi/access/certs`, { method: 'GET' }, options);
  if (!response.ok) throw new Error(`JWKS request returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 1_048_576) throw new Error('JWKS response too large');
  const parsed = JSON.parse(text) as { keys?: JWK[] };
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) throw new Error('invalid JWKS response');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(parsed), { mode: 0o600 });
  await rename(temp, path);
  return parsed.keys;
}

async function getKeys(host: string, options: LoginOptions): Promise<JWK[]> {
  const dir = options.cacheDir ?? join(homedir(), '.cf-access');
  const path = cachePath(dir, host);
  try {
    const metadata = await stat(path);
    if (Date.now() - metadata.mtimeMs < cacheAge) {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { keys?: JWK[] };
      if (Array.isArray(parsed.keys)) return parsed.keys;
    }
  } catch { /* cache miss */ }
  return fetchKeys(host, options);
}

export async function discoverApp(input: URL, options: LoginOptions): Promise<AppInfo> {
  const response = await request(input, { method: 'HEAD', headers: { 'cf-access-metadata-request': 'true' } }, options, 7000);
  const raw = response.headers.get('cf-access-metadata');
  if (!raw) throw new Error(`no Access metadata returned for ${input.hostname}`);
  const header = decodeProtectedHeader(raw);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('metadata JWT must use RS256 with a key id');
  let unverified: MetadataClaims;
  try { unverified = JSON.parse(Buffer.from(raw.split('.')[1]!, 'base64url').toString('utf8')) as MetadataClaims; }
  catch { throw new Error('invalid metadata JWT payload'); }
  const authDomain = validateAuthDomain(unverified.auth_domain);
  const keys = await getKeys(authDomain, options);
  const verifyWith = async (set: JWK[]): Promise<MetadataClaims> => {
    const candidates = set.filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256'));
    if (candidates.length !== 1) throw new Error('metadata signing key is missing or ambiguous');
    const key = await importJWK(candidates[0]!, 'RS256');
    const { payload } = await jwtVerify(raw, key, { algorithms: ['RS256'] });
    return payload as unknown as MetadataClaims;
  };
  let claims: MetadataClaims;
  try { claims = await verifyWith(keys); }
  catch (error) {
    const file = cachePath(options.cacheDir ?? join(homedir(), '.cf-access'), authDomain);
    let cachedAt: number | undefined;
    try { cachedAt = (await stat(file)).mtimeMs; } catch { /* keys fetched this call or no cache */ }
    if (cachedAt === undefined || Date.now() - cachedAt < refreshInterval) throw error;
    const fresh = await fetchKeys(authDomain, options);
    claims = await verifyWith(fresh);
  }
  if (claims.type !== 'match' || claims.hostname?.toLowerCase() !== input.hostname.toLowerCase() || typeof claims.aud !== 'string' || !claims.aud) throw new Error('metadata does not match requested application');
  if (!Number.isFinite(claims.iat) || claims.iat <= 0) throw new Error('metadata JWT iat is missing or invalid');
  const issuedAt = claims.iat * 1000;
  if (issuedAt < Date.now() - cacheAge) throw new Error('metadata JWT is older than 24h');
  if (issuedAt > Date.now() + 300_000) throw new Error('metadata JWT is more than 5m in the future');
  return { authDomain, appAud: claims.aud, appHostname: claims.app_hostname || claims.hostname };
}
