#!/usr/bin/env bash
# Scan every committed Cargo workspace against the RustSec advisory database.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  printf 'Rust advisory check failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 0 ]]; then
  fail "usage: scripts/check-rust-advisories.sh"
fi

command -v cargo-deny >/dev/null 2>&1 ||
  fail "cargo-deny is required"

manifests=(
  Cargo.toml
  editors/zed/Cargo.toml
)

for manifest in "${manifests[@]}"; do
  printf 'Checking locked Rust advisories for %s\n' "$manifest"
  cargo deny \
    --manifest-path "$manifest" \
    --locked \
    check advisories
done
