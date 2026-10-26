# cf-access

Cloudflare Access login in TypeScript. Requires Node.js 22+ and pnpm.

```sh
npx github:eissar/cf-access login https://app.example.com
npx github:eissar/cf-access status https://app.example.com
```

Open the printed URL manually. Tokens are never printed; they use the OS keychain via [cross-keychain](docs/cross-keychain.md); file/null backends are rejected. Only public JWKS and locks remain on disk. Old `.token` files are not migrated or deleted.

```sh
pnpm install
pnpm cf-access login --help
pnpm typecheck && pnpm test && pnpm test:package
```

`status` checks the keychain without logging in or printing tokens. It needs network access for app discovery; exit 0 means locally valid, 1 means missing/expired/invalid or an error. It does not check edge acceptance.

Independent client; live Cloudflare login and native keychain round-trips are untested.
