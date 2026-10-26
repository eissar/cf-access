import { discoverApp, validateAuthDomain } from './metadata.js';
import { readToken, tokenPath, validToken, withLock, writeToken } from './cache.js';
import { message, request } from './http.js';
import { transfer } from './transfer.js';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LoginOptions } from './types.js';

export type { LoginOptions } from './types.js';

export function normalizeURL(input: string): URL {
  let value = input.trim();
  if (!value) throw new Error('application URL is required');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw new Error('application URL must use HTTP or HTTPS');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('application URL must use HTTP or HTTPS');
  url.protocol = 'https:';
  url.hash = '';
  if (url.username || url.password || !url.hostname) throw new Error('invalid application URL');
  return url;
}

async function tokenAccepted(appUrl: URL, token: string, options: LoginOptions): Promise<boolean> {
  const target = new URL(appUrl);
  target.searchParams.set('cloudflared_token_check', 'true');
  const response = await request(target, { method: 'GET', headers: { 'Cf-Access-Token': token } }, options, 5000);
  await response.body?.cancel();
  if (response.status !== 302) return true;
  const location = response.headers.get('location');
  if (!location) return true;
  try {
    const login = new URL(location, target);
    return !(login.pathname === '/cdn-cgi/access/login' || login.pathname.startsWith('/cdn-cgi/access/login/'));
  }
  catch { return false; }
}

async function exchange(appUrl: URL, orgToken: string, audience: string, authDomain: string, options: LoginOptions): Promise<string | undefined> {
  const base = new URL(appUrl);
  let current = base;
  let session = '';
  for (let i = 0; i < 10; i++) {
    const headers = new Headers({ 'user-agent': 'cloudflared-cli' });
    if (current.pathname.includes('/cdn-cgi/access/login')) headers.set('cookie', `CF_Authorization=${orgToken}`);
    if (current.pathname.includes('/cdn-cgi/access/authorized')) {
      if (session) headers.set('cookie', `CF_AppSession=${session}`);
    }
    const response = await request(current, { method: 'HEAD', headers }, options, 7000);
    const cookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
    for (const cookie of cookies) {
      const match = /^CF_AppSession=([^;]+)/i.exec(cookie);
      if (match) session = match[1]!;
      const token = /^CF_Authorization=([^;]+)/i.exec(cookie);
      if (token && validToken(token[1]!, audience)) {
        const claims = token[1]!.split('.')[1];
        try {
          const payload = JSON.parse(Buffer.from(claims!, 'base64url').toString('utf8')) as { aud?: string | string[] };
          if ((Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(audience)) return token[1];
        } catch { /* invalid cookie token */ }
      }
    }
    if (current.pathname.includes('/cdn-cgi/access/authorized')) return undefined;
    const location = response.headers.get('location');
    const next = location ? new URL(location, current) : undefined;
    if (!next && response.status >= 300 && response.status < 400) return undefined;
    if (response.status < 300 || response.status >= 400 || !next) return undefined;
    const redirect = next;
    const allowedHost = redirect.origin === appUrl.origin || redirect.origin === `https://${authDomain}`;
    if (!allowedHost || redirect.protocol !== 'https:') return undefined;
    current = redirect;
  }
  return undefined;
}

export async function login(input: string, options: LoginOptions = {}): Promise<string> {
  const appUrl = normalizeURL(input);
  const info = await discoverApp(appUrl, options);
  // Revalidate even though metadata verification already enforces it before using the value in URLs/cache names.
  info.authDomain = validateAuthDomain(info.authDomain);
  const dir = options.cacheDir ?? join(homedir(), '.cf-access');
  const appPath = tokenPath(dir, 'app', `${info.appHostname}\n${info.appAud}`);
  const orgPath = tokenPath(dir, 'org', info.authDomain);
  const cached = await readToken(appPath, info.appAud);
  if (cached && await tokenAccepted(appUrl, cached, options)) return cached;
  if (cached) await rm(appPath, { force: true });
  return withLock(appPath, options.signal, async () => {
    const second = await readToken(appPath, info.appAud);
    if (second && await tokenAccepted(appUrl, second, options)) return second;
    if (second) await rm(appPath, { force: true });
    const org = await readToken(orgPath);
    if (org) {
      const exchanged = await exchange(appUrl, org, info.appAud, info.authDomain, options).catch(() => undefined);
      if (exchanged && await tokenAccepted(appUrl, exchanged, options)) {
        await writeToken(appPath, exchanged);
        return exchanged;
      }
    }
    message(options, 'Starting Cloudflare Access browser login…');
    const tokens = await transfer(appUrl, info.appAud, { ...options, fedramp: options.fedramp || info.authDomain.endsWith('.fed.cloudflareaccess.com') });
    if (!validToken(tokens.app_token, info.appAud)) throw new Error('received app token is expired or has an unexpected audience');
    if (!validToken(tokens.org_token)) throw new Error('received organization token is expired');
    await writeToken(orgPath, tokens.org_token);
    await writeToken(appPath, tokens.app_token);
    if (await tokenAccepted(appUrl, tokens.app_token, options)) return tokens.app_token;
    await rm(appPath, { force: true });
    const retry = await transfer(appUrl, info.appAud, { ...options, fedramp: options.fedramp || info.authDomain.endsWith('.fed.cloudflareaccess.com') });
    if (!validToken(retry.app_token, info.appAud)) throw new Error('received app token is expired or has an unexpected audience');
    if (!await tokenAccepted(appUrl, retry.app_token, options)) throw new Error('failed to verify token at application edge');
    if (!validToken(retry.org_token)) throw new Error('received organization token is expired');
    await writeToken(orgPath, retry.org_token);
    await writeToken(appPath, retry.app_token);
    return retry.app_token;
  });
}
