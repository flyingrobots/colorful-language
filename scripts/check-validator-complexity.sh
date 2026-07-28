#!/usr/bin/env bash
# Enforce the reviewed IR validator complexity budget and prove the configured
# Clippy lint rejects an intentionally over-budget function.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
config="$root/clippy.toml"
ir_source="$root/crates/colorful-ir/src/lib.rs"
ir_reference="$root/docs/topics/ir/README.md"
fixture="$root/scripts/fixtures/validator-complexity/Cargo.toml"
target="$root/target/validator-complexity-fixture"
toolchain_file="$root/rust-toolchain.toml"

fail() {
  printf 'validator complexity check failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 0 ]]; then
  fail "usage: scripts/check-validator-complexity.sh"
fi

[[ -f "$config" ]] || fail "missing clippy.toml"
[[ -f "$ir_reference" ]] || fail "missing IR reference"
[[ -f "$toolchain_file" ]] || fail "missing rust-toolchain.toml"

evidence_rust="$(
  sed -nE 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' \
    "$toolchain_file"
)"
[[ -n "$evidence_rust" ]] ||
  fail "rust-toolchain.toml must declare the evidence Rust channel"

cd "$root"
actual_rust="$(rustc --version | awk '{print $2}')"
[[ "$actual_rust" == "$evidence_rust" ]] ||
  fail "expected evidence Rust $evidence_rust, found $actual_rust"

grep -F "Rust $evidence_rust" "$ir_reference" >/dev/null ||
  fail "IR reference must name the evidence Rust release for the Clippy heuristic"
grep -F "toolchain-bound heuristic" "$ir_reference" >/dev/null ||
  fail "IR reference must document the complexity lint's toolchain-bound limitation"

threshold_count="$(
  grep -Ec '^[[:space:]]*cognitive-complexity-threshold[[:space:]]*=[[:space:]]*10[[:space:]]*$' \
    "$config" || true
)"
[[ "$threshold_count" -eq 1 ]] ||
  fail "clippy.toml must set cognitive-complexity-threshold = 10 exactly once"

grep -Fx '#![cfg_attr(not(test), warn(clippy::cognitive_complexity))]' \
  "$ir_source" >/dev/null ||
  fail "colorful-ir production code must enable clippy::cognitive_complexity"

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

if ! CLIPPY_CONF_DIR="$root" CARGO_TARGET_DIR="$target" \
  cargo clippy --manifest-path "$fixture" --locked --offline \
  --no-default-features -- -D warnings >"$output" 2>&1; then
  cat "$output" >&2
  fail "the within-budget fixture unexpectedly failed"
fi

: >"$output"
if CLIPPY_CONF_DIR="$root" CARGO_TARGET_DIR="$target" \
  cargo clippy --manifest-path "$fixture" --locked --offline \
  --features over-budget -- -D warnings >"$output" 2>&1; then
  fail "the over-budget fixture unexpectedly passed"
fi

grep -F 'cognitive_complexity' "$output" >/dev/null ||
  fail "the over-budget fixture failed without the cognitive-complexity diagnostic"

printf 'validator complexity check passed: threshold 10 accepts 10 and rejects 11\n'
