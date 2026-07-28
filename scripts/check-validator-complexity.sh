#!/usr/bin/env bash
# Enforce the reviewed IR validator complexity budget and prove the configured
# Clippy lint rejects an intentionally over-budget function.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
config="$root/clippy.toml"
ir_source="$root/crates/colorful-ir/src/lib.rs"
fixture="$root/scripts/fixtures/validator-complexity/Cargo.toml"
target="$root/target/validator-complexity-fixture"

fail() {
  printf 'validator complexity check failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 0 ]]; then
  fail "usage: scripts/check-validator-complexity.sh"
fi

[[ -f "$config" ]] || fail "missing clippy.toml"

threshold_count="$(
  grep -Ec '^[[:space:]]*cognitive-complexity-threshold[[:space:]]*=[[:space:]]*10[[:space:]]*$' \
    "$config" || true
)"
[[ "$threshold_count" -eq 1 ]] ||
  fail "clippy.toml must set cognitive-complexity-threshold = 10 exactly once"

grep -Fx '#![warn(clippy::cognitive_complexity)]' "$ir_source" >/dev/null ||
  fail "colorful-ir must enable clippy::cognitive_complexity"

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

if CLIPPY_CONF_DIR="$root" CARGO_TARGET_DIR="$target" \
  cargo clippy --manifest-path "$fixture" --locked --offline -- -D warnings \
  >"$output" 2>&1; then
  fail "the over-budget fixture unexpectedly passed"
fi

grep -F 'cognitive_complexity' "$output" >/dev/null ||
  fail "the over-budget fixture failed without the cognitive-complexity diagnostic"

printf 'validator complexity check passed: threshold 10 rejects the over-budget fixture\n'
