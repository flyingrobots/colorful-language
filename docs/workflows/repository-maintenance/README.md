# Repository Maintenance

Repository maintenance keeps dependency and intake policy visible, reviewable,
and executable. This page describes only the maintenance controls that exist in
the repository today.

## Structured intake

The issue chooser keeps actionable work in two forms:

- bug reports require an exact version, environment, minimal reproduction, and
  observed and expected behavior; and
- feature proposals require a user problem, observable outcome, and alternatives
  considered.

Issues and milestones are the delivery authority. Discussions are not a
supported intake channel because no maintainer response commitment has been
made. The repository may retain GitHub's default Discussion categories, but the
issue chooser does not advertise Q&A or Ideas as supported routes. The
maintenance gate rejects both Discussion claims and direct `/discussions`
links in issue-form Markdown.

## Public repository and deployment posture

[`.github/repository-profile.yml`](../../../.github/repository-profile.yml)
records the public and deployment authority. The repository homepage points to
the maintained README at
`https://github.com/flyingrobots/colorful-language#readme`.

No GitHub deployment environment exists. `@flyingrobots` owns release
execution, custody of `CARGO_REGISTRY_TOKEN`, `VSCE_PAT`, and `OVSX_PAT`, and
rollback decisions. Create a protected `release` environment only when a real
release is scheduled and all three credentials can move atomically; do not
create an empty environment before that threshold.

Credential and release-evidence inventories are unordered exact sets.
Reordering is harmless; missing, unexpected, or duplicate entries fail the
maintenance gate.

Before publication, the owner must run:

```bash
bash scripts/release-prep.sh
npm --prefix editors/vscode run smoke:package
```

After editor publication, verify the exact local package bytes:

```bash
node scripts/verify-editor-publication.mjs \
  --vsix target/editor-smoke/colorful-language-X.Y.Z.vsix \
  --version X.Y.Z
```

Rollback ownership includes stopping the tag workflow, removing or unpublishing
the affected registry version where the registry permits it, marking the GitHub
release affected, and following the tested recovery commands in
[`docs/RELEASING.md`](../../RELEASING.md). A release witness records the actor,
environment, exact artifact digests, public URLs, and recovery outcome.

The authenticated metadata witness is deliberately separate from the offline
maintenance gate:

```bash
gh api repos/flyingrobots/colorful-language \
  --jq '{homepage,has_discussions,topics}'
gh api repos/flyingrobots/colorful-language/environments \
  --jq '[.environments[].name]'
```

## Rust dependency policy

Run the locked dependency-policy scan from the repository root:

```bash
bash scripts/check-rust-dependency-policy.sh
```

The command requires Git, Cargo, `cargo-deny`, and Python 3. It discovers and
deduplicates every Git-tracked Cargo workspace while pruning `.git`,
`node_modules`, `target`, and `vendor` directories. Untracked scratch manifests
do not affect the policy inventory. One checked-in `deny.toml` applies to the
current inventory:

- the root Rust workspace at `Cargo.toml`; and
- the standalone Zed adapter at `editors/zed/Cargo.toml`; and
- the standalone fuzz workspace at `fuzz/Cargo.toml`; and
- the validator-complexity policy fixture workspace at
  `scripts/fixtures/validator-complexity/Cargo.toml`.

Every check uses its workspace lockfile. Vulnerability and unsoundness
advisories fail through the evolving RustSec database. Production and
development dependencies with licenses outside the reviewed SPDX allowlist
fail, as do Git dependencies and registries other than the public crates.io
index. The NCSA license is allowed because the pinned `libfuzzer-sys` runtime
bundles LLVM's libFuzzer under that OSI-approved license; this is a shared SPDX
allowance, not a per-crate exception. There are no active advisory or
per-crate license exceptions. The checker self-test adds another standalone
workspace to prove that a future workspace cannot silently escape the
inventory.

