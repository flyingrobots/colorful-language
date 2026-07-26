#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  printf 'check-node-version self-test failed: %s\n' "$*" >&2
  exit 1
}

make_node() {
  local version="$1"
  printf '#!/usr/bin/env bash\nprintf '"'"'%s\\n'"'"' '"'"'v%s'"'"'\n' "$version" > "$work/node"
  chmod +x "$work/node"
}

make_node "20.0.0"
if PATH="$work:$PATH" bash "$root/scripts/check-node-version.sh" \
  >"$work/off-policy.out" 2>"$work/off-policy.err"; then
  fail "off-policy Node was accepted"
fi
grep -F "expected Node 22.23.1, found 20.0.0" "$work/off-policy.err" >/dev/null ||
  fail "off-policy rejection did not report expected and actual versions"

make_node "22.23.1"
PATH="$work:$PATH" bash "$root/scripts/check-node-version.sh" \
  >"$work/pinned.out" 2>"$work/pinned.err" ||
  fail "pinned Node was rejected"
grep -F "Node 22.23.1 matches .node-version" "$work/pinned.out" >/dev/null ||
  fail "pinned Node success did not name the selected version"

echo "check-node-version self-test passed"
