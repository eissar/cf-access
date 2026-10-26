# Vendored cross-keychain

- Repository: https://github.com/magarcia/cross-keychain
- Commit: `38d1f8fec281e18a6838706906835cbb0965b1ba`
- Upstream version: `1.1.0`
- License: MIT; preserved in `vendor/cross-keychain/LICENSE` and the shipped CLI
- Files: upstream ESM library, source map, TypeScript declarations and Windows helper
- Checksums: `vendor/cross-keychain/SHA256SUMS`

## Why vendor?

The requested commit does not ship built files through a Git install. Our prior
Git dependency plus build patch also failed consumer installs with pnpm's
`blockExoticSubdeps`. We now commit the exact upstream build artifacts and bundle
the ESM library into `bin/cf-access.js`. There is no Git dependency, local
dependency, package patch, or install-time build.

The upstream build contains optional imports of `@napi-rs/keyring`, but cf-access
does not depend on or use those bindings. The CLI build replaces those optional
imports with a disabled module, so even a consumer's installed native bindings
cannot be loaded. CLI-only upstream dependencies are not needed.

No upstream credential behavior has been changed. Its Windows PowerShell helper
is copied to `bin/scripts/credman.ps1`, matching the bundled library's
`import.meta.url`-relative lookup. Licenses for bundled dependencies are shipped
in `bin/licenses/`.

## Regenerate

Requires Git, npm, pnpm and a POSIX shell. This executes the pinned upstream
Rollup build; review its build code before running.

```sh
pnpm vendor:keychain
(cd vendor/cross-keychain && sha256sum -c SHA256SUMS)
pnpm build
pnpm typecheck
pnpm test
pnpm test:package
```

`scripts/vendor-cross-keychain.sh` checks out the full commit, installs from its
npm lockfile with lifecycle scripts disabled, runs its build explicitly, copies
the library artifacts and license, and records SHA-256 checksums. Review both the
vendor and generated CLI diffs before committing. The committed CLI lets GitHub
consumers run without installing development dependencies or executing builds.

`pnpm test:package` packs the application and tests isolated tarball and local-Git
consumer installs with `blockExoticSubdeps: true`, including the no-argument help
and login help entry points. These are packaging tests, not live login tests.

## Storage policy

Selection is restricted to cross-keychain's non-native `macos`, `windows`, and
`secret-service` backends. Native, file, null and unknown backend IDs are rejected.
Linux uses `secret-tool` with an active Secret Service daemon, such as GNOME
Keyring or KDE Wallet. On Debian/Ubuntu install `libsecret-tools` if `secret-tool`
is missing. There is no kernel-keyutils or file fallback.

Credentials previously stored by the native backend are not migrated. Log in
again after configuring Secret Service. Public JWKS and process locks remain
filesystem-based.

This policy applies to the default store; callers providing their own
`TokenStore` control its storage semantics. OS keychains can prompt and require
an active user session. The macOS CLI backend can briefly expose secrets through
process arguments. Setting `TS_KEYRING_BACKEND` to a native/file/null backend is
an error, not permission to bypass the restriction.
