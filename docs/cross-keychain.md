# cross-keychain dependency provenance

- Repository: https://github.com/magarcia/cross-keychain
- Commit: `38d1f8fec281e18a6838706906835cbb0965b1ba`
- Package version at this commit: `1.1.0`
- License: MIT (included in the installed upstream package)
- Dependency specifier: `github:magarcia/cross-keychain#38d1f8fec281e18a6838706906835cbb0965b1ba`

## Why the patch exists

The commit's package exports refer to `dist/`, which is not committed. Its
`prepare` script runs Husky, not the build. Its `files` allowlist excludes
`src/` from the installed package. A plain Git dependency installs successfully
but cannot be imported.

The pnpm patch adds the output of the upstream Rollup build: ESM/CommonJS
bundles, declarations, source maps, CLI, and the Windows PowerShell helper.
It does not alter upstream source or credential behavior. The application uses
the ESM library API, not the dependency's CLI.

## Regenerate

Requires Git, npm, and the project's pinned pnpm. Review upstream lifecycle
scripts before allowing any build; building a dependency executes code.

```sh
git clone https://github.com/magarcia/cross-keychain.git /tmp/cross-keychain-build
git -C /tmp/cross-keychain-build checkout --detach 38d1f8fec281e18a6838706906835cbb0965b1ba
npm --prefix /tmp/cross-keychain-build ci --ignore-scripts --no-audit --no-fund
npm --prefix /tmp/cross-keychain-build run build

# Run these from the cf-access repository.
pnpm patch cross-keychain@1.1.0 --edit-dir /tmp/cross-keychain-patch
cp -r /tmp/cross-keychain-build/dist/. /tmp/cross-keychain-patch/dist/
pnpm patch-commit /tmp/cross-keychain-patch
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Use fresh temporary directories. When initially generating a patch from an
unpatched install, create the destination `dist/` before copying. The workspace
allowlist permits the Git dependency's prepare lifecycle only for the exact
pinned tarball URL. Optional native bindings remain platform-specific.

## Storage policy

The adapter captures cross-keychain's selected backend and accepts only these
IDs: `native-macos`, `native-windows`, `native-linux`, `macos`, `windows`,
`secret-service`. It rejects `file`, `null`, and unknown backend IDs before
performing credential operations.

This restriction applies to the default store. Library callers supplying their
own `TokenStore` are responsible for its security and persistence semantics.
Public JWKS and process locks remain filesystem-based.

Cross-keychain's own backend discovery/configuration can inspect files and load
native modules. OS credential stores may prompt for access and need an active
user session. No token is silently written to a file if access fails.
