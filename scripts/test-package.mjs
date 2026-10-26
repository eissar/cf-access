import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const scratch = await mkdtemp(join(tmpdir(), 'cf-access-package-'));
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  run('pnpm', ['build']);
  const packOutput = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', scratch]));
  const packed = Array.isArray(packOutput) ? packOutput[0] : Object.values(packOutput)[0];
  const archive = join(scratch, packed.filename);
  const paths = packed.files.map(file => file.path);
  assert.ok(paths.includes('bin/cf-access.js'));
  assert.ok(paths.includes('bin/scripts/credman.ps1'));
  assert.ok(paths.includes('bin/licenses/cross-keychain.txt'));
  assert.ok(!paths.some(path => path.startsWith('node_modules/') || path.startsWith('patches/')));
  const unpacked = join(scratch, 'unpacked');
  await mkdir(unpacked);
  run('tar', ['-xzf', archive, '-C', unpacked]);
  const repository = join(unpacked, 'package');
  const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies?.['cross-keychain'], undefined);
  assert.equal(manifest.dependencies?.['@napi-rs/keyring'], undefined);
  assert.equal(manifest.optionalDependencies?.['@napi-rs/keyring'], undefined);
  const bundle = await readFile(join(repository, 'bin/cf-access.js'), 'utf8');
  assert.doesNotMatch(bundle, /import\(["']@napi-rs\/keyring["']\)/);
  for (const dependency of Object.values({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    assert.ok(!/^(?:github:|git[+:]|file:|link:|https?:)/.test(dependency));
  }
  // Exercise a Git install as well as a tarball install, without publishing anything.
  run('git', ['init', '-b', 'main'], repository);
  run('git', ['add', '.'], repository);
  run('git', ['-c', 'user.name=Package Test', '-c', 'user.email=package-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Package smoke test'], repository);
  const revision = run('git', ['rev-parse', 'HEAD'], repository).trim();
  for (const [name, dependency] of [['tarball', archive], ['git', `git+file://${repository}#${revision}`]]) {
    const consumer = join(scratch, name);
    await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), '{"private":true}');
    await writeFile(join(consumer, 'pnpm-workspace.yaml'), 'blockExoticSubdeps: true\n');
    run('pnpm', ['add', dependency], consumer);
    const help = run('pnpm', ['exec', 'cf-access'], consumer);
    assert.match(help, /Usage: cf-access/);
    assert.match(run('pnpm', ['exec', 'cf-access', 'login', '--help'], consumer), /--cache-dir/);
    assert.match(run('pnpm', ['exec', 'cf-access', 'status', '--help'], consumer), /--app/);
    const executable = join(consumer, 'node_modules/cf-access/bin/cf-access.js');
    assert.match(run(process.execPath, [executable, '--version'], consumer), /0\.1\.0/);
    console.log(`${name} consumer install with blockExoticSubdeps=true: passed`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
