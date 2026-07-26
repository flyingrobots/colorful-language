#!/usr/bin/env bash
# Smoke test for scripts/install-local.sh (DIST-4a): installs into a fresh,
# temporary COLORFUL_HOME, verifies `bin/colorful --version`, reruns to prove
# the documented "re-run to upgrade" path is idempotent, and asserts the
# real $HOME/.colorful-language is never touched by any of it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  echo "smoke-test-install-local failed: $*" >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Isolate HOME to mock-home to prevent touching the real developer installation.
mock_home="$work/mock-home"
mkdir -p "$mock_home"

# Pre-create a canary default installation in the mock home.
canary_dir="$mock_home/.colorful-language"
mkdir -p "$canary_dir"
echo "canary" > "$canary_dir/canary.txt"

# Ensure rustup and cargo can find their toolchains using the absolute paths of the user's home before redirection.
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"

# Export the isolated HOME
export HOME="$mock_home"

tmp_home="$work/colorful-home"

echo "Installing into a temporary COLORFUL_HOME ($tmp_home)..."
COLORFUL_HOME="$tmp_home" bash "$root/scripts/install-local.sh" >/dev/null

[[ -x "$tmp_home/bin/colorful" ]] || fail "expected $tmp_home/bin/colorful to exist and be executable"

version_output="$("$tmp_home/bin/colorful" --version)"
[[ "$version_output" == colorful\ * ]] || fail "expected 'colorful --version' to report a version, got: $version_output"
echo "OK: first install reports '$version_output'"

# Make the installed binary observably stale to ensure the rerun replaces it.
echo "sentinel" > "$tmp_home/bin/colorful"

echo "Re-running install-local.sh against the same COLORFUL_HOME (idempotence)..."
COLORFUL_HOME="$tmp_home" bash "$root/scripts/install-local.sh" >/dev/null

[[ -x "$tmp_home/bin/colorful" ]] || fail "expected $tmp_home/bin/colorful to still exist after rerun"
version_output_2="$("$tmp_home/bin/colorful" --version)"
[[ "$version_output_2" == "$version_output" ]] ||
  fail "expected the rerun to replace the sentinel and report the same version ('$version_output'), got: $version_output_2"
echo "OK: rerun is idempotent, replaced sentinel and still reports '$version_output_2'"

# Verify the mock home (the isolated default HOME) was never touched by the installer.
if [[ ! -f "$canary_dir/canary.txt" ]]; then
  fail "canary file was deleted!"
fi
if [[ "$(cat "$canary_dir/canary.txt")" != "canary" ]]; then
  fail "canary content was modified!"
fi
other_files="$(find "$mock_home" -type f ! -name "canary.txt")"
if [[ -n "$other_files" ]]; then
  fail "the installer wrote files to the default HOME directory: $other_files"
fi
echo "OK: the default HOME directory was not touched"

echo "Checking a custom CARGO wrapper receives only Cargo-native arguments..."
cargo_wrapper="$work/cargo-wrapper"
expected_toolchain="$(
  sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$root/rust-toolchain.toml"
)"
export EXPECTED_TOOLCHAIN="$expected_toolchain"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "${1:-}" == +* ]]; then' \
  '  echo "custom cargo wrapper received rustup-only toolchain syntax" >&2' \
  '  exit 64' \
  'fi' \
  'if [[ "${RUSTUP_TOOLCHAIN:-}" != "$EXPECTED_TOOLCHAIN" ]]; then' \
  '  echo "custom cargo wrapper did not receive the pinned toolchain" >&2' \
  '  exit 65' \
  'fi' \
  'exec cargo "$@"' > "$cargo_wrapper"
chmod +x "$cargo_wrapper"
wrapper_home="$work/wrapper-home"
RUSTUP_TOOLCHAIN=off-policy CARGO="$cargo_wrapper" COLORFUL_HOME="$wrapper_home" \
  bash "$root/scripts/install-local.sh" >/dev/null ||
  fail "custom CARGO wrapper could not install colorful"
[[ -x "$wrapper_home/bin/colorful" ]] ||
  fail "custom CARGO wrapper did not install colorful"

echo "Checking Rust channel parsing accepts policy-valid whitespace..."
parser_root="$work/parser-root"
mkdir -p "$parser_root/scripts" "$parser_root/crates/colorful-cli"
cp "$root/scripts/install-local.sh" "$parser_root/scripts/install-local.sh"
printf '[toolchain]\n  channel="1.97.1" # reviewed\n' \
  > "$parser_root/rust-toolchain.toml"
parser_cargo="$work/parser-cargo"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'exit 0' > "$parser_cargo"
chmod +x "$parser_cargo"
CARGO="$parser_cargo" COLORFUL_HOME="$work/parser-home" \
  bash "$parser_root/scripts/install-local.sh" >/dev/null ||
  fail "installer rejected policy-valid Rust channel whitespace"

echo "smoke-test-install-local passed."