The RustSec database is an external, evolving oracle. A newly published
advisory can therefore make an unchanged lockfile fail. The maintainer owns
triage: verify the advisory and dependency path, prefer the narrowest compatible
upgrade, and do not add a bare ignore. If no compatible fix exists, add the
RustSec ID to `deny.toml` and one matching record to
`.github/rust-advisory-exceptions.yml`. The record must name one GitHub owner,
the reviewed reason, and an explicit removal trigger. The policy checker rejects
missing, duplicate, incomplete, or stale records and any mismatch between the
two files.

## Workflow security policy

Install the reviewed analyzer release, then run the deterministic fixtures and
live repository scan:

```bash
cargo install --locked zizmor --version 1.28.0
node --test scripts/check-workflow-security.test.mjs
node scripts/check-workflow-security.mjs
```

The runner verifies the installed version before invoking it and terminates
either analyzer subprocess after 60 seconds with a stable error category. It
generates the analyzer configuration from
[`.github/workflow-security-policy.yml`](../../../.github/workflow-security-policy.yml),
uses offline workflow-only collection, and rejects every low-or-higher finding.
Run `actionlint .github/workflows/*.yml` separately for syntax and schema
validation; the two tools have distinct responsibilities.

## Hosted security gates

The `Security` workflow runs for pull requests, pushes to `main`, every Monday,
and manual recovery:

- the Rust dependency-policy job installs `cargo-deny` 0.18.9 with a
  full-SHA-pinned installer, then runs the discovery self-test and live locked
  scan;
- dependency review runs only on pull requests and rejects newly introduced
  moderate-or-higher vulnerabilities across runtime, development, and unknown
  scopes, plus detected licenses outside the reviewed cross-ecosystem allowlist.
  The lock-backed editor package toolchain adds the permissive Artistic 2.0,
  BSD 2-Clause, BSD 3-Clause, CC BY 3.0, CC0 1.0, and Python 2.0 SPDX licenses.
  Exact-version package exceptions cover `@azu/style-format`'s WTFPL license,
  the VSCE signing runtime's installation-and-use terms, the Open VSX
  publisher's EPL 2.0 license, and the scanner's composite-license
  classifications for `typed-rest-client` and `xmlbuilder`. These are
  development-only dependencies: the VSIX package command uses
  `--no-dependencies`, and `.vscodeignore` excludes `node_modules`. A
  replacement release does not inherit an exception. A dependency whose
  license GitHub cannot identify is reported but cannot be failed by that
  action;
- CodeQL uses its supported build-free analysis for both Rust and
  JavaScript/TypeScript, then uploads one result category per language; and
- workflow security installs `zizmor` 1.28.0 with the full-SHA-pinned installer,
  then runs deterministic unsafe-workflow fixtures and scans every checked-in
  workflow offline with the auditor persona and all low-or-higher findings
  blocking; hung analyzer subprocesses fail closed after 60 seconds.

The same repository-policy mutation tests run in the required documentation job
and release preparation. Release preparation also reruns the Rust self-test and
live dependency scan, the workflow-security fixture suite, `actionlint` for
workflow syntax and schema, and the pinned security analyzer for security
semantics. The mainline ruleset requires the Rust policy, dependency-review,
both CodeQL language contexts, and workflow-security analysis, so these hosted
failures block the normal merge path. The structural checker also rejects an
`if` guard or `continue-on-error` setting that could suppress any mandatory
security job or step.

The workflow-security job grants only `contents: read` and disables checkout
credential persistence. Its versioned policy fixes the analyzer identity,
offline workflow-only invocation, finding thresholds, and exception metadata.
Three exceptions allow `CARGO_REGISTRY_TOKEN`, `VSCE_PAT`, and `OVSX_PAT` only
at their named crates.io or editor-publication steps while a protected release
environment remains unconfigured. The repository profile assigns credential,
release, and rollback ownership to `@flyingrobots`. Each exception names its
owner, rationale, and removal trigger, and each selector may occur once across
all workflows. Changing a secret location, broadening an exception path,
weakening a threshold, or drifting the hosted installation from policy fails
the deterministic maintenance suite.

## Updates and ownership

`.github/dependabot.yml` remains the only dependency-update scheduler. Its
weekly groups preserve separate rollback boundaries for GitHub Actions, the
root, Zed, and fuzz Cargo workspaces, root Node evidence tooling, and the VS
Code adapter.

