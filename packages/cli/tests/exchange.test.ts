import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { exportJWK, SignJWT } from 'jose';
import { login } from '../src/client.js';
import { tokenAccount } from '../src/cache.js';
import { MemoryTokenStore } from './store.js';

test('exchanges an organization credential from the keychain without a transfer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-access-exchange-'));
  const tokenStore = new MemoryTokenStore();
  const jwt = (aud: string) => `e30.${Buffer.from(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  const org = jwt('organization');
  const app = jwt('aud');
  await tokenStore.set(tokenAccount('org', 'team.cloudflareaccess.com'), org);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...await exportJWK(publicKey), kid: 'key', alg: 'RS256' };
  const metadata = await new SignJWT({ type: 'match', hostname: 'app.example.test', auth_domain: 'team.cloudflareaccess.com', aud: 'aud' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key' }).setIssuedAt().sign(privateKey);
  let exchanges = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    if (headers.get('cf-access-metadata-request') === 'true') {
      return new Response(null, { headers: { 'cf-access-metadata': metadata } });
    }
    if (url.pathname === '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    if (url.hostname === 'app.example.test' && init?.method === 'HEAD') {
      return new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/app' } });
    }
    if (url.pathname === '/cdn-cgi/access/login/app') {
      assert.equal(headers.get('cookie'), `CF_Authorization=${org}`);
      return new Response(null, { status: 302, headers: { location: '/cdn-cgi/access/authorized', 'set-cookie': 'CF_AppSession=session-id; Secure; HttpOnly' } });
    }
    if (url.pathname === '/cdn-cgi/access/authorized') {
      assert.equal(headers.get('cookie'), 'CF_AppSession=session-id');
      exchanges++;
      return new Response(null, { headers: { 'set-cookie': `CF_Authorization=${app}; Secure; HttpOnly` } });
    }
    if (url.searchParams.get('cloudflared_token_check') === 'true') {
      assert.equal(headers.get('cf-access-token'), app);
      return new Response(null);
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    assert.equal(await login('app.example.test', { cacheDir: dir, tokenStore, fetch: fetcher }), app);
    assert.equal(exchanges, 1);
    assert.equal(await tokenStore.get(tokenAccount('app', 'app.example.test\naud')), app);
    assert.ok((await readdir(dir)).every(name => name.endsWith('.jwks.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
