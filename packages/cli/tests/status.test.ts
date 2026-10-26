import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, SignJWT } from 'jose';
import { status } from '../src/client.js';
import { tokenAccount } from '../src/cache.js';
import { createCLI } from '../src/cli.js';
import { MemoryTokenStore } from './store.js';

const jwt = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.secret-signature`;

test('status inspects credentials read-only and never attempts login or edge checks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-access-status-'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...await exportJWK(publicKey), kid: 'key', alg: 'RS256' };
  const metadata = await new SignJWT({ type: 'match', hostname: 'app.example.test', auth_domain: 'team.cloudflareaccess.com', aud: 'aud' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key' }).setIssuedAt().sign(privateKey);
  const tokenStore = new MemoryTokenStore();
  const account = tokenAccount('app', 'app.example.test\naud');
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init?.method === 'HEAD' && new Headers(init.headers).get('cf-access-metadata-request') === 'true') {
      return new Response(null, { headers: { 'cf-access-metadata': metadata } });
    }
    if (url.href === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    throw new Error(`status must not request ${url}`);
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cases = [
    { value: null, state: 'missing' },
    { value: jwt({ aud: 'aud', exp }), state: 'valid' },
    { value: jwt({ aud: ['aud'], exp: 1 }), state: 'expired' },
    { value: jwt({ aud: 'wrong', exp }), state: 'invalid' },
    { value: jwt({ aud: 'aud', exp: 1e100 }), state: 'invalid' },
    { value: 'malformed', state: 'invalid' },
  ] as const;
  try {
    for (const entry of cases) {
      tokenStore.values.clear();
      if (entry.value !== null) tokenStore.values.set(account, entry.value);
      const before = [...tokenStore.values];
      const result = await status('app.example.test', { cacheDir: dir, tokenStore, fetch: fetcher });
      assert.equal(result.state, entry.state);
      assert.equal(result.hostname, 'app.example.test');
      assert.deepEqual([...tokenStore.values], before);
      assert.deepEqual(tokenStore.deleted, []);
      assert.equal(JSON.stringify(result).includes('secret-signature'), false);
      if (entry.state === 'valid') assert.equal(result.expiresAt, new Date(exp * 1000).toISOString());
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const state of ['valid', 'missing', 'expired', 'invalid'] as const) {
  test(`status CLI reports ${state} without authenticating or printing tokens`, async t => {
    let output = '';
    const previousExitCode = process.exitCode;
    t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => { output += chunk; return true; });
    try {
      const cli = createCLI(async () => { throw new Error('must not log in'); }, async input => {
        assert.equal(input, 'app.example.test');
        return { hostname: input, state };
      });
      process.exitCode = 0;
      await cli.parseAsync(['status', '--app', 'app.example.test'], { from: 'user' });
      assert.match(output, new RegExp(`application token ${state}`));
      assert.equal(process.exitCode, state === 'valid' ? 0 : 1);
    } finally { process.exitCode = previousExitCode; }
  });
}
