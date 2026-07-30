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

paths_match_family() {
  local files_json="$1" pattern="$2"
  jq -e --arg pattern "$pattern" \
    'length > 0 and all(.[]; type == "string" and test($pattern))' \
    <<<"$files_json" >/dev/null
}

dependabot_source_family() {
  local files_json="$1"
  if paths_match_family \
    "$files_json" \
    '^\.github/workflows/[^/]+\.(yml|yaml)$'; then
    echo "github-actions"
  elif paths_match_family "$files_json" '^Cargo\.(toml|lock)$'; then
    echo "cargo-root"
  elif paths_match_family \
    "$files_json" \
    '^editors/zed/Cargo\.(toml|lock)$'; then
    echo "cargo-zed"
  elif paths_match_family \
    "$files_json" \
    '^(Cargo\.toml|fuzz/Cargo\.(toml|lock))$'; then
    echo "cargo-fuzz"
  elif paths_match_family \
    "$files_json" \
    '^(package\.json|package-lock\.json)$'; then
    echo "npm-root"
  elif paths_match_family \
    "$files_json" \
    '^editors/vscode/(package\.json|package-lock\.json)$'; then
    echo "npm-vscode"
  else
    return 1
  fi
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

  local pr_data title body author
  pr_data="$(
    gh pr view "$pr" \
      --repo "$repo" \
      --json title,body,author,changedFiles,files,commits
  )"
  title="$(jq -r '.title // ""' <<<"$pr_data")"
  body="$(jq -r '.body // ""' <<<"$pr_data")"
  author="$(jq -r '.author.login // ""' <<<"$pr_data")"

  if commit_has_closing_keyword "$title"; then
    echo "PR #$pr's title contains a closing keyword; that belongs on the PR body description only: $title" >&2
    exit 1
  fi

  local count
  count="$(count_closed_issues "$body")"
  if [[ "$author" == "app/dependabot" ]]; then
    if ! jq -e '
      (.changedFiles | type == "number") and
      (.changedFiles >= 0) and
      (.changedFiles == (.changedFiles | floor)) and
      (.files | type == "array") and
      all(.files[]; .path | type == "string")
    ' <<<"$pr_data" >/dev/null; then
      echo "E_CLOSURE_DEPENDABOT_FILES: PR #$pr returned malformed" \
        "changed-file metadata" >&2
      exit 1
    fi
    local files_json changed_files returned_files
    files_json="$(jq -c '[.files[].path]' <<<"$pr_data")"
    changed_files="$(jq -r '.changedFiles' <<<"$pr_data")"
    returned_files="$(jq -r '.files | length' <<<"$pr_data")"
    if [[ "$changed_files" -ne "$returned_files" ]]; then
      echo "E_CLOSURE_DEPENDABOT_FILES: PR #$pr file inventory is incomplete:" \
        "received $returned_files of $changed_files changed paths" >&2
      exit 1
    fi
    local dependabot_family path_summary
    if ! dependabot_family="$(dependabot_source_family "$files_json")"; then
      path_summary="$(
        jq -r \
          'if length == 0 then "<none>" else .[0:8] | join(", ") end' \
          <<<"$files_json"
      )"
      echo "E_CLOSURE_DEPENDABOT_PATH: PR #$pr paths do not fit one" \
        "reviewed dependency source: $path_summary" >&2
      exit 1
    fi
    if [[ "$count" -gt 1 ]]; then
      echo "PR #$pr's description may contain at most one unique" \
        "issue-closing reference for Dependabot, found: $count" >&2
      exit 1
    fi
  elif [[ "$count" -ne 1 ]]; then
    echo "PR #$pr's description must contain exactly one unique issue-closing reference" \
      "(Closes/Fixes/Resolves #NN or Closes/Fixes/Resolves owner/repo#NN), found: $count" >&2
    exit 1
  fi

  local commit_data
  commit_data="$(
    jq -c \
      '.commits[] |
       {oid: .oid, message: (.messageHeadline + " " + .messageBody)}' \
      <<<"$pr_data"
  )"

  local bad=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local msg
    msg="$(jq -r .message <<< "$line")"

    # Skip checking the bootstrap commit and pre-existing commits created before the policy change.
    if [[ "$msg" =~ ^"docs: make the slice PR the single issue-closure point" || \
          "$msg" =~ ^"docs: name the planned/failing/passing commit convention" || \
          "$msg" =~ ^"ci: add a non-blocking PR size report excluding generated files" || \
          "$msg" =~ ^"ci: run the version-compatibility matrix" || \
          "$msg" =~ ^"docs: changelog entries for the derivation description fix" || \
          "$msg" =~ ^"ci: run the generated-IR drift check in CI and release-prep" || \
          "$msg" =~ ^"ci: wire the link and citation checkers into CI" || \
          "$msg" =~ ^"ci: wire the install-local.sh smoke test into CI" || \
          "$msg" =~ ^"perf: replace unsubstantiated performance claims" || \
          "$msg" =~ ^"feat(ir-witness): real runtime validation in the TS leg" ]]; then
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

  if [[ "$author" == "app/dependabot" ]]; then
    echo "PR #$pr satisfies the Dependabot closure contract" \
      "for $dependabot_family."
  else
    echo "PR #$pr satisfies the issue-closure contract."
  fi
}

main "$@"
