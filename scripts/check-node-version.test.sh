#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  printf 'check-node-version self-test failed: %s\n' "$*" >&2
  exit 1
}

expected="$(tr -d '[:space:]' < "$root/.node-version")"
if grep -F "$expected" "$root/scripts/check-node-version.test.sh" >/dev/null; then
  fail "self-test duplicates the .node-version authority"
fi

make_node() {
  local version="$1"
  printf '#!/usr/bin/env bash\nprintf '"'"'%s\\n'"'"' '"'"'v%s'"'"'\n' "$version" > "$work/node"
  chmod +x "$work/node"
}

off_policy="0.0.0"
if [[ "$off_policy" == "$expected" ]]; then
  off_policy="0.0.1"
fi

make_node "$off_policy"
if PATH="$work:$PATH" bash "$root/scripts/check-node-version.sh" \
  >"$work/off-policy.out" 2>"$work/off-policy.err"; then
  fail "off-policy Node was accepted"
fi
grep -F "expected Node $expected, found $off_policy" \
  "$work/off-policy.err" >/dev/null ||
  fail "off-policy rejection did not report expected and actual versions"

make_node "$expected"
PATH="$work:$PATH" bash "$root/scripts/check-node-version.sh" \
  >"$work/pinned.out" 2>"$work/pinned.err" ||
  fail "pinned Node was rejected"
grep -F "Node $expected matches .node-version" "$work/pinned.out" >/dev/null ||
  fail "pinned Node success did not name the selected version"

echo "check-node-version self-test passed"
