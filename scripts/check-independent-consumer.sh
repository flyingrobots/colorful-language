#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
package_root="$root/consumers/independent-ir-report"
work="$(mktemp -d)"
copy="$work/independent-ir-report"

cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "check-independent-consumer failed: $*" >&2
  exit 1
}

command -v npm >/dev/null 2>&1 || fail "npm is required"
[[ -f "$package_root/package-lock.json" ]] ||
  fail "independent package lockfile is missing"

node "$package_root/src/measure.mjs" --check

mkdir -p "$copy"
tar -C "$package_root" --exclude=node_modules -cf - . |
  tar -C "$copy" -xf -

[[ ! -e "$copy/node_modules" ]] ||
  fail "clean copy unexpectedly contains ambient node_modules"
if find "$copy" -type l -print -quit | grep -q .; then
  fail "clean copy contains a symlink that could escape the package root"
fi
if find "$copy" \( -name Cargo.toml -o -name target -o -name colorful \) \
  -print -quit | grep -q .; then
  fail "clean copy contains a Rust workspace, build output, or Colorful binary"
fi

(
  cd "$copy"
  npm ci --ignore-scripts
  npm run check
)

echo "check-independent-consumer passed: repository burden and standalone Node proof are reproducible"
