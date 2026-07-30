#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

cat >"$fixture_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

json_field=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--json" ]]; then
    json_field="$argument"
    break
  fi
  previous="$argument"
done

case "$json_field" in
  title)
    printf '%s\n' 'build(deps-dev): bump @types/node'
    ;;
  body)
    printf '%s\n' 'Bumps the vscode dependency group.'
    ;;
  author)
    printf '%s\n' 'app/dependabot'
    ;;
  files)
    printf '%s\n' \
      'editors/vscode/package.json' \
      'editors/vscode/package-lock.json'
    ;;
  commits)
    printf '%s\n' \
      '{"oid":"0123456789abcdef","message":"build(deps-dev): bump @types/node"}'
    ;;
  *)
    printf 'unexpected gh fixture arguments: %s\n' "$*" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$fixture_dir/gh"

PATH="$fixture_dir:$PATH" \
  bash "$script_dir/check-closure-contract.sh" \
    --pr 195 \
    --repo flyingrobots/colorful-language
