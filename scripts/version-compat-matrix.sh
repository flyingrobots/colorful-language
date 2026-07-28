#!/usr/bin/env bash
# Proves the documented colorful-CLI version floor for downstream (Graft/
# jedit) discovery and the provenance of the independent-consumer fixtures by
# actually building and running the tagged releases. See
# docs/topics/downstream-consumers/{README.md,test-plan.md} (CONSUMER-5) and
# docs/topics/ir/test-plan.md (IR-19).
#
# Finding this script proves: the real v0.2.1 binary has no `--version` flag
# at all (it was added five commits after the v0.2.1 tag, in
# "fix(cli): support downstream Colorful discovery", and first ships in
# v0.3.0). A version-probing discovery mechanism cannot detect v0.2.1 as
# compatible, because the probe itself fails against it. The provable floor
# is therefore `>= 0.3.0`, not `>= 0.2.1`.
#
# Tags are read-only inputs: this script only ever adds detached
# `git worktree`s and removes them again. It never modifies, re-tags, or
# rebuilds v0.2.1 or v0.3.0 in place.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
fixture_root="$root/consumers/independent-ir-report/fixtures"
fixture_text="😀 the book I book rooms the fast river connects fast 2."
update_fixtures=false

if [[ "$#" -gt 1 ]] || [[ "$#" -eq 1 && "$1" != "--update-fixtures" ]]; then
  echo "usage: scripts/version-compat-matrix.sh [--update-fixtures]" >&2
  exit 2
fi
if [[ "$#" -eq 1 ]]; then
  update_fixtures=true
fi

cleanup() {
  for tag in v0.2.1 v0.3.0; do
    if [[ -d "$work/$tag" ]]; then
      git -C "$root" worktree remove "$work/$tag" >/dev/null
    fi
  done
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "version-compat-matrix failed: $*" >&2
  exit 1
}

build_tag() {
  local tag="$1"
  git -C "$root" worktree add --detach "$work/$tag" "$tag" >/dev/null
  local packages=(-p colorful-cli)
  if [[ "$tag" == "v0.3.0" ]]; then
    packages+=(-p colorful-lsp)
  fi
  CARGO_TARGET_DIR="$work/target-$tag" cargo build \
    --manifest-path "$work/$tag/Cargo.toml" \
    --release \
    --locked \
    "${packages[@]}" >/dev/null
}

colorful_bin() {
  local tag="$1"
  printf '%s/target-%s/release/colorful' "$work" "$tag"
}

# probe_version <tag>
#
# Runs `colorful --version` and reports what actually happened, without
# assuming success -- v0.2.1 is expected to fail this probe.
probe_version() {
  local tag="$1"
  local out exit_code
  set +e
  out="$("$(colorful_bin "$tag")" --version 2>&1)"
  exit_code=$?
  set -e
  printf '%s\t%s\n' "$exit_code" "$out"
}

assert_version_probe_fails() {
  local tag="$1"
  local result exit_code
  result="$(probe_version "$tag")"
  exit_code="${result%%$'\t'*}"
  [[ "$exit_code" -ne 0 ]] ||
    fail "expected $tag's --version probe to fail (it predates --version support), but it exited 0"
  echo "OK: $tag --version fails as expected (exit $exit_code) -- discovery cannot rely on this release"
}

assert_version_probe_reports() {
  local tag="$1"
  local expected="colorful ${tag#v}"
  local result exit_code out
  result="$(probe_version "$tag")"
  exit_code="${result%%$'\t'*}"
  out="${result#*$'\t'}"
  [[ "$exit_code" -eq 0 ]] || fail "expected $tag's --version probe to succeed, exited $exit_code: $out"
  [[ "$out" == "$expected" ]] || fail "expected $tag --version to report '$expected', got '$out'"
  echo "OK: $tag --version -> $out"
}

emit_ir() {
  local tag="$1"
  printf '%s' "$fixture_text" | "$(colorful_bin "$tag")" ir - >"$work/ir-$tag.json"
}

emit_ansi() {
  local tag="$1"
  printf '%s' "$fixture_text" |
    env -u NO_COLOR "$(colorful_bin "$tag")" - >"$work/ansi-$tag.txt"
}

