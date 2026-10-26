import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import nacl from 'tweetnacl';
import { exportJWK, SignJWT } from 'jose';
import { login, normalizeURL } from '../src/client.js';
import { transfer } from '../src/transfer.js';
import { validateAuthDomain } from '../src/metadata.js';
import { tokenClaims, tokenPath, validToken } from '../src/cache.js';

function jwt(payload: object): string {
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

let tokenSequence = 0;
function token(aud: string | string[] = 'app-aud'): string {
  return jwt({ exp: Math.floor(Date.now() / 1000) + 3600, aud, n: ++tokenSequence });
}

test('normalizes bare hosts and rejects malformed URLs', () => {
  assert.equal(normalizeURL('example.com/path').href, 'https://example.com/path');
  assert.equal(normalizeURL('http://example.com/path').href, 'https://example.com/path');
  assert.throws(() => normalizeURL('https://user:pass@example.com'));
  assert.throws(() => normalizeURL('javascript:alert(1)'));
  assert.throws(() => normalizeURL('ftp://example.com'));
});

test('auth domain allows only canonical Cloudflare Access suffix', () => {
  assert.equal(validateAuthDomain('TEAM.cloudflareaccess.com'), 'team.cloudflareaccess.com');
  assert.throws(() => validateAuthDomain('cloudflareaccess.com.evil.test'));
  assert.throws(() => validateAuthDomain('evil.test/path.cloudflareaccess.com'));
});

test('local token parsing validates expiry and audience without asserting signature', () => {
  const value = token(['app-aud']);
  assert.deepEqual(tokenClaims(value)?.aud, ['app-aud']);
  assert.equal(validToken(value, 'app-aud'), true);
  assert.equal(validToken(value, 'other'), false);
  assert.equal(validToken(jwt({ exp: 1, aud: 'app-aud' }), 'app-aud'), false);
  assert.equal(validToken('not-a-token'), false);
});

test('verifies signed metadata and decrypts padded-base64 nacl transfer response', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-access-core-'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'metadata-key'; jwk.alg = 'RS256';
  const metadata = await new SignJWT({ type: 'match', hostname: 'app.example.test', auth_domain: 'team.cloudflareaccess.com', aud: 'app-aud', app_hostname: 'app.example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'metadata-key' }).setIssuedAt().sign(privateKey);
  const server = nacl.box.keyPair();
  let browserUrl = '';
  let transferMessages = 0;
  let pollCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === 'app.example.test' && init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'cf-access-metadata': metadata } });
    if (url.hostname === 'app.example.test' && init?.method === 'GET') return new Response(null, { status: 200 });
    if (url.hostname === 'team.cloudflareaccess.com') return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'app.example.test' && url.pathname === '/cdn-cgi/access/cli') return new Response(null, { status: 200 });
    if (url.hostname === 'app.example.test' && url.pathname === '/start') return new Response(null, { status: 200 });
    if (url.hostname === 'app.example.test' && url.searchParams.has('cloudflared_token_check')) return new Response(null, { status: 200 });
    if (url.hostname === 'login.cloudflareaccess.org') {
      pollCount++;
      const key = url.pathname.split('/').pop()!;
      const clientPub = new Uint8Array(Buffer.from(key, 'base64url'));
      const nonce = new Uint8Array(nacl.box.nonceLength).fill(7);
      const body = Buffer.from(JSON.stringify({ app_token: token('app-aud'), org_token: token('org-aud') }));
      const encrypted = nacl.box(new Uint8Array(body), nonce, clientPub, server.secretKey);
      const responseBody = Buffer.concat([Buffer.from(nonce), Buffer.from(encrypted)]).toString('base64');
      return new Response(responseBody, { status: 200, headers: { 'service-public-key': Buffer.from(server.publicKey).toString('base64url') } });
    }
    throw new Error(`unexpected request ${init?.method} ${url}`);
  };
  try {
    const result = await login('https://app.example.test/start?existing=keep', { cacheDir: dir, fetch: fetcher, onMessage: message => { if (message.startsWith('Open this URL')) browserUrl = message.split('\n')[1]!; } });
    assert.equal(validToken(result, 'app-aud'), true);
    assert.equal(pollCount, 1);
    const landing = new URL(browserUrl);
    assert.equal(landing.pathname, '/cdn-cgi/access/cli');
    assert.equal(landing.searchParams.get('token')?.length, 44);
    assert.equal(landing.searchParams.get('token')?.endsWith('='), true);
    const redirect = new URL(landing.searchParams.get('redirect_url')!);
    assert.equal(redirect.searchParams.get('existing'), 'keep');
    assert.equal(redirect.searchParams.get('token'), landing.searchParams.get('token'));
    assert.equal(landing.searchParams.get('token'), redirect.searchParams.get('token'));
    assert.equal((await readFile(tokenPath(dir, 'org', 'team.cloudflareaccess.com'), 'utf8')).trim().length > 0, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects cached token at edge, removes it, and retries browser transfer once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-access-retry-'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey); jwk.kid = 'key'; jwk.alg = 'RS256';
  const metadata = await new SignJWT({ type: 'match', hostname: 'app.example.test', auth_domain: 'team.cloudflareaccess.com', aud: 'app-aud' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key' }).setIssuedAt().sign(privateKey);
  const appPath = tokenPath(dir, 'app', 'app.example.test\napp-aud');
  const cached = token();
  const { writeToken } = await import('../src/cache.js');
  await writeToken(appPath, cached);
  const server = nacl.box.keyPair();
  let edgeChecks = 0;
  let transferPolls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === 'app.example.test' && init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'cf-access-metadata': metadata } });
    if (url.hostname === 'team.cloudflareaccess.com') return new Response(JSON.stringify({ keys: [jwk] }));
    if (url.hostname === 'app.example.test' && url.searchParams.has('cloudflared_token_check')) {
      edgeChecks++;
      if (edgeChecks === 1) return new Response(null, { status: 302, headers: { location: '/cdn-cgi/access/login/app' } });
      return new Response(null, { status: 200 });
    }
    if (url.hostname === 'app.example.test' && url.pathname === '/cdn-cgi/access/cli') return new Response(null, { status: 200 });
    if (url.hostname === 'login.cloudflareaccess.org') {
      transferPolls++;
      const clientPub = new Uint8Array(Buffer.from(url.pathname.split('/').pop()!, 'base64url'));
      const nonce = new Uint8Array(nacl.box.nonceLength).fill(9);
      const body = new Uint8Array(Buffer.from(JSON.stringify({ app_token: token(), org_token: token('org-aud') })));
      const encrypted = nacl.box(body, nonce, clientPub, server.secretKey);
      return new Response(Buffer.concat([Buffer.from(nonce), Buffer.from(encrypted)]).toString('base64'), { status: 200, headers: { 'service-public-key': Buffer.from(server.publicKey).toString('base64url') } });
    }
    throw new Error(`unexpected request ${init?.method} ${url}`);
  };
  try {
    const result = await login('https://app.example.test/', { cacheDir: dir, fetch: fetcher });
    assert.notEqual(result, cached);
    assert.equal(edgeChecks, 2);
    assert.equal(transferPolls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
