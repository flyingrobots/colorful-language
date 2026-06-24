#!/usr/bin/env bash
# Prove that every publishable crate compiles from its packaged tarball, not just
# from the workspace checkout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

echo "Checking package-local contract copies..."
for contract in syntax.v1.graphql vocabulary.v1.graphql vocabulary.v1.json; do
  if ! cmp -s "contracts/colorful/$contract" "crates/colorful-ir/contracts/$contract"; then
    printf 'contract copy is stale: crates/colorful-ir/contracts/%s\n' "$contract" >&2
    printf 'refresh it from contracts/colorful/%s before packaging\n' "$contract" >&2
    exit 1
  fi
done

packages=(
  colorful-core
  colorful-lexicon
  colorful-parse
  colorful-ir
  colorful-lint
  colorful-cli
  colorful-lsp
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

target="$work/target"
pkgroot="$work/packaged-workspace"
mkdir -p "$pkgroot"

package_args=(--locked --no-verify --target-dir "$target")
if [[ "${COLORFUL_PACKAGE_ALLOW_DIRTY:-}" == "1" ]]; then
  package_args+=(--allow-dirty)
fi

internal_deps_for() {
  case "$1" in
    colorful-core)
      ;;
    colorful-lexicon | colorful-parse)
      echo "colorful-core"
      ;;
    colorful-ir)
      echo "colorful-core colorful-lexicon colorful-parse"
      ;;
    colorful-lint)
      echo "colorful-core colorful-lexicon colorful-parse"
      ;;
    colorful-cli)
      echo "colorful-core colorful-lexicon colorful-parse colorful-ir colorful-lint"
      ;;
    colorful-lsp)
      echo "colorful-core colorful-lexicon colorful-parse colorful-ir colorful-lint"
      ;;
    *)
      printf 'unknown crate %s\n' "$1" >&2
      exit 1
      ;;
  esac
}

echo "Packaging crates without verification..."
for crate in "${packages[@]}"; do
  echo "  package $crate"
  crate_args=("${package_args[@]}")
  for dep in $(internal_deps_for "$crate"); do
    crate_args+=(--config "patch.crates-io.$dep.path=\"$root/crates/$dep\"")
  done
  cargo package -p "$crate" "${crate_args[@]}" >/dev/null
done

echo "Extracting package tarballs..."
for crate in "${packages[@]}"; do
  mapfile -t crates < <(find "$target/package" -maxdepth 1 -type f -name "$crate-*.crate" | sort)
  if [[ "${#crates[@]}" -ne 1 ]]; then
    printf 'expected exactly one package tarball for %s, found %s\n' "$crate" "${#crates[@]}" >&2
    exit 1
  fi
  tar -xzf "${crates[0]}" -C "$pkgroot"
done

declare -A package_dirs
for crate in "${packages[@]}"; do
  mapfile -t dirs < <(find "$pkgroot" -maxdepth 1 -type d -name "$crate-*" | sort)
  if [[ "${#dirs[@]}" -ne 1 ]]; then
    printf 'expected exactly one extracted package for %s, found %s\n' "$crate" "${#dirs[@]}" >&2
    exit 1
  fi
  package_dirs["$crate"]="$(basename "${dirs[0]}")"
done

{
  echo "[workspace]"
  echo 'resolver = "2"'
  echo "members = ["
  for crate in "${packages[@]}"; do
    printf '  "%s",\n' "${package_dirs[$crate]}"
  done
  echo "]"
  echo
  echo "[patch.crates-io]"
  for crate in "${packages[@]}"; do
    printf '"%s" = { path = "%s" }\n' "$crate" "${package_dirs[$crate]}"
  done
} > "$pkgroot/Cargo.toml"

echo "Checking extracted package workspace..."
cargo generate-lockfile --manifest-path "$pkgroot/Cargo.toml"
cargo check --manifest-path "$pkgroot/Cargo.toml" --workspace --all-targets --locked

echo "PACKAGE WITNESS PASSED"
