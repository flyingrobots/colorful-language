#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLORFUL_HOME="${COLORFUL_HOME:-"$HOME/.colorful-language"}"
CARGO="${CARGO:-cargo}"

mkdir -p "$COLORFUL_HOME"

toolchain="$(
  awk '
    /^[[:space:]]*channel[[:space:]]*=[[:space:]]*"[^"]+"[[:space:]]*(#.*)?$/ {
      value = $0
      sub(/^[^"]*"/, "", value)
      sub(/".*$/, "", value)
      print value
      exit
    }
  ' "$ROOT/rust-toolchain.toml"
)"
if [[ -z "$toolchain" ]]; then
  echo "install-local: rust-toolchain.toml has no exact channel" >&2
  exit 1
fi

if [[ "$CARGO" == "cargo" ]]; then
  "$CARGO" "+$toolchain" install \
    --path "$ROOT/crates/colorful-cli" \
    --root "$COLORFUL_HOME" \
    --force
else
  RUSTUP_TOOLCHAIN="$toolchain" "$CARGO" install \
    --path "$ROOT/crates/colorful-cli" \
    --root "$COLORFUL_HOME" \
    --force
fi

cat <<EOF

Installed colorful to:
  $COLORFUL_HOME/bin/colorful

Add this directory to PATH before running downstream tools:
  export PATH="$COLORFUL_HOME/bin:\$PATH"

Verify:
  colorful --version

Re-run this script after pulling new Colorful commits to upgrade the local CLI.
EOF
