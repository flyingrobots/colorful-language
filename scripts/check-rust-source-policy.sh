#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" == "--root" && $# -eq 2 ]]; then
  root="$(cd "$2" && pwd)"
elif (( $# != 0 )); then
  printf 'usage: bash scripts/check-rust-source-policy.sh [--root DIR]\n' >&2
  exit 2
fi
exceptions="$root/docs/workflows/rust-source-policy/exceptions.tsv"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

inventory="$tmp/inventory"
exception_roots="$tmp/exception-roots"
excluded_directories=(.git node_modules target vendor)
: >"$inventory"
: >"$exception_roots"

inventory_manifest() {
  local manifest="$1"
  cargo metadata \
    --manifest-path "$manifest" \
    --no-deps \
    --locked \
    --format-version 1 |
    python3 -c '
import json
import pathlib
import sys

repository = pathlib.Path(sys.argv[1]).resolve()
excluded_directories = set(sys.argv[2:])
production_kinds = {
    "bin",
    "cdylib",
    "dylib",
    "lib",
    "proc-macro",
    "rlib",
    "staticlib",
}
metadata = json.load(sys.stdin)
for package in metadata["packages"]:
    for target in package["targets"]:
        if production_kinds.intersection(target["kind"]):
            source = pathlib.Path(target["src_path"]).resolve()
            try:
                relative_source = source.relative_to(repository)
            except ValueError:
                raise SystemExit(
                    f"first-party target is outside the repository: {source}"
                )
            if excluded_directories.isdisjoint(relative_source.parts):
                print(relative_source)
' "$root" "${excluded_directories[@]}"
}

discover_manifests() {
  python3 - "$root" "${excluded_directories[@]}" <<'PY'
import os
import pathlib
import sys

repository = pathlib.Path(sys.argv[1]).resolve()
excluded_directories = set(sys.argv[2:])

for directory, child_directories, files in os.walk(repository, topdown=True):
    child_directories[:] = sorted(
        child
        for child in child_directories
        if child not in excluded_directories
    )
    if "Cargo.toml" in files:
        print(pathlib.Path(directory, "Cargo.toml"))
PY
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

crate_forbids_unsafe() {
  local crate_root="$1"
  python3 - "$crate_root" <<'PY'
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
if source.startswith("\ufeff"):
    source = source[1:]

position = 0
length = len(source)

if source.startswith("#!") and not source.startswith("#!["):
    newline = source.find("\n")
    position = length if newline == -1 else newline + 1

while True:
    while position < length and source[position].isspace():
        position += 1
    if source.startswith("//", position):
        newline = source.find("\n", position + 2)
        position = length if newline == -1 else newline + 1
        continue
    if source.startswith("/*", position):
        depth = 1
        position += 2
        while depth:
            if position >= length:
                raise SystemExit("unterminated block comment in crate preamble")
            if source.startswith("/*", position):
                depth += 1
                position += 2
            elif source.startswith("*/", position):
                depth -= 1
                position += 2
            else:
                position += 1
        continue
    break

policy = "#![forbid(unsafe_code)]"
raise SystemExit(0 if source.startswith(policy, position) else 1)
PY
}

design_record_is_valid() {
  local design_record="$1"
  python3 - "$root" "$design_record" <<'PY'
import pathlib
import sys

repository = pathlib.Path(sys.argv[1]).resolve()
record_text = sys.argv[2]
record = pathlib.Path(record_text)
if (
    record.is_absolute()
    or not record_text.startswith("docs/design/")
    or not record_text.endswith(".md")
):
    raise SystemExit(1)

try:
    design_root = (repository / "docs/design").resolve(strict=True)
    candidate = (repository / record).resolve(strict=True)
    candidate.relative_to(design_root)
except (OSError, ValueError):
    raise SystemExit(1)

raise SystemExit(0 if candidate.is_file() else 1)
PY
}

manifest_candidates="$tmp/manifest-candidates"
workspace_manifests="$tmp/workspace-manifests"
discover_manifests >"$manifest_candidates"
if [[ ! -s "$manifest_candidates" ]]; then
  printf 'no first-party Cargo manifests discovered\n' >&2
  exit 1
fi
while IFS= read -r manifest; do
  workspace_manifest_for "$manifest"
done <"$manifest_candidates" | sort -u >"$workspace_manifests"

while IFS= read -r manifest; do
  inventory_manifest "$manifest"
done <"$workspace_manifests" >>"$inventory"
sort -u -o "$inventory" "$inventory"

while IFS=$'\t' read -r crate_root design_record extra ||
  [[ -n "$crate_root" || -n "$design_record" || -n "$extra" ]]; do
  if [[ -z "$crate_root" || "$crate_root" == \#* ]]; then
    continue
  fi
  if [[ -z "$design_record" || -n "$extra" ]]; then
    printf 'invalid source-policy exception row: %s\n' "$crate_root" >&2
    exit 1
  fi
  if ! grep -Fqx "$crate_root" "$inventory"; then
    printf 'source-policy exception names an uninventoried root: %s\n' \
      "$crate_root" >&2
    exit 1
  fi
  if ! design_record_is_valid "$design_record"; then
    printf 'source-policy exception has no design record: %s -> %s\n' \
      "$crate_root" "$design_record" >&2
    exit 1
  fi
  if grep -Fqx "$crate_root" "$exception_roots"; then
    printf 'duplicate source-policy exception: %s\n' "$crate_root" >&2
    exit 1
  fi
  printf '%s\n' "$crate_root" >>"$exception_roots"
done <"$exceptions"

failures=0
while IFS= read -r crate_root; do
  if crate_forbids_unsafe "$root/$crate_root"; then
    if grep -Fqx "$crate_root" "$exception_roots"; then
      printf 'source-policy exception is stale: %s already forbids unsafe code\n' \
        "$crate_root" >&2
      failures=$((failures + 1))
    fi
    continue
  fi
  if grep -Fqx "$crate_root" "$exception_roots"; then
    design_record="$(
      awk -F '\t' -v crate_root="$crate_root" \
        '$1 == crate_root { print $2 }' "$exceptions"
    )"
    printf 'source-policy exception: %s -> %s\n' \
      "$crate_root" "$design_record"
    continue
  fi
  printf 'missing #![forbid(unsafe_code)]: %s\n' "$crate_root" >&2
  failures=$((failures + 1))
done <"$inventory"

if ((failures != 0)); then
  printf 'check-rust-source-policy failed: %d unprotected root(s)\n' \
    "$failures" >&2
  exit 1
fi

count="$(wc -l <"$inventory" | tr -d ' ')"
printf 'check-rust-source-policy passed: %s production root(s), all protected.\n' \
  "$count"