`CODEOWNERS` assigns the repository to `@flyingrobots`. This is ownership
metadata, not a second-human gate: the checked-in and live mainline ruleset
requires zero approvals and does not require code-owner review. Enable either
requirement only after a second trusted human can satisfy it.

## Roadmap inventory

`ROADMAP.md` gives each open non-epic `slice` issue one invisible primary marker:

```markdown
<!-- roadmap-primary: active #NN #MM -->
```

The accepted dispositions are:

- `active` for an execution-track slice;
- `parked` for an explicit experiment or backlog disposition; and
- `delivered` for a retained primary reference to a closed slice.

Ordinary issue links remain non-owning cross-references, so historical and epic
links do not inflate the inventory. Do not delete completed roadmap history:
change its primary marker to `delivered`. When opening or moving a slice, add or
move its one marker in the same change. When a pull request closes a slice,
change that marker to `delivered` before merge.

The same offline structure gate requires exactly one canonical
`## Architecture accountability` H2, matched case-sensitively with no more than
three leading spaces and no closing-hash sequence, and exactly one `Mechanism`
table, then requires each
displayed mechanism identity to appear exactly once. A header-shaped line is
not enough: the table requires a delimiter row with the same column count,
every delimiter cell requires at least three hyphens with only optional edge
colons, and at least one non-empty data row follows. LF and CRLF roadmaps have
the same structural result and line addresses. The first cell in every
canonical row is pipe-delimited on both sides, and the row has no more than
three leading spaces. Valid no-leading-pipe Markdown headers and continuing
data rows are refused explicitly instead of being silently ignored, whether a
header delimiter is compact, space-padded, or tab-padded. Only contiguous
canonical rows are authoritative, so indented code, CommonMark fences, and
HTML comments cannot stand in for the table. Backtick fence openers whose info
strings contain a backtick are treated as visible source, while tilde-fence
info strings may contain backticks. A
multiline comment is non-authoritative even when its opener follows visible
text on the same line. Plain text, ASCII-punctuation escapes, and inline code
are normalized to their NFC displayed identity, including table-delimiter
escapes inside code spans. An inline-code span closes only on a backtick run
exactly as long as its opener, so shorter and longer internal runs remain
displayed content. Character-reference-shaped source outside inline code is
rejected; the displayed character must be written directly so source and
rendered identities cannot diverge. Skipped blocks also terminate the table
even without a separating blank line. Empty cells, invalid escapes, and other
mechanism-cell Markdown are rejected as noncanonical. A repeated heading,
table, or mechanism fails with both source locations, while distinct moonshot
mechanisms remain independent entries. Leaving the canonical section does not
end the structural scan: a later H2 cannot hide a second accountability
authority.

Run the deterministic structure and fixture gates without network access:

```bash
node --test scripts/check-roadmap-inventory.test.mjs
node scripts/check-roadmap-inventory.mjs
```

To reconcile against current GitHub state, run the authenticated witness:

```bash
node scripts/check-roadmap-inventory.mjs \
  --live \
  --repo flyingrobots/colorful-language
```

On a branch whose pull request closes an issue, pass `--closing-pr NUMBER`.
The checker reads GitHub's closing-issue references and evaluates the intended
post-merge state. The required documentation job does this automatically for
pull requests. A separate weekly and manually dispatchable repository-
maintenance workflow checks default-branch state without a pull-request
transition. GitHub authentication and availability are therefore explicit
hosted oracles, not hidden prerequisites of the local correctness gate.

## Rust coverage ratchet

The required `Rust coverage` job runs the same workspace surface used by the
normal Rust gate, with all features and all targets:

```bash
cargo llvm-cov \
  --workspace \
  --all-features \
  --all-targets \
  --locked
```

CI pins Rust 1.97.1 and `cargo-llvm-cov` 0.8.7, emits a summary-only LLVM JSON
report, renders a browsable HTML report from the same profiles, and retains both
as the `rust-coverage` artifact for 14 days. The machine report is checked
against [`.github/coverage-policy.json`](../../../.github/coverage-policy.json)
by [`check-coverage-policy.mjs`](../../../scripts/check-coverage-policy.mjs)
before the required job can pass.

