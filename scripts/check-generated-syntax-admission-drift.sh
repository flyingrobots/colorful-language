#!/usr/bin/env bash
# Verify that both portable JavaScript admission copies match the compatibility
# manifest and its versioned GraphQL schemas.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

node "$root/scripts/generate-syntax-admission.mjs" --output-root "$work"

outputs=(
  "consumers/generated/syntax-admission-v1.mjs"
  "consumers/independent-ir-report/generated/syntax-admission-v1.mjs"
)
for output in "${outputs[@]}"; do
  if ! cmp -s "$work/$output" "$root/$output"; then
    echo "DRIFT: $output does not match the compatibility schemas." >&2
    diff -u "$root/$output" "$work/$output" >&2 || true
    exit 1
  fi
done

node --test "$root/scripts/syntax-admission-review-cases.test.mjs"
node --test "$root/scripts/generate-syntax-admission.test.mjs"
node --test "$root/scripts/check-portable-admission-docs.test.mjs"
node "$root/scripts/check-portable-admission-docs.mjs"
echo "check-generated-syntax-admission-drift passed."
