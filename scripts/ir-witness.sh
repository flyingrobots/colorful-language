#!/usr/bin/env bash
# The Stage 1 gate: prove the colorful IR round-trips byte-for-byte across the
# Rust producer and the TypeScript consumer.
#
#   Rust  ──colorful ir──▶  canonical JSON A
#   TS    ──canonicalize──▶ canonical JSON B
#   Rust  ──decode+canon──▶ canonical JSON C
#
# Pass iff A == B == C, and the generated TS contract type compiles.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Building colorful + recanon..."
cargo build -q -p colorful-cli
cargo build -q -p colorful-ir --example recanon

echo "A: Rust → canonical JSON"
# `colorful ir` appends a newline for terminal ergonomics; the canonical form
# (what B and C produce) has none, so strip the trailing newline.
printf '%s' "$(./target/debug/colorful ir witness/fixture.txt)" > "$work/a.json"

echo "B: TypeScript decode → validate → canonical JSON"
# Pass the source so the TS leg validates the decoded document against the
# contract and the real bytes (the same admission gate the graft reference
# consumer runs) before re-emitting -- symmetric with the Rust leg below.
node witness/ir-canonicalize.mjs witness/fixture.txt < "$work/a.json" > "$work/b.json"

echo "C: Rust decode → validate → canonical JSON"
# Pass the source so recanon validates the decoded document against the real
# bytes (content hash, byte length, UTF-8 boundaries) before re-emitting.
./target/debug/examples/recanon witness/fixture.txt < "$work/b.json" > "$work/c.json"

echo "Comparing A == B == C (byte-for-byte)..."
if cmp -s "$work/a.json" "$work/b.json" && cmp -s "$work/b.json" "$work/c.json"; then
  echo "  ✅ round-trip identical ($(wc -c < "$work/a.json") bytes)"
else
  echo "  ❌ MISMATCH"; diff <(tr ',' '\n' < "$work/a.json") <(tr ',' '\n' < "$work/b.json") | head; exit 1
fi

echo "Type-checking the generated TS contract..."
if command -v tsc >/dev/null 2>&1; then
  tsc -p witness/tsconfig.json
  echo "  ✅ generated TS contract type-checks"
else
  echo "  ❌ tsc not found; cannot type-check generated TS contract" >&2
  exit 1
fi

echo "Negative fixtures: the TS leg must reject each malformed artifact for its specific reason..."
# A bare nonzero exit only proves *some* check fired -- not the one the
# fixture exists to prove. If a fixture regains a stale schema/vocabulary/
# content hash or the targeted check regresses while some other guard still
# happens to reject it, a nonzero-exit-only assertion would stay green for
# the wrong reason. Assert the exact expected message substring instead.
declare -A expected_rejection=(
  [unknown-field]="unknown top-level field: unexpectedField"
  [missing-field]="derivation must be an array"
  [wrong-type]="contractVersion must be a string"
)
for fixture in witness/negative/*.json; do
  name="$(basename "$fixture" .json)"
  expected="${expected_rejection[$name]:-}"
  if [[ -z "$expected" ]]; then
    echo "  ❌ $name: no expected-rejection entry recorded in this script -- add one" >&2
    exit 1
  fi
  if node witness/ir-canonicalize.mjs witness/fixture.txt < "$fixture" > /dev/null 2>"$work/negative-$name.err"; then
    echo "  ❌ $name: expected rejection, but the TS leg accepted it" >&2
    exit 1
  fi
  actual="$(cat "$work/negative-$name.err")"
  if [[ "$actual" != *"$expected"* ]]; then
    echo "  ❌ $name: rejected, but not for the expected reason" >&2
    echo "     expected to contain: $expected" >&2
    echo "     actual:              $actual" >&2
    exit 1
  fi
  echo "  ✅ $name rejected for the expected reason: $actual"
done

echo "WITNESS PASSED"
