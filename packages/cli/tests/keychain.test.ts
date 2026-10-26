import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { KEYCHAIN_SERVICE, keychainTokenStore } from '../src/keychain.js';
import { readToken, tokenAccount, writeToken } from '../src/cache.js';
import { MemoryTokenStore } from './store.js';

const token = (aud = 'aud', exp = Math.floor(Date.now() / 1000) + 3600) =>
  `e30.${Buffer.from(JSON.stringify({ aud, exp })).toString('base64url')}.signature`;

test('vendored artifacts match recorded SHA-256 checksums', async () => {
  const root = new URL('../../../vendor/cross-keychain/', import.meta.url);
  const manifest = await readFile(new URL('SHA256SUMS', root), 'utf8');
  for (const line of manifest.trim().split('\n')) {
    const [expected, path] = line.split('  ');
    assert.ok(expected && path);
    const actual = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    assert.equal(actual, expected, path);
  }
});

test('vendored upstream library is importable', async () => {
  const upstream = await import('../../../vendor/cross-keychain/index.js');
  assert.equal(typeof upstream.getKeyring, 'function');
  assert.equal(typeof upstream.getPassword, 'function');
});

test('adapter namespaces application and organization credentials under cf-access', async () => {
  const values = new Map<string, string>();
  const calls: string[][] = [];
  const store = keychainTokenStore({
    id: 'secret-service',
    async getPassword(service, account) { calls.push(['get', service, account]); return values.get(account) ?? null; },
    async setPassword(service, account, value) { calls.push(['set', service, account]); values.set(account, value); },
    async deletePassword(service, account) { calls.push(['delete', service, account]); values.delete(account); },
  });
  const app = tokenAccount('app', 'app.example.com\naud');
  const org = tokenAccount('org', 'team.cloudflareaccess.com');
  assert.notEqual(app, org);
  assert.match(app, /^app-[a-f0-9]{64}$/);
  await store.set(app, 'application-token');
  await store.set(org, 'organization-token');
  assert.equal(await store.get(app), 'application-token');
  assert.equal(await store.get(org), 'organization-token');
  await store.delete(app);
  await store.delete(app); // missing credentials are a no-op
  assert.equal(await store.get(app), null);
  assert.equal(await store.get(org), 'organization-token');
  assert.ok(calls.every(call => call[1] === KEYCHAIN_SERVICE));
  assert.equal(calls.filter(call => call[0] === 'delete').length, 1);
});

test('native/file/null/unknown backends are rejected before credential operations', () => {
  for (const id of ['native-linux', 'native-macos', 'native-windows', 'file', 'null', 'unknown']) {
    assert.throws(() => keychainTokenStore({
      id,
      async getPassword() { throw new Error('must not be called'); },
      async setPassword() { throw new Error('must not be called'); },
      async deletePassword() { throw new Error('must not be called'); },
    }), /requires a non-native OS keychain/);
  }
});

test('cache preserves valid tokens and removes expired, malformed or wrong-audience credentials', async () => {
  const store = new MemoryTokenStore();
  assert.equal(await readToken(store, 'absent', 'aud'), undefined);
  const valid = token();
  await writeToken(store, 'app', valid);
  assert.equal(await readToken(store, 'app', 'aud'), valid);
  for (const value of [token('other'), token('aud', 1), 'malformed']) {
    await writeToken(store, 'app', value);
    assert.equal(await readToken(store, 'app', 'aud'), undefined);
    assert.equal(await store.get('app'), null);
  }
  assert.equal(store.deleted.length, 3);
});

test('keychain access errors propagate rather than becoming cache misses or disk fallback', async () => {
  const denied = new Error('keychain is locked');
  const store = keychainTokenStore({
    id: 'macos',
    async getPassword() { throw denied; },
    async setPassword() { throw denied; },
    async deletePassword() { throw denied; },
  });
  await assert.rejects(readToken(store, 'app'), error => error === denied);
  await assert.rejects(writeToken(store, 'app', token()), error => error === denied);
  await assert.rejects(store.delete('app'), error => error === denied);
});