# validate_ir_self_consistent <tag>
#
# Runs that tag's own reference consumer against its own IR output. Neither
# v0.2.1 nor v0.3.0 has the full `validateArtifact` admission gate (that's
# part of the unreleased CONSUMER-6 hardening pass); both eras export
# `project`, which itself calls verifyContentHash and verifyVocabularyHash
# before projecting, so that is the era-appropriate check for both.
validate_ir_self_consistent() {
  local tag="$1" fn="$2"
  node --input-type=module -e "
    import { $fn } from '$work/$tag/consumers/graft-projection.mjs';
    import { readFileSync } from 'node:fs';
    const buf = Buffer.from(process.argv[1], 'utf8');
    const ir = JSON.parse(readFileSync('$work/ir-$tag.json', 'utf8'));
    $fn(buf, ir);
    console.log('valid: $tag IR is a self-consistent colorful.syntax/v1 artifact ($fn)');
  " "$fixture_text"
}

assert_open_class_kind_presence() {
  if grep -q '"openClassKind"' "$work/ir-v0.2.1.json"; then
    fail "v0.2.1 must never emit openClassKind (it predates that axis)"
  fi
  if ! grep -q '"openClassKind"' "$work/ir-v0.3.0.json"; then
    fail "v0.3.0 must emit openClassKind for at least one token"
  fi
  echo "OK: openClassKind absent in v0.2.1, present in v0.3.0 (additive field)"
}

write_profile() {
  local tag="$1"
  local output="$work/profile-$tag.json"
  local commit
  commit="$(git -C "$root" rev-parse "$tag^{commit}")"
  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const document = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    const profile = {
      profileVersion: 'colorful.consumer-profile/v1',
      release: process.argv[2],
      commit: process.argv[3],
      contractVersion: document.contractVersion,
      schemaHash: document.schemaHash,
      vocabularyHash: document.vocabularyHash,
      openClassKindField: process.argv[2] === 'v0.3.0',
    };
    writeFileSync(process.argv[4], JSON.stringify(profile, null, 2) + '\\n');
  " "$work/ir-$tag.json" "$tag" "$commit" "$output"
}

capture_lsp() {
  printf '%s' "$fixture_text" >"$work/source.txt"
  node "$root/consumers/independent-ir-report/scripts/capture-lsp.mjs" \
    "$work/target-v0.3.0/release/colorful-lsp" \
    "$work/source.txt" \
    >"$work/lsp-v0.3.0.json"
}

sync_fixture() {
  local generated="$1" committed="$2"
  if "$update_fixtures"; then
    mkdir -p "$(dirname "$committed")"
    cp "$generated" "$committed"
  elif ! cmp -s "$generated" "$committed"; then
    diff -u "$committed" "$generated" || true
    fail "fixture drift: ${committed#"$root/"}"
  fi
}

sync_release_fixtures() {
  printf '%s' "$fixture_text" >"$work/source.txt"
  sync_fixture "$work/source.txt" "$fixture_root/source.txt"

  for tag in v0.2.1 v0.3.0; do
    local release_root="$fixture_root/releases/$tag"
    sync_fixture "$work/ir-$tag.json" "$release_root/ir.json"
    sync_fixture \
      "$work/$tag/contracts/colorful/syntax.v1.graphql" \
      "$release_root/syntax.v1.graphql"
    sync_fixture \
      "$work/$tag/contracts/colorful/vocabulary.v1.json" \
      "$release_root/vocabulary.v1.json"
    sync_fixture "$work/profile-$tag.json" "$release_root/profile.json"
  done

  sync_fixture "$work/ansi-v0.3.0.txt" \
    "$fixture_root/releases/v0.3.0/ansi.txt"
  sync_fixture "$work/lsp-v0.3.0.json" \
    "$fixture_root/releases/v0.3.0/lsp.json"
}

main() {
  command -v cargo >/dev/null 2>&1 || fail "cargo is required"
  command -v node >/dev/null 2>&1 || fail "node is required"

  build_tag v0.2.1
  build_tag v0.3.0

  assert_version_probe_fails v0.2.1
  assert_version_probe_reports v0.3.0

  # colorful ir still exists and still works on v0.2.1 even though a
  # version-probing discovery gate would never reach it -- this is
  # supplementary context, not part of the floor decision.
  emit_ir v0.2.1
  emit_ir v0.3.0
  emit_ansi v0.3.0
  validate_ir_self_consistent v0.2.1 project
  validate_ir_self_consistent v0.3.0 project
  assert_open_class_kind_presence
  write_profile v0.2.1
  write_profile v0.3.0
  capture_lsp
  sync_release_fixtures

  echo "version-compat-matrix passed: the provable colorful --version" \
    "discovery floor is >= 0.3.0, not >= 0.2.1; independent-consumer" \
    "fixtures match both tagged releases."
}

main "$@"
