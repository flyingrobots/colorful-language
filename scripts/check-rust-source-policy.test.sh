#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
checker="$root/scripts/check-rust-source-policy.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p \
  "$fixture/crate/src" \
  "$fixture/docs/design" \
  "$fixture/docs/workflows/rust-source-policy" \
  "$fixture/editors/zed/src"

cat >"$fixture/Cargo.toml" <<'EOF'
[workspace]
members = ["crate"]
resolver = "2"
EOF

cat >"$fixture/crate/Cargo.toml" <<'EOF'
[package]
name = "source-policy-fixture"
version = "0.0.0"
edition = "2021"

[lib]
path = "src/lib.rs"
EOF

cat >"$fixture/editors/zed/Cargo.toml" <<'EOF'
[package]
name = "source-policy-zed-fixture"
version = "0.0.0"
edition = "2021"

[workspace]

[lib]
crate-type = ["cdylib"]
EOF

cat >"$fixture/editors/zed/src/lib.rs" <<'EOF'
#![forbid(unsafe_code)]
EOF

: >"$fixture/docs/workflows/rust-source-policy/exceptions.tsv"
cargo generate-lockfile --manifest-path "$fixture/Cargo.toml" >/dev/null
cargo generate-lockfile \
  --manifest-path "$fixture/editors/zed/Cargo.toml" >/dev/null

expect_unprotected() {
  local name="$1"
  local output
  if output="$("$checker" --root "$fixture" 2>&1)"; then
    printf 'expected source-policy failure: %s\n%s\n' "$name" "$output" >&2
    exit 1
  fi
  if [[ "$output" != *"missing #![forbid(unsafe_code)]: crate/src/lib.rs"* ]]; then
    printf 'wrong source-policy failure: %s\n%s\n' "$name" "$output" >&2
    exit 1
  fi
}

cat >"$fixture/crate/src/lib.rs" <<'EOF'
mod scoped {
#![forbid(unsafe_code)]
}

pub unsafe fn allowed_at_crate_root() {}
EOF
expect_unprotected "child-module attribute"

cat >"$fixture/crate/src/lib.rs" <<'EOF'
pub const POLICY_TEXT: &str = r#"
#![forbid(unsafe_code)]
"#;

pub unsafe fn allowed_at_crate_root() {}
EOF
expect_unprotected "string-literal text"

cat >"$fixture/crate/src/lib.rs" <<'EOF'
pub fn unprotected() {}
EOF
cat >"$fixture/docs/workflows/outside.md" <<'EOF'
# Not a design record
EOF

expect_invalid_design_record() {
  local name="$1"
  local output
  if output="$("$checker" --root "$fixture" 2>&1)"; then
    printf 'expected design-record failure: %s\n%s\n' "$name" "$output" >&2
    exit 1
  fi
  if [[ "$output" != *"source-policy exception has no design record:"* ]]; then
    printf 'wrong design-record failure: %s\n%s\n' "$name" "$output" >&2
    exit 1
  fi
}

printf 'crate/src/lib.rs\tdocs/design/../workflows/outside.md\n' \
  >"$fixture/docs/workflows/rust-source-policy/exceptions.tsv"
expect_invalid_design_record "parent traversal"

ln -s ../workflows/outside.md "$fixture/docs/design/escape.md"
printf 'crate/src/lib.rs\tdocs/design/escape.md\n' \
  >"$fixture/docs/workflows/rust-source-policy/exceptions.tsv"
expect_invalid_design_record "symlink escape"

cat >"$fixture/docs/design/approved.md" <<'EOF'
# Approved fixture exception
EOF
printf 'crate/src/lib.rs\tdocs/design/approved.md\n' \
  >"$fixture/docs/workflows/rust-source-policy/exceptions.tsv"
output="$("$checker" --root "$fixture")"
if [[ "$output" != *"source-policy exception: crate/src/lib.rs -> docs/design/approved.md"* ]]; then
  printf 'valid design-record exception failed\n%s\n' "$output" >&2
  exit 1
fi

cat >"$fixture/crate/src/lib.rs" <<'EOF'
#![forbid(unsafe_code)]
EOF
printf 'crate/src/lib.rs\tdocs/design/approved.md' \
  >"$fixture/docs/workflows/rust-source-policy/exceptions.tsv"
output=""
if output="$("$checker" --root "$fixture" 2>&1)"; then
  printf 'expected unterminated stale-exception failure\n%s\n' "$output" >&2
  exit 1
fi
if [[ "$output" != *"source-policy exception is stale: crate/src/lib.rs"* ]]; then
  printf 'wrong unterminated-row failure\n%s\n' "$output" >&2
  exit 1
fi

: >"$fixture/docs/workflows/rust-source-policy/exceptions.tsv"
output="$("$checker" --root "$fixture")"
if [[ "$output" != *"check-rust-source-policy passed: 2 production root(s)"* ]]; then
  printf 'empty exception registry failed\n%s\n' "$output" >&2
  exit 1
fi

mkdir -p "$fixture/tools/standalone/src"
cat >"$fixture/tools/standalone/Cargo.toml" <<'EOF'
[package]
name = "source-policy-standalone-fixture"
version = "0.0.0"
edition = "2021"

[workspace]

[lib]
path = "src/lib.rs"
EOF
cat >"$fixture/tools/standalone/src/lib.rs" <<'EOF'
pub fn unprotected_standalone() {}
EOF
cargo generate-lockfile \
  --manifest-path "$fixture/tools/standalone/Cargo.toml" >/dev/null

output=""
if output="$("$checker" --root "$fixture" 2>&1)"; then
  printf 'expected discovered-workspace failure\n%s\n' "$output" >&2
  exit 1
fi
if [[ "$output" != *"missing #![forbid(unsafe_code)]: tools/standalone/src/lib.rs"* ]]; then
  printf 'wrong discovered-workspace failure\n%s\n' "$output" >&2
  exit 1
fi

cat >"$fixture/tools/standalone/src/lib.rs" <<'EOF'
#![forbid(unsafe_code)]

pub fn protected_standalone() {}
EOF
output="$("$checker" --root "$fixture")"
if [[ "$output" != *"check-rust-source-policy passed: 3 production root(s)"* ]]; then
  printf 'discovered workspace was not inventoried exactly once\n%s\n' \
    "$output" >&2
  exit 1
fi

for excluded in .git node_modules target vendor; do
  mkdir -p "$fixture/$excluded/ignored"
  cat >"$fixture/$excluded/ignored/Cargo.toml" <<'EOF'
This is deliberately not a Cargo manifest.
EOF
done
output="$("$checker" --root "$fixture")"
if [[ "$output" != *"check-rust-source-policy passed: 3 production root(s)"* ]]; then
  printf 'excluded manifest directory was not pruned\n%s\n' "$output" >&2
  exit 1
fi

printf 'check-rust-source-policy tests passed\n'
