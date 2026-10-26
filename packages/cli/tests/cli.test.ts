import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCLI } from '../src/cli.js';

const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', ...args], { encoding: 'utf8' });

test('CLI exposes login and documented options', () => {
  const command = createCLI().commands.find(command => command.name() === 'login');
  assert.ok(command);
  assert.ok(command.options.some(option => option.long === '--no-browser'));
  assert.ok(command.options.some(option => option.long === '--cache-dir'));
});

test('help succeeds without logging in', () => {
  const result = run('login', '--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--no-verbose/);
  assert.equal(result.stderr, '');
});

test('missing URL fails with no token on stdout', () => {
  const result = run('login');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /provide an application URL/);
});
