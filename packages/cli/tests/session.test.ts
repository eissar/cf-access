import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSecretServiceSession } from '../src/session.js';
import { login, status } from '../src/client.js';

test('Linux rejects a missing session address without probing or requiring DISPLAY', async () => {
  await assert.rejects(assertSecretServiceSession({
    platform: 'linux', address: '',
    async probe() { throw new Error('must not probe'); },
  }), /DBUS_SESSION_BUS_ADDRESS is missing/);
});

test('Linux accepts a reachable Secret Service without checking DISPLAY', async () => {
  let calls = 0;
  await assertSecretServiceSession({
    platform: 'linux', address: 'unix:path=/test/bus',
    async probe(address) { assert.equal(address, 'unix:path=/test/bus'); calls++; },
  });
  assert.equal(calls, 1);
});

test('unreachable session/service fails clearly without exposing raw probe output', async () => {
  await assert.rejects(assertSecretServiceSession({
    platform: 'linux', address: 'unix:path=/dead/bus',
    async probe() { throw new Error('sensitive raw subprocess output'); },
  }), error => error instanceof Error && error.message.includes('Cannot reach Secret Service') && !error.message.includes('sensitive'));
});

test('missing dbus-send gives an actionable dependency error', async () => {
  await assert.rejects(assertSecretServiceSession({
    platform: 'linux', address: 'unix:path=/test/bus',
    async probe() { throw Object.assign(new Error('missing command'), { code: 'ENOENT' }); },
  }), /install dbus-bin/);
});

test('non-Linux does not require a D-Bus session', async () => {
  for (const platform of ['darwin', 'win32'] as const) {
    await assertSecretServiceSession({
      platform, address: '',
      async probe() { throw new Error('must not probe'); },
    });
  }
});

test('login and status fail before discovery when Linux session address is missing', { skip: process.platform !== 'linux' }, async () => {
  const previous = process.env.DBUS_SESSION_BUS_ADDRESS;
  process.env.DBUS_SESSION_BUS_ADDRESS = '';
  try {
    for (const operation of [login, status]) {
      await assert.rejects(operation('https://app.example.test', {
        fetch: async () => { throw new Error('must not make network requests'); },
      }), /DBUS_SESSION_BUS_ADDRESS is missing/);
    }
  } finally {
    if (previous === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
    else process.env.DBUS_SESSION_BUS_ADDRESS = previous;
  }
});
