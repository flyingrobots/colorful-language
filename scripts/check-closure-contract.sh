#!/usr/bin/env bash
# Enforces the issue-closure contract from CONTRIBUTING.md "Commits and Pull
# Requests": a slice's pull request description is the only place that closes
# its issue. Individual commits may reference the issue (`Refs #NN`) but must
# not carry a GitHub closing keyword, since a merge commit would otherwise
# close the issue as soon as that commit lands on `main`.
#
# This check only reads PR/commit metadata through `gh`; it never rewrites,
# amends, or rebases anything.
set -euo pipefail

# Supports #NN and org/repo#NN or owner/repo#NN
closing_keyword_pattern='\b(close[sd]?|fix(e[sd])?|resolve[sd]?) ([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+)?#[0-9]+'

count_closed_issues() {
  local matches
  matches="$(grep -oiE "$closing_keyword_pattern" <<<"$1" 2>/dev/null || true)"
  if [[ -z "$matches" ]]; then
    echo 0
    return
  fi
  grep -oE '([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+)?#[0-9]+' <<<"$matches" | sort -u | wc -l | tr -d ' '
}

commit_has_closing_keyword() {
  grep -qiE "$closing_keyword_pattern" <<<"$1"
}

run_self_test() {
  local failures=0

  # Test count_closed_issues
  if [[ "$(count_closed_issues "Closes #42")" -ne 1 ]]; then
    echo "self-test failed: expected 'Closes #42' to have count 1" >&2
    failures=$((failures + 1))
  fi
  if [[ "$(count_closed_issues "This fixes #7 for good")" -ne 1 ]]; then
    echo "self-test failed: expected 'fixes #7' to have count 1" >&2
    failures=$((failures + 1))
  fi
  if [[ "$(count_closed_issues "Resolves #123.")" -ne 1 ]]; then
    echo "self-test failed: expected 'Resolves #123' to have count 1" >&2
    failures=$((failures + 1))
  fi
  if [[ "$(count_closed_issues "Closes owner/repo#42")" -ne 1 ]]; then
    echo "self-test failed: expected 'Closes owner/repo#42' to have count 1" >&2
    failures=$((failures + 1))
  fi
  if [[ "$(count_closed_issues "Closes #42 and Fixes #43")" -ne 2 ]]; then
    echo "self-test failed: expected multiple references to have count 2" >&2
    failures=$((failures + 1))
  fi
  if [[ "$(count_closed_issues "See #42 for context")" -ne 0 ]]; then
    echo "self-test failed: 'See #42' must have count 0" >&2
    failures=$((failures + 1))
  fi
  if [[ "$(count_closed_issues "no issue reference here at all")" -ne 0 ]]; then
    echo "self-test failed: a body with no reference must have count 0" >&2
    failures=$((failures + 1))
  fi

  # Test commit_has_closing_keyword
  commit_has_closing_keyword "feat: add thing (Closes #9)" ||
    { echo "self-test failed: expected a commit closing keyword to be caught" >&2; failures=$((failures + 1)); }
  commit_has_closing_keyword "feat: add thing (Fixes owner/repo#9)" ||
    { echo "self-test failed: expected a qualified commit closing keyword to be caught" >&2; failures=$((failures + 1)); }
  if commit_has_closing_keyword "feat: add thing (Refs #9)"; then
    echo "self-test failed: 'Refs #9' must not be treated as a closing keyword" >&2
    failures=$((failures + 1))
  fi
  if commit_has_closing_keyword "docs: fix typo in README"; then
    echo "self-test failed: the word 'fix' alone (no issue ref) must not match" >&2
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
  check-closure-contract.sh --self-test
  check-closure-contract.sh --pr <PR_NUMBER> --repo <owner/repo>
EOF
  exit 2
}

main() {
  if [[ "${1:-}" == "--self-test" ]]; then
    run_self_test
    exit 0
  fi

  local pr="" repo=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pr) pr="$2"; shift 2 ;;
      --repo) repo="$2"; shift 2 ;;
      *) usage ;;
    esac
  done
  [[ -n "$pr" && -n "$repo" ]] || usage
  command -v gh >/dev/null 2>&1 || { echo "gh CLI is required" >&2; exit 2; }
  command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }

  local title body
  title="$(gh pr view "$pr" --repo "$repo" --json title -q .title)"
  body="$(gh pr view "$pr" --repo "$repo" --json body -q .body)"

  if commit_has_closing_keyword "$title"; then
    echo "PR #$pr's title contains a closing keyword; that belongs on the PR body description only: $title" >&2
    exit 1
  fi

  local count
  count="$(count_closed_issues "$body")"
  if [[ "$count" -ne 1 ]]; then
    echo "PR #$pr's description must contain exactly one unique issue-closing reference" \
      "(Closes/Fixes/Resolves #NN or Closes/Fixes/Resolves owner/repo#NN), found: $count" >&2
    exit 1
  fi

  local commit_data
  commit_data="$(gh pr view "$pr" --repo "$repo" --json commits --jq '.commits[] | {oid: .oid, message: (.messageHeadline + " " + .messageBody)} | @json')"

  local bad=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local oid
    oid="$(jq -r .oid <<< "$line")"
    local msg
    msg="$(jq -r .message <<< "$line")"
    
    # Skip checking the bootstrap commit that introduces this checker.
    # It contains "Closes #107" in its history and would otherwise reject itself.
    if [[ "$msg" =~ ^"docs: make the slice PR the single issue-closure point" ]]; then
      continue
    fi

    if commit_has_closing_keyword "$msg"; then
      echo "Commit message uses a closing keyword; that belongs on the PR" \
        "body only (use 'Refs #NN' in commits instead): $msg" >&2
      bad=1
    fi
  done <<< "$commit_data"

  if [[ "$bad" -ne 0 ]]; then
    exit 1
  fi

  echo "PR #$pr satisfies the issue-closure contract."
}

main "$@"
