#!/usr/bin/env bash
# Regenerate the colorful IR boundary types from the GraphQL contracts via Wesley.
#
# The committed output under crates/colorful-ir/{src/generated,ts}/ is the
# source of truth for builds; this script reproduces it. Requires
# COLORFUL_WESLEY_ROOT pointing at a Wesley 0.1.1 checkout; the script verifies
# the CLI version before generation so an ambient checkout cannot silently drift.
set -euo pipefail

required_wesley_version="0.1.1"
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${COLORFUL_WESLEY_ROOT:?Set COLORFUL_WESLEY_ROOT to a Wesley 0.1.1 checkout}"
wcli="$COLORFUL_WESLEY_ROOT/crates/wesley-cli/Cargo.toml"

wesley() { cargo run -q --manifest-path "$wcli" -- "$@"; }

actual_wesley_version="$(wesley --version)"
if [[ "$actual_wesley_version" != "$required_wesley_version" ]]; then
  echo "Expected wesley $required_wesley_version, found $actual_wesley_version." >&2
  echo "Set COLORFUL_WESLEY_ROOT to a Wesley $required_wesley_version checkout." >&2
  exit 1
fi

contracts="$root/contracts/colorful"
gen_rs="$root/crates/colorful-ir/src/generated"
gen_ts="$root/crates/colorful-ir/ts"
crate_contracts="$root/crates/colorful-ir/contracts"

wesley emit rust       --schema "$contracts/syntax.v1.graphql"     --out "$gen_rs/syntax_v1.rs"
wesley emit rust       --schema "$contracts/vocabulary.v1.graphql" --out "$gen_rs/vocabulary_v1.rs"
wesley emit typescript --schema "$contracts/syntax.v1.graphql"     --out "$gen_ts/syntax_v1.ts"
wesley emit typescript --schema "$contracts/vocabulary.v1.graphql" --out "$gen_ts/vocabulary_v1.ts"
cp "$contracts/syntax.v1.graphql" "$crate_contracts/syntax.v1.graphql"
cp "$contracts/vocabulary.v1.graphql" "$crate_contracts/vocabulary.v1.graphql"
cp "$contracts/vocabulary.v1.json" "$crate_contracts/vocabulary.v1.json"

echo "Regenerated from contracts (wesley $required_wesley_version). Review the diff and commit."
