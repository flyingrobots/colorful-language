#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
checker="$root/scripts/check-rust-dependency-policy.sh"
fixture="$(mktemp -d)"
fixture="$(cd "$fixture" && pwd -P)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p \
  "$fixture/crate/src" \
  "$fixture/editors/zed/src" \
  "$fixture/tools/standalone/src"

cat >"$fixture/Cargo.toml" <<'EOF'
[workspace]
members = ["crate"]
resolver = "2"
EOF

cat >"$fixture/crate/Cargo.toml" <<'EOF'
[package]
name = "advisory-root-member"
version = "0.0.0"
edition = "2021"
EOF

cat >"$fixture/crate/src/lib.rs" <<'EOF'
pub fn root_member() {}
EOF

cat >"$fixture/editors/zed/Cargo.toml" <<'EOF'
[package]
name = "advisory-zed"
version = "0.0.0"
edition = "2021"

[workspace]
EOF

cat >"$fixture/editors/zed/src/lib.rs" <<'EOF'
pub fn zed() {}
EOF

cat >"$fixture/tools/standalone/Cargo.toml" <<'EOF'
[package]
name = "advisory-standalone"
version = "0.0.0"
edition = "2021"

[workspace]
EOF

cat >"$fixture/tools/standalone/src/lib.rs" <<'EOF'
pub fn standalone() {}
EOF

cargo generate-lockfile --manifest-path "$fixture/Cargo.toml" >/dev/null
cargo generate-lockfile \
  --manifest-path "$fixture/editors/zed/Cargo.toml" >/dev/null
cargo generate-lockfile \
  --manifest-path "$fixture/tools/standalone/Cargo.toml" >/dev/null

for excluded in .git node_modules target vendor; do
  mkdir -p "$fixture/$excluded/ignored"
  cat >"$fixture/$excluded/ignored/Cargo.toml" <<'EOF'
This is deliberately not a Cargo manifest.
EOF
done

git -C "$fixture" init -q
git -C "$fixture" add \
  Cargo.toml \
  crate/Cargo.toml \
  editors/zed/Cargo.toml \
  tools/standalone/Cargo.toml

mkdir -p "$fixture/scratch"
cat >"$fixture/scratch/Cargo.toml" <<'EOF'
This untracked scratch manifest must not affect repository policy.
EOF

mkdir -p "$fixture/test-bin"
cat >"$fixture/test-bin/cargo-deny" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 9 ||
  "$1" != "--manifest-path" ||
  "$3" != "--locked" ||
  "$4" != "check" ||
  "$5" != "--config" ||
  "$6" != "${FIXTURE_ROOT:?}/deny.toml" ||
  "$7" != "advisories" ||
  "$8" != "licenses" ||
  "$9" != "sources" ]]; then
  printf 'unexpected cargo-deny arguments:' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
  exit 2
fi
manifest="$2"
printf '%s\n' "$manifest" >>"${CARGO_DENY_INVOCATION_LOG:?}"
if [[ -n "${FAIL_MANIFEST:-}" && "$manifest" == "$FAIL_MANIFEST" ]]; then
  printf 'fixture advisory failure: %s\n' "$manifest" >&2
  exit 1
fi
EOF
chmod +x "$fixture/test-bin/cargo-deny"

mkdir -p "$fixture/no-python-bin"
for tool in bash cargo cargo-deny dirname; do
  ln -s "$(command -v "$tool")" "$fixture/no-python-bin/$tool"
done
output=""
if output="$(
  PATH="$fixture/no-python-bin" \
    "$checker" --root "$fixture" 2>&1
)"; then
  printf 'expected a missing-python3 prerequisite failure\n%s\n' "$output" >&2
  exit 1
fi
if [[ "$output" != "Rust dependency policy check failed: python3 is required" ]]; then
  printf 'wrong missing-python3 failure\n%s\n' "$output" >&2
  exit 1
fi

invocations="$fixture/cargo-deny-invocations.log"
output="$(
  PATH="$fixture/test-bin:$PATH" \
    CARGO_DENY_INVOCATION_LOG="$invocations" \
    FIXTURE_ROOT="$fixture" \
    "$checker" --root "$fixture"
)"

expected="$fixture/expected-workspaces"
cat >"$expected" <<EOF
$fixture/Cargo.toml
$fixture/editors/zed/Cargo.toml
$fixture/tools/standalone/Cargo.toml
EOF
sort -o "$expected" "$expected"
sort -o "$invocations" "$invocations"
if ! cmp -s "$expected" "$invocations"; then
  printf 'dependency-policy workspace inventory did not match\nexpected:\n' >&2
  sed 's/^/  /' "$expected" >&2
  printf 'actual:\n' >&2
  sed 's/^/  /' "$invocations" >&2
  exit 1
fi
if [[ "$output" != *"check-rust-dependency-policy passed: 3 workspace(s)"* ]]; then
  printf 'dependency-policy checker did not report the workspace count\n%s\n' \
    "$output" >&2
  exit 1
fi

: >"$invocations"
output=""
if output="$(
  PATH="$fixture/test-bin:$PATH" \
    CARGO_DENY_INVOCATION_LOG="$invocations" \
    FIXTURE_ROOT="$fixture" \
    FAIL_MANIFEST="$fixture/editors/zed/Cargo.toml" \
    "$checker" --root "$fixture" 2>&1
)"; then
  printf 'expected a workspace advisory failure\n%s\n' "$output" >&2
  exit 1
fi
if [[ "$output" != *"fixture advisory failure: $fixture/editors/zed/Cargo.toml"* ]]; then
  printf 'wrong propagated advisory failure\n%s\n' "$output" >&2
  exit 1
fi

mutated_checker="$fixture/check-rust-dependency-policy-without-locked.sh"
sed '/^[[:space:]]*--locked/d' "$checker" >"$mutated_checker"
chmod +x "$mutated_checker"
: >"$invocations"
output=""
if output="$(
  PATH="$fixture/test-bin:$PATH" \
    CARGO_DENY_INVOCATION_LOG="$invocations" \
    FIXTURE_ROOT="$fixture" \
    "$mutated_checker" --root "$fixture" 2>&1
)"; then
  printf 'expected the self-test stub to reject a missing --locked argument\n%s\n' \
    "$output" >&2
  exit 1
fi
if [[ "$output" != *"unexpected cargo-deny arguments:"* ]]; then
  printf 'wrong cargo-deny argument-contract failure\n%s\n' "$output" >&2
  exit 1
fi

printf 'check-rust-dependency-policy self-test passed\n'
