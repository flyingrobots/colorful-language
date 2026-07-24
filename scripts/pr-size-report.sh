#!/usr/bin/env bash
# Reports a pull request's diff size as an advisory signal only -- see
# CONTRIBUTING.md "Reviewable Slices". This script must never fail the
# build: it always exits 0, regardless of size. Generated files and release
# packets are excluded from the count so they never inflate the signal.
set -euo pipefail

EXCLUDE_PATHSPECS=(
  ':(exclude)crates/colorful-ir/src/generated/**'
  ':(exclude)crates/colorful-ir/ts/**'
  ':(exclude)docs/goalposts/**'
  ':(exclude)Cargo.lock'
  ':(exclude)editors/vscode/package-lock.json'
)

DEFAULT_THRESHOLD=800

# changed_line_count <repo-dir> <base-ref> <head-ref>
#
# Sum of added+removed lines between base and head, excluding
# EXCLUDE_PATHSPECS. Binary files (numstat prints "-") are not counted.
changed_line_count() {
  local repo="$1" base="$2" head="$3"
  git -C "$repo" diff --numstat "$base...$head" -- . "${EXCLUDE_PATHSPECS[@]}" |
    awk '$1 ~ /^[0-9]+$/ { added += $1 } $2 ~ /^[0-9]+$/ { removed += $2 } END { print added + removed + 0 }'
}

# report <changed-lines> <threshold>
#
# Prints the human-readable report and, over threshold, a GitHub Actions
# notice annotation. Always returns 0.
report() {
  local changed="$1" threshold="$2"
  echo "Changed lines (excluding generated files and release packets): $changed"
  if [[ "$changed" -gt "$threshold" ]]; then
    echo "::notice title=Large PR::This PR changes $changed lines (excluding" \
      "generated files and release packets), over the advisory threshold of" \
      "$threshold. Consider splitting along transport/domain/evidence/docs" \
      "seams (CONTRIBUTING.md 'Reviewable Slices'). Informational only --" \
      "this does not block merge."
  else
    echo "Within the advisory threshold ($threshold lines)."
  fi
  return 0
}

run_self_test() {
  local failures=0
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  git -C "$tmp" init -q -b main
  git -C "$tmp" config user.email test@example.com
  git -C "$tmp" config user.name test

  mkdir -p "$tmp/crates/colorful-ir/src/generated" "$tmp/src"
  echo "line" >"$tmp/src/real.rs"
  echo "line" >"$tmp/crates/colorful-ir/src/generated/gen.rs"
  git -C "$tmp" add -A
  git -C "$tmp" commit -q -m base

  git -C "$tmp" checkout -q -b topic-branch

  # A big generated-file change must not count toward the total.
  for i in $(seq 1 50); do echo "generated line $i"; done >"$tmp/crates/colorful-ir/src/generated/gen.rs"
  # A small real change must count.
  printf 'line\nanother line\n' >"$tmp/src/real.rs"
  git -C "$tmp" add -A
  git -C "$tmp" commit -q -m topic-branch

  local count
  count="$(changed_line_count "$tmp" main topic-branch)"
  if [[ "$count" -gt 5 ]]; then
    echo "self-test failed: expected the 50-line generated-file diff to be excluded, got count=$count" >&2
    failures=$((failures + 1))
  fi

  local under_output over_output
  under_output="$(report 3 "$DEFAULT_THRESHOLD")"
  if grep -q "::notice" <<<"$under_output"; then
    echo "self-test failed: a small diff must not emit a notice annotation" >&2
    failures=$((failures + 1))
  fi

  over_output="$(report 5000 "$DEFAULT_THRESHOLD")"
  if ! grep -q "::notice title=Large PR::" <<<"$over_output"; then
    echo "self-test failed: a large diff must emit a notice annotation" >&2
    failures=$((failures + 1))
  fi

  # report must never signal failure, even when far over threshold.
  report 999999 "$DEFAULT_THRESHOLD" >/dev/null
  if [[ $? -ne 0 ]]; then
    echo "self-test failed: report() must always return 0" >&2
    failures=$((failures + 1))
  fi

  if [[ "$failures" -ne 0 ]]; then
    echo "$failures self-test assertion(s) failed" >&2
    exit 1
  fi
  echo "self-test passed"
}

usage() {
  cat >&2 <<'EOF'
Usage:
  pr-size-report.sh --self-test
  pr-size-report.sh <base-ref> [<head-ref>]
EOF
  exit 2
}

main() {
  if [[ "${1:-}" == "--self-test" ]]; then
    run_self_test
    exit 0
  fi
  [[ $# -ge 1 ]] || usage

  local base="$1" head="${2:-HEAD}"
  local threshold="${PR_SIZE_WARNING_THRESHOLD:-$DEFAULT_THRESHOLD}"
  local changed
  changed="$(changed_line_count "$(pwd)" "$base" "$head")"
  report "$changed" "$threshold"
  # Never fail: this signal is informational only.
  exit 0
}

main "$@"
