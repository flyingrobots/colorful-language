#!/usr/bin/env bash
# Regenerate the colorful IR boundary types from the GraphQL contracts via Wesley.
#
# The committed output under crates/colorful-ir/{src/generated,ts}/ is the
# source of truth for builds; this script reproduces it. Requires
# COLORFUL_WESLEY_ROOT pointing at a Wesley checkout. Pinned: wesley 0.1.1
# (an ambient checkout is a developer override, not the replay mechanism).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
: "${COLORFUL_WESLEY_ROOT:?Set COLORFUL_WESLEY_ROOT to a Wesley 0.1.1 checkout}"
wcli="$COLORFUL_WESLEY_ROOT/crates/wesley-cli/Cargo.toml"

wesley() { cargo run -q --manifest-path "$wcli" -- "$@"; }

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

echo "Regenerated from contracts (wesley 0.1.1). Review the diff and commit."
