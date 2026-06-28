#!/usr/bin/env bash
# Full local release-prep gate. Run this on the release/vX.Y.Z branch before
# opening or merging the release-prep PR.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  printf 'release prep failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 0 ]]; then
  fail "usage: scripts/release-prep.sh"
fi

command -v markdownlint-cli2 >/dev/null 2>&1 || fail "markdownlint-cli2 is required"
command -v actionlint >/dev/null 2>&1 || fail "actionlint is required"

bash scripts/release-profile-check.sh

cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --all --locked
bash scripts/package-witness.sh
cargo build --release --locked
npm --prefix editors/vscode ci
export PATH="$root/editors/vscode/node_modules/.bin:$PATH"
command -v tsc >/dev/null 2>&1 || fail "typescript compiler is required"
bash scripts/ir-witness.sh
node consumers/graft-projection.test.mjs
npm --prefix editors/vscode run compile
cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1
markdownlint-cli2 "**/*.md"
actionlint .github/workflows/*.yml
git diff --check
git diff --cached --check
git diff --check "$(git hash-object -t tree /dev/null)" HEAD

echo "RELEASE PREP PASSED"
