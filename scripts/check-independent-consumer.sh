#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
package_root="$root/consumers/independent-ir-report"
work="$(mktemp -d)"
copy="$work/repository/consumers/independent-ir-report"
graft_generated="$work/repository/consumers/generated"

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

mkdir -p "$copy"
tar -C "$package_root" --exclude=node_modules -cf - . |
  tar -C "$copy" -xf -
mkdir -p "$graft_generated"
cp \
  "$root/consumers/generated/syntax-admission-v1.mjs" \
  "$graft_generated/syntax-admission-v1.mjs"

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

echo "check-independent-consumer passed: Node-only proof is clean-room reproducible"
