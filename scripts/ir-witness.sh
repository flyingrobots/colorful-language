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

echo "Process refusal matrix: both boundary executables must fail closed..."
process_cases=(
  mismatched-source
  invalid-json
  wrong-contract-version
  wrong-schema-hash
  wrong-vocabulary-hash
  illegal-axes
  fractional-offset
  out-of-range-offset
  missing-field
  identity-precedence
)
declare -A ts_rejection_code=(
  [mismatched-source]="E_CONTENT_HASH"
  [invalid-json]="E_JSON_DECODE"
  [wrong-contract-version]="E_CONTRACT_VERSION"
  [wrong-schema-hash]="E_SCHEMA_HASH"
  [wrong-vocabulary-hash]="E_VOCABULARY_HASH"
  [illegal-axes]="E_TOKEN_AXES"
  [fractional-offset]="E_ARTIFACT_SHAPE"
  [out-of-range-offset]="E_BYTE_RANGE_BOUNDS"
  [missing-field]="E_ARTIFACT_SHAPE"
  [identity-precedence]="E_CONTRACT_VERSION"
)
declare -A rust_rejection_code=(
  [mismatched-source]="ContentHashMismatch"
  [invalid-json]="E_JSON_DECODE"
  [wrong-contract-version]="UnsupportedContractVersion"
  [wrong-schema-hash]="SchemaHashMismatch"
  [wrong-vocabulary-hash]="VocabularyHashMismatch"
  [illegal-axes]="IllegalTokenAxes"
  [fractional-offset]="E_JSON_DECODE"
  [out-of-range-offset]="RangeOutOfBounds"
  [missing-field]="E_JSON_DECODE"
  [identity-precedence]="UnsupportedContractVersion"
)

assert_process_rejection() {
  local boundary="$1"
  local case_name="$2"
  local expected_code="$3"
  local artifact="$4"
  shift 4

  local stdout="$work/process-$boundary-$case_name.out"
  local stderr="$work/process-$boundary-$case_name.err"
  local status
  set +e
  "$@" < "$artifact" > "$stdout" 2> "$stderr"
  status=$?
  set -e

  if [[ "$status" -ne 1 ]]; then
    echo "  ❌ $boundary/$case_name: expected status 1, got $status" >&2
    sed 's/^/     stderr: /' "$stderr" >&2
    exit 1
  fi
  if [[ -s "$stdout" ]]; then
    echo "  ❌ $boundary/$case_name: rejection wrote canonical output" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_code" "$stderr"; then
    echo "  ❌ $boundary/$case_name: missing stable code $expected_code" >&2
    sed 's/^/     stderr: /' "$stderr" >&2
    exit 1
  fi
  echo "  ✅ $boundary/$case_name rejected with $expected_code and empty stdout"
}

for case_name in "${process_cases[@]}"; do
  artifact="$work/process-$case_name.json"
  node witness/process-negative.mjs "$case_name" "$work/a.json" > "$artifact"
  source="witness/fixture.txt"
  if [[ "$case_name" == "mismatched-source" ]]; then
    source="witness/negative/mismatched-source.txt"
  fi
  assert_process_rejection \
    ts "$case_name" "${ts_rejection_code[$case_name]}" "$artifact" \
    node witness/ir-canonicalize.mjs "$source"
  assert_process_rejection \
    rust "$case_name" "${rust_rejection_code[$case_name]}" "$artifact" \
    ./target/debug/examples/recanon "$source"
done

echo "Cross-language validator parity: one mutation matrix, two independent validators..."
printf '%s' \
  "$(./target/debug/colorful ir crates/colorful-ir/tests/fixtures/validator-parity.txt)" \
  > "$work/validator-parity-base.json"
COLORFUL_VALIDATOR_PARITY_DOCUMENT="$work/validator-parity-base.json" \
  cargo test -q -p colorful-ir shared_validator_parity_matrix_covers_every_error_variant
node witness/validator-parity.mjs \
  crates/colorful-ir/tests/fixtures/validator-parity.txt \
  "$work/validator-parity-base.json"

echo "WITNESS PASSED"
