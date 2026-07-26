#!/usr/bin/env bash
# Fails when either committed vocabulary validator differs from deterministic
# generation from the shared schema authority. Generation happens in a
# temporary directory and never overwrites the checkout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  printf 'check-generated-vocabulary-drift failed: %s\n' "$*" >&2
  exit 1
}

node "$root/scripts/generate-vocabulary-validators.mjs" --output-root "$work" >/dev/null

outputs=(
  "crates/colorful-ir/src/generated/vocabulary_validator_v1.rs"
  "consumers/generated/vocabulary-validator-v1.mjs"
  "crates/colorful-ir/contracts/vocabulary.v1.schema.json"
)

drift=0
for relative_path in "${outputs[@]}"; do
  generated="$work/$relative_path"
  committed="$root/$relative_path"
  if ! cmp -s "$generated" "$committed"; then
    printf 'DRIFT: %s does not match vocabulary.v1.schema.json\n' "$committed" >&2
    diff -u "$committed" "$generated" >&2 || true
    drift=1
  fi
done

if [[ "$drift" -ne 0 ]]; then
  fail "run 'node scripts/generate-vocabulary-validators.mjs' and commit every generated output"
fi

node "$root/scripts/generate-vocabulary-validators.test.mjs"
echo "check-generated-vocabulary-drift passed: both validators match the shared schema."
