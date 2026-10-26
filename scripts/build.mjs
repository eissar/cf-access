import { build } from 'esbuild';
import { chmod, copyFile, mkdir } from 'node:fs/promises';

await build({
  entryPoints: ['packages/cli/src/index.ts'],
  outfile: 'bin/cf-access.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Preserve the vendored upstream files, but disable their optional native
  // imports in the bundle, even if a consumer has the bindings installed.
  plugins: [{
    name: 'disable-native-keyring',
    setup(build) {
      build.onResolve({ filter: /^@napi-rs\/keyring$/ }, () => ({ path: 'disabled-native-keyring', namespace: 'cf-access' }));
      build.onLoad({ filter: /.*/, namespace: 'cf-access' }, () => ({
        contents: 'throw new Error("Native keyring bindings are disabled in cf-access"); export {};',
        loader: 'js',
      }));
    },
  }],
  // tweetnacl's optional Node crypto access uses CommonJS require.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: 'inline',
});
await chmod('bin/cf-access.js', 0o755);
// Upstream locates this helper relative to import.meta.url, now inside bin/.
await mkdir('bin/scripts', { recursive: true });
await copyFile('vendor/cross-keychain/scripts/credman.ps1', 'bin/scripts/credman.ps1');
await mkdir('bin/licenses', { recursive: true });
for (const [source, destination] of [
  ['vendor/cross-keychain/LICENSE', 'cross-keychain.txt'],
  ['node_modules/commander/LICENSE', 'commander.txt'],
  ['node_modules/jose/LICENSE.md', 'jose.txt'],
  ['node_modules/tweetnacl/LICENSE', 'tweetnacl.txt'],
]) {
  await copyFile(source, `bin/licenses/${destination}`);
}
