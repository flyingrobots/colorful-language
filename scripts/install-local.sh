#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLORFUL_HOME="${COLORFUL_HOME:-"$HOME/.colorful-language"}"
CARGO="${CARGO:-cargo}"

mkdir -p "$COLORFUL_HOME"

"$CARGO" install \
  --path "$ROOT/crates/colorful-cli" \
  --root "$COLORFUL_HOME" \
  --force

cat <<EOF

Installed colorful to:
  $COLORFUL_HOME/bin/colorful

Add this directory to PATH before running downstream tools:
  export PATH="$COLORFUL_HOME/bin:\$PATH"

Verify:
  colorful --version

Re-run this script after pulling new Colorful commits to upgrade the local CLI.
EOF
