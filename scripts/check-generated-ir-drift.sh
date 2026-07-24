#!/usr/bin/env bash
# Fails on drift between the committed Wesley-generated IR outputs
# (crates/colorful-ir/{src/generated,ts}/) and what an immutable, pinned
# Wesley checkout actually produces from contracts/colorful/*.graphql today.
# Generates into a temporary directory and diffs -- never overwrites the
# checkout -- so CI, not an ambient developer COLORFUL_WESLEY_ROOT checkout,
# is the oracle for "is the committed output correct."
set -euo pipefail

# Immutable source: an exact commit SHA, not a floating tag or branch, so
# this cannot silently drift even if flyingrobots/wesley's v0.1.1 tag were
# ever moved in that (separate) repository.
WESLEY_REPO_URL="${COLORFUL_WESLEY_REPO_URL:-https://github.com/flyingrobots/wesley.git}"
readonly WESLEY_COMMIT="eac8970f67b6507d8b109a49e883095214116856" # v0.1.1
readonly REQUIRED_WESLEY_VERSION="0.1.1"

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "check-generated-ir-drift failed: $*" >&2
  exit 1
}

wesley_checkout="$work/wesley"
echo "Cloning Wesley from an immutable pinned commit ($WESLEY_COMMIT)..."
git clone -q "$WESLEY_REPO_URL" "$wesley_checkout"
git -C "$wesley_checkout" checkout -q "$WESLEY_COMMIT"

wcli="$wesley_checkout/crates/wesley-cli/Cargo.toml"
wesley() { cargo run -q --manifest-path "$wcli" -- "$@"; }

actual_version="$(wesley --version)"
[[ "$actual_version" == "$REQUIRED_WESLEY_VERSION" ]] ||
  fail "pinned commit $WESLEY_COMMIT reports wesley $actual_version, expected $REQUIRED_WESLEY_VERSION"

gen_dir="$work/generated"
gen_rs="$gen_dir/src/generated"
gen_ts="$gen_dir/ts"
mkdir -p "$gen_rs" "$gen_ts"

contracts="$root/contracts/colorful"
wesley emit rust       --schema "$contracts/syntax.v1.graphql"     --out "$gen_rs/syntax_v1.rs"
wesley emit rust       --schema "$contracts/vocabulary.v1.graphql" --out "$gen_rs/vocabulary_v1.rs"
wesley emit typescript --schema "$contracts/syntax.v1.graphql"     --out "$gen_ts/syntax_v1.ts"
wesley emit typescript --schema "$contracts/vocabulary.v1.graphql" --out "$gen_ts/vocabulary_v1.ts"

drift=0
check() {
  local generated="$1" committed="$2"
  if ! cmp -s "$generated" "$committed"; then
    echo "DRIFT: $committed does not match what pinned Wesley $REQUIRED_WESLEY_VERSION generates" >&2
    diff -u "$committed" "$generated" >&2 || true
    drift=1
  fi
}

check "$gen_rs/syntax_v1.rs" "$root/crates/colorful-ir/src/generated/syntax_v1.rs"
check "$gen_rs/vocabulary_v1.rs" "$root/crates/colorful-ir/src/generated/vocabulary_v1.rs"
check "$gen_ts/syntax_v1.ts" "$root/crates/colorful-ir/ts/syntax_v1.ts"
check "$gen_ts/vocabulary_v1.ts" "$root/crates/colorful-ir/ts/vocabulary_v1.ts"

if [[ "$drift" -ne 0 ]]; then
  fail "committed generated output is stale -- run" \
    "'COLORFUL_WESLEY_ROOT=<wesley 0.1.1 checkout> bash scripts/gen-ir.sh' and commit the diff"
fi

echo "check-generated-ir-drift passed: committed generated output matches pinned Wesley $REQUIRED_WESLEY_VERSION."
