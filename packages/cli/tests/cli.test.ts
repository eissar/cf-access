import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCLI } from '../src/cli.js';

const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', ...args], { encoding: 'utf8' });

test('CLI exposes login and documented options', () => {
  const command = createCLI().commands.find(command => command.name() === 'login');
  assert.ok(command);
  assert.equal(command.options.some(option => option.long === '--no-browser'), false);
  assert.ok(command.options.some(option => option.long === '--cache-dir'));
});

test('help succeeds without logging in', () => {
  const result = run('login', '--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--quiet/);
  assert.doesNotMatch(result.stdout, /--print-token|--no-verbose/);
  assert.equal(result.stderr, '');
});

test('no arguments prints help successfully', () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: cf-access/);
  assert.equal(result.stderr, '');
});

for (const args of [
  ['login', 'app.example.com'],
  ['login', '--app', 'app.example.com'],
  ['login', 'app.example.com', '--quiet'],
]) {
  test(`login never prints credentials: ${args.join(' ')}`, async t => {
    const secret = 'SECRET-APPLICATION-JWT';
    let stdout = '';
    let stderr = '';
    t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => { stdout += chunk; return true; });
    t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { stderr += chunk; return true; });
    const cli = createCLI(async () => secret);
    await cli.parseAsync(args, { from: 'user' });
    assert.equal(stdout, '');
    assert.equal(stderr.includes(secret), false);
    assert.equal(stderr, args.includes('--quiet') ? '' : 'Logged in. Credentials stored in the OS keychain.\n');
  });
}

test('missing URL fails with no token on stdout', () => {
  const result = run('login');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /provide an application URL/);
});
