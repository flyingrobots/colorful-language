#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

cat >"$fixture_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

files="${FIXTURE_FILES:-}"
changed_files="${FIXTURE_CHANGED_FILES:-}"
jq -cn \
  --arg title "${FIXTURE_TITLE:-chore: fixture pull request}" \
  --arg body "${FIXTURE_BODY:-}" \
  --arg author "${FIXTURE_AUTHOR:-flyingrobots}" \
  --arg files "$files" \
  --arg changed_files "$changed_files" \
  --arg commit_message "${FIXTURE_COMMIT_MESSAGE:-chore: fixture commit}" \
  '
    ($files | if length == 0 then [] else split("|") end) as $paths |
    {
      title: $title,
      body: $body,
      author: {login: $author},
      changedFiles:
        (if $changed_files == ""
         then ($paths | length)
         elif $changed_files == "malformed"
         then $changed_files
         else ($changed_files | tonumber)
         end),
      files: ($paths | map({path: .})),
      commits: [{
        oid: "0123456789abcdef",
        messageHeadline: $commit_message,
        messageBody: ""
      }]
    }
  '
EOF
chmod +x "$fixture_dir/gh"

failures=0
cases=0

run_case() {
  local name="$1"
  local expected="$2"
  local author="$3"
  local body="$4"
  local files="$5"
  local commit_message="${6:-chore: fixture commit}"
  local changed_files="${7:-}"
  local expected_output="${8:-}"
  local title="${9:-chore: fixture pull request}"
  local output case_status

  cases=$((cases + 1))
  set +e
  output="$(
    PATH="$fixture_dir:$PATH" \
      FIXTURE_AUTHOR="$author" \
      FIXTURE_BODY="$body" \
      FIXTURE_FILES="$files" \
      FIXTURE_COMMIT_MESSAGE="$commit_message" \
      FIXTURE_CHANGED_FILES="$changed_files" \
      FIXTURE_TITLE="$title" \
      bash "$script_dir/check-closure-contract.sh" \
        --pr 195 \
        --repo flyingrobots/colorful-language 2>&1
  )"
  case_status=$?
  set -e

  if [[ "$expected" == "pass" && "$case_status" -ne 0 ]]; then
    printf 'not ok - %s: expected success, got %s: %s\n' \
      "$name" "$case_status" "$output" >&2
    failures=$((failures + 1))
  elif [[ "$expected" == "fail" && "$case_status" -eq 0 ]]; then
    printf 'not ok - %s: expected failure\n' "$name" >&2
    failures=$((failures + 1))
  elif [[
    -n "$expected_output" &&
    "$output" != *"$expected_output"*
  ]]; then
    printf 'not ok - %s: expected output containing %s, got: %s\n' \
      "$name" "$expected_output" "$output" >&2
    failures=$((failures + 1))
  else
    printf 'ok - %s\n' "$name"
  fi
}

run_case \
  "human slice with one closure" \
  pass \
  flyingrobots \
  "Closes #265" \
  "crates/colorful-cli/src/lib.rs"
run_case \
  "ordinary automation still needs one closure" \
  pass \
  "app/example-bot" \
  "Closes #265" \
  "docs/README.md"
run_case \
  "ordinary automation without a closure" \
  fail \
  "app/example-bot" \
  "" \
  "editors/vscode/package.json|editors/vscode/package-lock.json" \
  "" \
  "" \
  "found: 0"
run_case \
  "human slice without a closure" \
  fail \
  flyingrobots \
  "" \
  "crates/colorful-cli/src/lib.rs" \
  "" \
  "" \
  "found: 0"
run_case \
  "Dependabot-looking title cannot spoof author identity" \
  fail \
  flyingrobots \
  "" \
  "editors/vscode/package.json|editors/vscode/package-lock.json" \
  "" \
  "" \
  "found: 0" \
  "build(deps-dev): bump @types/node"

run_case \
  "GitHub Actions update family" \
  pass \
  "app/dependabot" \
  "" \
  ".github/workflows/ci.yml|.github/workflows/security.yml"
run_case \
  "root Cargo update family" \
  pass \
  "app/dependabot" \
  "" \
  "Cargo.toml|Cargo.lock"
run_case \
  "Zed Cargo update family" \
  pass \
  "app/dependabot" \
  "" \
  "editors/zed/Cargo.toml|editors/zed/Cargo.lock"
run_case \
  "fuzz Cargo update family with workspace companion" \
  pass \
  "app/dependabot" \
  "" \
  "Cargo.toml|fuzz/Cargo.lock"
run_case \
  "root Node update family" \
  pass \
  "app/dependabot" \
  "" \
  "package.json|package-lock.json"
run_case \
  "VS Code Node update family" \
  pass \
  "app/dependabot" \
  "" \
  "editors/vscode/package.json|editors/vscode/package-lock.json"
run_case \
  "Dependabot update with one closure" \
  pass \
  "app/dependabot" \
  "Closes #265" \
  "editors/vscode/package.json|editors/vscode/package-lock.json"

run_case \
  "Dependabot unrelated product path" \
  fail \
  "app/dependabot" \
  "" \
  "crates/colorful-core/src/lib.rs" \
  "" \
  "" \
  "E_CLOSURE_DEPENDABOT_PATH"
run_case \
  "Dependabot mixed update families" \
  fail \
  "app/dependabot" \
  "" \
  "Cargo.lock|editors/vscode/package-lock.json" \
  "" \
  "" \
  "E_CLOSURE_DEPENDABOT_PATH"
run_case \
  "Dependabot incomplete file inventory" \
  fail \
  "app/dependabot" \
  "" \
  "Cargo.toml|Cargo.lock" \
  "" \
  "3" \
  "E_CLOSURE_DEPENDABOT_FILES"
run_case \
  "Dependabot malformed file inventory" \
  fail \
  "app/dependabot" \
  "" \
  "Cargo.toml|Cargo.lock" \
  "" \
  "malformed" \
  "E_CLOSURE_DEPENDABOT_FILES"
run_case \
  "Dependabot multiple issue closures" \
  fail \
  "app/dependabot" \
  "Closes #265 and fixes #263" \
  "Cargo.toml|Cargo.lock" \
  "" \
  "" \
  "at most one"
run_case \
  "Dependabot commit-level closure" \
  fail \
  "app/dependabot" \
  "" \
  "Cargo.toml|Cargo.lock" \
  "chore: update dependencies (Closes #265)" \
  "" \
  "Commit message uses a closing keyword"
run_case \
  "Dependabot empty file inventory" \
  fail \
  "app/dependabot" \
  "" \
  "" \
  "" \
  "" \
  "E_CLOSURE_DEPENDABOT_PATH"

if [[ "$failures" -ne 0 ]]; then
  printf '%s of %s closure-contract fixture cases failed\n' \
    "$failures" "$cases" >&2
  exit 1
fi

printf 'check-closure-contract fixtures passed: %s cases\n' "$cases"
