#!/usr/bin/env bash
# Proves the documented colorful-CLI version floor for downstream (Graft/
# jedit) discovery, by actually building and running the tagged releases
# rather than asserting the docs are correct. See
# docs/topics/downstream-consumers/{README.md,test-plan.md} (CONSUMER-5).
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
fixture_text="The quick fox runs. She writes carefully."

cleanup() {
  for tag in v0.2.1 v0.3.0; do
    git -C "$root" worktree remove --force "$work/$tag" >/dev/null 2>&1 || true
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
  cargo install --locked --path "$work/$tag/crates/colorful-cli" \
    --root "$work/prefix-$tag" --force >/dev/null
}

# probe_version <tag>
#
# Runs `colorful --version` and reports what actually happened, without
# assuming success -- v0.2.1 is expected to fail this probe.
probe_version() {
  local tag="$1"
  local out exit_code
  set +e
  out="$("$work/prefix-$tag/bin/colorful" --version 2>&1)"
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
  printf '%s' "$fixture_text" | "$work/prefix-$tag/bin/colorful" ir - >"$work/ir-$tag.json"
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
  validate_ir_self_consistent v0.2.1 project
  validate_ir_self_consistent v0.3.0 project
  assert_open_class_kind_presence

  echo "version-compat-matrix passed: the provable colorful --version" \
    "discovery floor is >= 0.3.0, not >= 0.2.1."
}

main "$@"
