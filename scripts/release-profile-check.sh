#!/usr/bin/env bash
# Validate the repo-local release profile and the files it names. This is a
# deliberately boring shell check so CI can enforce the profile without yq.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  printf 'release profile check failed: %s\n' "$*" >&2
  exit 1
}

profile=".continuum/release.yml"
[[ -f "$profile" ]] || fail "$profile is missing"

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
[[ -n "$workspace_version" ]] || fail "Cargo.toml workspace.package.version is missing"

require_file() {
  [[ -e "$1" ]] || fail "profile names missing path $1"
}

require_profile_text() {
  grep -Fq "$1" "$profile" || fail "profile is missing required text: $1"
}

require_profile_text "schema: 1"
require_profile_text "name: colorful-language"
require_profile_text "owner: flyingrobots"
require_profile_text "tag_format: \"v{version}\""
require_profile_text "release_branch_format: \"release/v{version}\""
require_profile_text "milestone_format: \"v{version}\""
require_profile_text "field: workspace.package.version"
require_profile_text "trigger: tag_push"

for path in \
  Cargo.toml \
  Cargo.lock \
  CHANGELOG.md \
  README.md \
  ROADMAP.md \
  AGENTS.md \
  CONTRIBUTING.md \
  docs/DOCUMENTATION_STANDARDS.md \
  docs/RELEASING.md \
  docs/topics \
  docs/workflows \
  .github/workflows/ci.yml \
  .github/workflows/release.yml
do
  require_file "$path"
done

for path in \
  Cargo.toml \
  Cargo.lock \
  CHANGELOG.md \
  README.md \
  ROADMAP.md \
  AGENTS.md \
  CONTRIBUTING.md \
  docs/DOCUMENTATION_STANDARDS.md \
  docs/RELEASING.md \
  docs/topics/ \
  docs/workflows/
do
  require_profile_text "$path"
done

for crate in \
  colorful-core \
  colorful-lexicon \
  colorful-parse \
  colorful-ir \
  colorful-lint \
  colorful-cli \
  colorful-lsp
do
  require_profile_text "$crate"
  if ! grep -Fq "name = \"$crate\"" Cargo.lock; then
    fail "Cargo.lock does not contain package $crate"
  fi
done

for script in \
  scripts/release-profile-check.sh \
  scripts/release-prep.sh \
  scripts/release-preflight.sh
do
  require_file "$script"
done

printf 'Release profile OK for workspace version %s\n' "$workspace_version"
