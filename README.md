# cf-access

TypeScript implementation of `cloudflared access login <url>`, for Node.js 22+ and pnpm. Repository structure follows [eissar/deepwiki](https://github.com/eissar/deepwiki): a root CLI shim in `bin/`, implementation and tests in `packages/cli/`.

## Run

```sh
pnpm install
pnpm cf-access login https://app.example.com
pnpm cf-access login app.example.com --no-verbose
pnpm cf-access login --app https://app.example.com --no-browser
```

For the compiled entry point:

```sh
pnpm build
node bin/cf-access.js login https://app.example.com
```

Login instructions go to stderr. By default stdout contains a success message and JWT; `--no-verbose` or `--app` prints just the JWT. `--quiet` suppresses token output, not authentication instructions.

Options: `--cache-dir <path>`, `--no-browser`, `--auto-close`, `--fedramp`. SIGINT/SIGTERM abort pending network requests. Browser opening uses argument-based OS commands without shell interpolation.

## Authentication flow

1. Normalize the application URL to HTTPS and request signed Access metadata.
2. Verify the RS256 metadata signature against the auth domain's JWKS; validate hostname, audience, type, and issuance time. Auth domains must end in `.cloudflareaccess.com`.
3. Try a cached application token, then exchange a cached organization token using Access redirects.
4. Otherwise generate an ephemeral NaCl box keypair, open the application's `/cdn-cgi/access/cli` endpoint, and long-poll the transfer relay.
5. Decrypt and cache the returned credentials, then check the application token at the edge. Recover from an Access login redirect by acquiring another token.
6. Print the application JWT.

FedRAMP auth domains automatically select the FedRAMP transfer relay.

## Cache and security

Credentials are **plaintext secrets** stored under `~/.cf-access` by default, with hashed filenames, directory mode `0700`, and file mode `0600` on POSIX. Protect the cache and stdout; do not commit tokens. Windows filesystem permissions depend on the user's ACLs.

This cache and lock format is intentionally separate from cloudflared's. Token writes use temporary files and rename; application locks use exclusive creation and a ten-minute stale timeout. Unlike cloudflared, locks do not detect dead processes immediately, share active login URLs, or serialize organization-token acquisition across applications.

Cached application JWTs are checked for expiry/audience, **not locally signature-verified**; acceptance is tested at the Cloudflare edge. As in cloudflared, the edge test detects a 302 to the Access login path rather than requiring HTTP 200.

Organization-token exchange permits redirects only to the original application origin and verified authentication origin. This is deliberately narrower than cloudflared's redirect policy. Custom request headers/service-token CLI flags, SSH/TCP, tunnel login and origin certificates are out of scope.

## Library

`packages/cli/src/client.ts` exports:

```ts
import { login } from './packages/cli/src/client.js';

const token = await login('https://app.example.com', {
  noBrowser: true,
  onMessage: message => console.error(message),
});
```

The CLI supplies the platform browser launcher. Library callers must supply `openBrowser` to launch a browser, or display authentication URLs through `onMessage`. Options also support `cacheDir`, `signal`, `autoClose`, `fedramp`, and injectable `fetch`.

## Development

```sh
pnpm typecheck
pnpm test
pnpm build
```

Offline tests use RSA-signed metadata, mocked HTTP responses, and actual NaCl encryption/decryption. **Live Cloudflare/IdP compatibility has not been tested.** Protocol reference: cloudflare/cloudflared revision `8cc81c7fcc524a2b1ebec51506685180652ea25d`; this is an independent port, not an official Cloudflare client.
