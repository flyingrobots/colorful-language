#!/usr/bin/env bash
# Prove the reviewed, bounded colorful-ir validator mutation corpus is stable
# and that every viable in-scope mutation is killed by a deterministic test.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
expected="$root/scripts/fixtures/ir-validator-mutants.txt"
required_version="27.0.0"
output="$root/target/ir-validator-mutants"

fail() {
  printf 'IR validator mutation check failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 0 ]]; then
  fail "usage: scripts/check-ir-validator-mutants.sh"
fi

node --test scripts/check-ir-validator-mutants.test.mjs

command -v cargo-mutants >/dev/null 2>&1 ||
  fail "cargo-mutants $required_version is required"
actual_version="$(cargo mutants --version | awk '{print $2}')"
[[ "$actual_version" == "$required_version" ]] ||
  fail "expected cargo-mutants $required_version, found $actual_version"
[[ -f "$expected" ]] || fail "missing reviewed mutation inventory"

cd "$root"
actual="$(mktemp)"
trap 'rm -f "$actual"' EXIT

cargo mutants --list --no-shuffle --no-times --colors=never |
  sed -E 's|^.*:[0-9]+:[0-9]+: ||' >"$actual"

if ! diff -u "$expected" "$actual"; then
  fail "generated mutation inventory drifted from the reviewed corpus"
fi

cargo mutants \
  --no-shuffle \
  --jobs 1 \
  --timeout 60 \
  --build-timeout 60 \
  --no-times \
  --colors=never \
  --output "$output"

printf 'IR validator mutation check passed: 80 reviewed mutants, no survivors\n'
