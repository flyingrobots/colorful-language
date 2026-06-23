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

echo "B: TypeScript decode → canonical JSON"
node witness/ir-canonicalize.mjs < "$work/a.json" > "$work/b.json"

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
  echo "  ⚠ tsc not found; skipping TS type-check (round-trip already proved)"
fi

echo "WITNESS PASSED"
