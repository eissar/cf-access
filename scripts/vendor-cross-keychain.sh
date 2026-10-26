#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=38d1f8fec281e18a6838706906835cbb0965b1ba
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git clone https://github.com/magarcia/cross-keychain.git "$scratch/upstream"
git -C "$scratch/upstream" checkout --detach "$revision"
test "$(git -C "$scratch/upstream" rev-parse HEAD)" = "$revision"
npm --prefix "$scratch/upstream" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$scratch/upstream" run build
mkdir -p vendor/cross-keychain/scripts
for file in index.js index.js.map index.d.ts; do
  cp "$scratch/upstream/dist/$file" "vendor/cross-keychain/$file"
done
cp "$scratch/upstream/dist/scripts/credman.ps1" vendor/cross-keychain/scripts/
cp "$scratch/upstream/LICENSE" vendor/cross-keychain/LICENSE
(cd vendor/cross-keychain && sha256sum LICENSE index.js index.js.map index.d.ts scripts/credman.ps1 > SHA256SUMS)
echo "Vendored cross-keychain at $revision; review the diff and run pnpm build."
