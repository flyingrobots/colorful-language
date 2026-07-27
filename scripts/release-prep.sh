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

bash scripts/check-node-version.test.sh
bash scripts/check-node-version.sh
bash scripts/release-profile-check.sh
node scripts/check-evidence-toolchains.mjs --self-test
node scripts/check-evidence-toolchains.mjs
node scripts/check-release-publish-order.test.mjs
node scripts/check-release-publish-order.mjs

cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --all --locked
bash scripts/package-witness.sh
bash scripts/smoke-test-install-local.sh
cargo build --release --locked
npm ci
node --test scripts/check-dependency-update-policy.test.mjs
node scripts/check-dependency-update-policy.mjs
node scripts/check-vscode-dependency-policy.test.mjs
node scripts/check-vscode-dependency-policy.mjs
npm --prefix editors/vscode ci
npm --prefix editors/vscode audit --audit-level=high
bash scripts/ir-witness.sh
bash scripts/check-generated-ir-drift.sh
bash scripts/check-generated-vocabulary-drift.sh
node consumers/graft-projection.test.mjs
npm --prefix editors/vscode run compile
cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1 --locked
markdownlint-cli2 "**/*.md"
actionlint .github/workflows/*.yml
git diff --check
git diff --cached --check
git diff --check "$(git hash-object -t tree /dev/null)" HEAD

echo "RELEASE PREP PASSED"