The current workspace baseline was measured at source commit
`b3522acb71775f9cd5a05b4579163252aba96352` with the pinned command above:

| Surface | Measured lines | Measured coverage | Minimum | Maximum uncovered |
| --- | ---: | ---: | ---: | ---: |
| Workspace | 6,287 / 6,688 | 94.00% | 92% | 401 |
| `crates/colorful-cli/src/cli/args.rs` | 74 / 83 | 89.16% | 88% | 9 |
| `crates/colorful-cli/src/cli/color.rs` | 65 / 71 | 91.55% | 90% | 6 |
| `crates/colorful-cli/src/cli/diagnose.rs` | 129 / 169 | 76.33% | 75% | 40 |
| `crates/colorful-cli/src/cli/lint.rs` | 65 / 70 | 92.86% | 92% | 5 |
| `crates/colorful-cli/src/main.rs` | 7 / 7 | 100% | 100% | 0 |
| `crates/colorful-lsp/src/lib.rs` | 499 / 500 | 99.80% | 99% | 1 |
| `crates/colorful-lsp/src/main.rs` | 61 / 64 | 95.31% | 94% | 3 |
| `crates/colorful-vale/src/output.rs` | 235 / 279 | 84.23% | 68% | 44 |
| `crates/colorful-vale/src/process.rs` | 225 / 265 | 84.91% | 80% | 40 |

The 92% workspace acceptance floor is deliberately below the earlier 92.16%
observation and the fresh 94.00% measurement. The uncovered-line ceilings are
the ratchet: adding an uncovered workspace or monitored transport line fails
even while the percentage remains above its conservative floor. All authored
and generated Rust source remains in the report; the policy has no exclusions.

This measurement raises the workspace uncovered-line ceiling from 274 to 401
through an explicit reviewed policy change. Since the prior baseline, the
workspace added 957 measured lines and 830 covered lines. The optional Vale
adapter accounts for 908 measured lines, 789 of them covered, while its JSON
normalization and child-process owners now have their own per-file floors and
uncovered-line ceilings. The final review evidence added 125 measured lines
under the all-target test configuration and covered 116 of them. Its
output-parser counter kept that file at 44 uncovered lines; the synchronized
completion hook raised the process owner's ceiling by nine lines explicitly,
while the bounded executable-busy retry added 41 fully covered lines. The 92%
acceptance floor did not move; the new 94.00% measurement remains 2.00
percentage points above it.

The CLI crate root is a declarative facade and therefore has no executable lines
in LLVM's report. Its per-file transport floors follow the four private
implementation modules plus the binary entrypoint; moving a responsibility
requires updating the exact inventory and recording a fresh pinned report. The
Vale output and process floors separately prevent the optional external-engine
boundary from borrowing coverage gains elsewhere in the workspace.

When coverage improves, raise the recorded measurements and lower uncovered-
line ceilings from a fresh pinned report. Lowering a percentage floor or
increasing an uncovered-line ceiling requires an explicit policy and reference
change with a reviewed rationale. The checker never rewrites the policy from a
failing report, so new code cannot silently redefine its own baseline.

## Public API doctests

The public `Parser`, `Annotator`, `Analyzer`, IR producer, and vocabulary
boundaries each carry one concise, runnable rustdoc example. The normal Rust CI
job and release preparation run them explicitly:

```bash
cargo test --doc --workspace --locked
```

[`check-public-api-doctests.mjs`](../../../scripts/check-public-api-doctests.mjs)
guards the five named examples and the visible CI command. Its mutation suite
rejects a missing or duplicate example marker, a missing or misspelled workspace
doctest command, execution guards, and non-blocking error handling on the Rust
job or doctest step. Expected source or workflow inputs that cannot be read fail
with `E_API_DOCTEST_INPUT`, their repository-relative path, empty standard
output, and no raw Node stack; unexpected programmer errors remain uncaught.
Rustdoc compilation remains the authority for whether the examples actually
build and run.

## Evidence

The requirements, exact oracles, and mutation coverage live in the
[repository-maintenance test plan](test-plan.md).
