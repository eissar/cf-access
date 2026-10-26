# cf-access

Cloudflare Access login in TypeScript. Requires Node.js 22+ and pnpm.

```sh
npx github:eissar/cf-access login https://app.example.com --no-verbose
```

Open the printed URL manually; the JWT is written to stdout. Tokens use the OS keychain via [cross-keychain](docs/cross-keychain.md); file/null backends are rejected. Only public JWKS and locks remain on disk. Old `.token` files are not migrated or deleted.

```sh
pnpm install
pnpm cf-access login --help
pnpm typecheck && pnpm test && pnpm test:package
```

Independent client; live Cloudflare login and native keychain round-trips are untested.
