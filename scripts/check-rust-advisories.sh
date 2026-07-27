#!/usr/bin/env bash
# Scan every Git-tracked Cargo workspace against the RustSec advisory database.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" == "--root" && $# -eq 2 ]]; then
  root="$(cd "$2" && pwd)"
elif (( $# != 0 )); then
  printf 'usage: scripts/check-rust-advisories.sh [--root DIR]\n' >&2
  exit 2
fi

fail() {
  printf 'Rust advisory check failed: %s\n' "$*" >&2
  exit 1
}

command -v cargo >/dev/null 2>&1 ||
  fail "cargo is required"
command -v cargo-deny >/dev/null 2>&1 ||
  fail "cargo-deny is required"
command -v python3 >/dev/null 2>&1 ||
  fail "python3 is required"
command -v git >/dev/null 2>&1 ||
  fail "git is required"

excluded_directories=(.git node_modules target vendor)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

discover_manifests() {
  git -C "$root" ls-files -z |
    python3 -c '
import os
import pathlib
import sys

repository = pathlib.Path(sys.argv[1]).resolve()
excluded_directories = set(sys.argv[2:])

for raw_path in sys.stdin.buffer.read().split(b"\0"):
    if not raw_path:
        continue
    relative = pathlib.PurePosixPath(os.fsdecode(raw_path))
    if (
        relative.name == "Cargo.toml"
        and excluded_directories.isdisjoint(relative.parts)
    ):
        manifest = (repository / relative).resolve(strict=True)
        try:
            manifest.relative_to(repository)
        except ValueError:
            raise SystemExit(
                f"first-party manifest is outside the repository: {manifest}"
            )
        print(manifest)
' "$root" "${excluded_directories[@]}"
}

workspace_manifest_for() {
  local manifest="$1"
  cargo locate-project \
    --workspace \
    --manifest-path "$manifest" \
    --message-format json |
    python3 -c '
import json
import pathlib
import sys

repository = pathlib.Path(sys.argv[1]).resolve()
workspace_manifest = pathlib.Path(json.load(sys.stdin)["root"]).resolve()
try:
    workspace_manifest.relative_to(repository)
except ValueError:
    raise SystemExit(
        f"first-party workspace manifest is outside the repository: {workspace_manifest}"
    )

if not workspace_manifest.is_file():
    raise SystemExit(f"workspace manifest does not exist: {workspace_manifest}")
print(workspace_manifest)
' "$root"
}

manifest_candidates="$tmp/manifest-candidates"
workspace_manifests="$tmp/workspace-manifests"
discover_manifests >"$manifest_candidates"
if [[ ! -s "$manifest_candidates" ]]; then
  fail "no first-party Cargo manifests discovered"
fi
while IFS= read -r manifest; do
  workspace_manifest_for "$manifest"
done <"$manifest_candidates" | sort -u >"$workspace_manifests"

while IFS= read -r manifest; do
  relative_manifest="${manifest#"$root"/}"
  printf 'Checking locked Rust advisories for %s\n' "$relative_manifest"
  cargo-deny \
    --manifest-path "$manifest" \
    --locked \
    check advisories
done <"$workspace_manifests"

count="$(wc -l <"$workspace_manifests" | tr -d ' ')"
printf 'check-rust-advisories passed: %s workspace(s)\n' "$count"
