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

printf 'check-rust-source-policy tests passed\n'
