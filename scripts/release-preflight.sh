#!/usr/bin/env bash
# Final manual preflight for creating a public release tag from main.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  printf 'release preflight failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 1 ]]; then
  fail "usage: scripts/release-preflight.sh vX.Y.Z"
fi

target_tag="$1"
case "$target_tag" in
  v[0-9]*.[0-9]*.[0-9]*)
    ;;
  *)
    fail "target tag must look like vX.Y.Z"
    ;;
esac

target_version="${target_tag#v}"
branch="$(git branch --show-current)"
[[ "$branch" == "main" ]] || fail "run from main, not $branch"

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short >&2
  fail "working tree is dirty"
fi

git fetch origin main --tags

head_sha="$(git rev-parse HEAD)"
origin_main_sha="$(git rev-parse origin/main)"
[[ "$head_sha" == "$origin_main_sha" ]] || fail "HEAD is not aligned with origin/main"

if git rev-parse -q --verify "refs/tags/$target_tag" >/dev/null; then
  fail "local tag $target_tag already exists"
fi

if git ls-remote --exit-code --tags origin "refs/tags/$target_tag" >/dev/null 2>&1; then
  fail "remote tag $target_tag already exists"
fi

workspace_version="$(
  awk '
    /^\[workspace.package\]$/ { in_package = 1; next }
    /^\[/ { in_package = 0 }
    in_package && /^version = / {
      gsub(/"/, "", $3)
      print $3
      exit
    }
  ' Cargo.toml
)"
[[ "$workspace_version" == "$target_version" ]] || fail "workspace version $workspace_version does not match $target_version"

grep -Fq "## [$target_version]" CHANGELOG.md || fail "CHANGELOG.md has no $target_version entry"
[[ -f "docs/goalposts/$target_tag/release.md" ]] || fail "missing docs/goalposts/$target_tag/release.md"
[[ -f "docs/goalposts/$target_tag/verification.md" ]] || fail "missing docs/goalposts/$target_tag/verification.md"

bash scripts/release-prep.sh

echo "RELEASE PREFLIGHT PASSED for $target_tag at $(git rev-parse --short HEAD)"
