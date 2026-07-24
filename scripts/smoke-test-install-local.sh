#!/usr/bin/env bash
# Smoke test for scripts/install-local.sh (DIST-4a): installs into a fresh,
# temporary COLORFUL_HOME, verifies `bin/colorful --version`, reruns to prove
# the documented "re-run to upgrade" path is idempotent, and asserts the
# real $HOME/.colorful-language is never touched by any of it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
real_home_default="$HOME/.colorful-language"

fail() {
  echo "smoke-test-install-local failed: $*" >&2
  exit 1
}

# snapshot_real_home: record whether the real default COLORFUL_HOME exists
# and, if so, its bin/colorful mtime -- so we can prove afterward that
# nothing in this test touched it, without deleting or overwriting
# something that might be a real developer install.
snapshot_real_home() {
  if [[ -e "$real_home_default" ]]; then
    echo "existed:$(stat -f '%m' "$real_home_default/bin/colorful" 2>/dev/null || stat -c '%Y' "$real_home_default/bin/colorful" 2>/dev/null || echo "no-binary")"
  else
    echo "absent"
  fi
}

before="$(snapshot_real_home)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tmp_home="$work/colorful-home"

echo "Installing into a temporary COLORFUL_HOME ($tmp_home)..."
COLORFUL_HOME="$tmp_home" bash "$root/scripts/install-local.sh" >/dev/null

[[ -x "$tmp_home/bin/colorful" ]] || fail "expected $tmp_home/bin/colorful to exist and be executable"

version_output="$("$tmp_home/bin/colorful" --version)"
[[ "$version_output" == colorful\ * ]] || fail "expected 'colorful --version' to report a version, got: $version_output"
echo "OK: first install reports '$version_output'"

echo "Re-running install-local.sh against the same COLORFUL_HOME (idempotence)..."
COLORFUL_HOME="$tmp_home" bash "$root/scripts/install-local.sh" >/dev/null

[[ -x "$tmp_home/bin/colorful" ]] || fail "expected $tmp_home/bin/colorful to still exist after rerun"
version_output_2="$("$tmp_home/bin/colorful" --version)"
[[ "$version_output_2" == "$version_output" ]] ||
  fail "expected the rerun to report the same version ('$version_output'), got: $version_output_2"
echo "OK: rerun is idempotent, still reports '$version_output_2'"

after="$(snapshot_real_home)"
[[ "$before" == "$after" ]] ||
  fail "the real $real_home_default changed during this test (before: $before, after: $after)"
echo "OK: the real $real_home_default was not touched"

echo "smoke-test-install-local passed."
