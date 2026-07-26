#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
expected="$(tr -d '[:space:]' < "$root/.node-version")"

if ! command -v node >/dev/null 2>&1; then
  echo "check-node-version: node is required" >&2
  exit 1
fi

actual="$(node --version)"
actual="${actual#v}"
if [[ "$actual" != "$expected" ]]; then
  printf 'check-node-version: expected Node %s, found %s\n' \
    "$expected" "$actual" >&2
  exit 1
fi

printf 'check-node-version: Node %s matches .node-version\n' "$actual"
