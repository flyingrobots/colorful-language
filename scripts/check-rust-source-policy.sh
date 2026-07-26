#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
exceptions="$root/docs/workflows/rust-source-policy/exceptions.tsv"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

inventory="$tmp/inventory"
exception_roots="$tmp/exception-roots"
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
                print(source.relative_to(repository))
            except ValueError:
                raise SystemExit(
                    f"first-party target is outside the repository: {source}"
                )
' "$root"
}

inventory_manifest "$root/Cargo.toml" >>"$inventory"
inventory_manifest "$root/editors/zed/Cargo.toml" >>"$inventory"
sort -u -o "$inventory" "$inventory"

while IFS=$'\t' read -r crate_root design_record extra; do
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
  if [[ "$design_record" != docs/design/*.md ||
    ! -f "$root/$design_record" ]]; then
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
  if grep -Eq '^#!\[forbid\(unsafe_code\)\][[:space:]]*$' \
    "$root/$crate_root"; then
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
