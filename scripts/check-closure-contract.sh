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

closing_keyword_pattern='\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #[0-9]+'

pr_body_closes_an_issue() {
  grep -qiE "$closing_keyword_pattern" <<<"$1"
}

commit_has_closing_keyword() {
  grep -qiE "$closing_keyword_pattern" <<<"$1"
}

run_self_test() {
  local failures=0

  pr_body_closes_an_issue "Closes #42" ||
    { echo "self-test failed: expected 'Closes #42' to match" >&2; failures=$((failures + 1)); }
  pr_body_closes_an_issue "This fixes #7 for good" ||
    { echo "self-test failed: expected 'fixes #7' to match" >&2; failures=$((failures + 1)); }
  pr_body_closes_an_issue "Resolves #123." ||
    { echo "self-test failed: expected 'Resolves #123' to match" >&2; failures=$((failures + 1)); }
  if pr_body_closes_an_issue "See #42 for context"; then
    echo "self-test failed: 'See #42' must not match a closing reference" >&2
    failures=$((failures + 1))
  fi
  if pr_body_closes_an_issue "no issue reference here at all"; then
    echo "self-test failed: a body with no reference must not match" >&2
    failures=$((failures + 1))
  fi

  commit_has_closing_keyword "feat: add thing (Closes #9)" ||
    { echo "self-test failed: expected a commit closing keyword to be caught" >&2; failures=$((failures + 1)); }
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

  local body
  body="$(gh pr view "$pr" --repo "$repo" --json body -q .body)"
  if ! pr_body_closes_an_issue "$body"; then
    echo "PR #$pr's description does not contain a closing reference" \
      "(Closes/Fixes/Resolves #NN). Add one to the PR body — see" \
      "CONTRIBUTING.md 'Commits and Pull Requests'." >&2
    exit 1
  fi

  local bad=0
  while IFS= read -r msg; do
    [[ -z "$msg" ]] && continue
    if commit_has_closing_keyword "$msg"; then
      echo "Commit message uses a closing keyword; that belongs on the PR" \
        "body only (use 'Refs #NN' in commits instead): $msg" >&2
      bad=1
    fi
  done < <(gh pr view "$pr" --repo "$repo" --json commits \
    -q '.commits[] | (.messageHeadline + " " + .messageBody)')

  if [[ "$bad" -ne 0 ]]; then
    exit 1
  fi

  echo "PR #$pr satisfies the issue-closure contract."
}

main "$@"
