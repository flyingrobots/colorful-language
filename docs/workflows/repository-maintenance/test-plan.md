# Repository Maintenance Test Plan

This plan defines executable evidence for repository intake, dependency
governance, ownership, and security maintenance. GitHub issue
[#152](https://github.com/flyingrobots/colorful-language/issues/152) owns the
broader workflow; the prerequisite advisory remediation is tracked separately
in [#197](https://github.com/flyingrobots/colorful-language/issues/197), and
roadmap-to-issue reconciliation is tracked in
[#187](https://github.com/flyingrobots/colorful-language/issues/187).
Repository metadata, Discussion intake, and deployment ownership are tracked in
[#153](https://github.com/flyingrobots/colorful-language/issues/153).

## Requirements

- **RM-1 — Rust advisory hygiene.** Every committed Cargo workspace must be
  checked from its locked dependency graph. Known vulnerability and unsoundness
  advisories fail closed; an exception must identify one advisory, give a
  reviewed reason, and carry an explicit removal trigger.
- **RM-2 — Rust license and source policy.** Every committed Cargo workspace
  must use one reviewed SPDX allowlist and reject dependency sources outside the
  public crates.io registry unless a narrow exception names its owner and
  removal trigger.
- **RM-3 — Actionable intake.** Bug and feature intake must collect enough
  evidence for a maintainer to act. Discussions must not be advertised as a
  support or design route without an explicit response owner.
- **RM-4 — Dependency change review.** Weekly dependency updates must remain
  grouped by rollback boundary, and every pull request must reject newly
  introduced dependencies with detected disallowed licenses or
  moderate-or-higher known vulnerabilities. An unidentified license must remain
  visible even when the hosted action cannot fail it.
- **RM-5 — Static security analysis.** CodeQL must analyze the repository's
  supported Rust and JavaScript/TypeScript source surfaces on pull requests,
  default-branch pushes, and a weekly schedule.
- **RM-6 — Solo-safe ownership.** Repository ownership must be explicit without
  requiring a non-author or code-owner approval before a second trusted human
  exists.
- **RM-7 — Maintenance policy drift.** The repository must reject malformed or
  weakened intake, ownership, dependency, and security configuration before it
  reaches the hosted workflow.
- **RM-8 — Enforced security results.** Security jobs that claim to reject a
  pull request must be required default-branch checks, not advisory signals.
- **RM-9 — Executable roadmap inventory.** Every open non-epic slice must have
  exactly one explicit primary disposition in the roadmap. Closed slices must
  not remain active, historical delivered references and epic links must remain
  legal, and live GitHub state must be reconciled without making network access
  a hidden prerequisite of the offline correctness gate.
- **RM-10 — Ratcheted Rust coverage.** The same Rust workspace, feature, and
  target surface exercised by the normal CI gate must produce a browsable and
  machine-readable coverage report. A reviewed policy must enforce a
  conservative workspace line floor and explicit binary-transport floors
  without excluding generated source silently or treating a historical
  percentage as current evidence.
- **RM-11 — Public API doctest gate.** Runnable examples for the primary public
  Rust APIs must compile and execute in one visible, unconditional, blocking
  workspace CI step.
- **RM-12 — Workflow security analysis.** Every checked-in GitHub Actions
  workflow must pass one exact, offline workflow-security analyzer in local
  evidence, hosted CI, and release preparation. The analyzer must reject
  persisted checkout credentials and overbroad permissions, run without
  write-capable repository permissions, and derive its identity, invocation,
  and narrow exception configuration from one reviewed policy.
- **RM-13 — Public repository posture.** The maintained repository homepage,
  supported intake surfaces, deployment owner, credential custody, rollback
  responsibility, and environment-creation threshold must be explicit.
  Discussions must not be promoted without an owner commitment, and an empty
  deployment environment must not be created for appearance.
- **RM-14 — Unique architecture accountability.** Every mechanism in the
  roadmap's Architecture Accountability table must have one row, so duplicated
  decisions cannot conceal drift while every distinct moonshot mechanism is
  preserved. The gate must fail closed when the canonical section or table is
  absent and must compare displayed identities without treating examples as
  authoritative rows.

## Cases

- **RM-1a — Root and Zed advisory scan.** _Requirement:_ RM-1. _Behavior:_ one
  repository command scans both the root workspace and the standalone Zed
  adapter with a locked `cargo deny` check that includes advisories. _Oracle:_
  both scans exit zero without a vulnerability, unsoundness, or blanket-ignore
  exception.
  _Evidence type:_ deterministic workspace command wrapper plus the evolving
  RustSec advisory database. _Evidence:_
  `scripts/check-rust-dependency-policy.sh` and
  `scripts/check-rust-dependency-policy.test.sh`; the regression seeded by
  `RUSTSEC-2026-0190` is fixed in `editors/zed/Cargo.lock`. _Status:_
  implemented.
- **RM-2a — Shared Rust license and source policy.** _Requirement:_ RM-2.
  _Behavior:_ the all-workspace dependency scan accepts only the reviewed SPDX
  license set present in the root, Zed, fuzz, and validator-complexity fixture
  lockfiles for production and development dependencies, including the
  OSI-approved NCSA terms bundled by the pinned libFuzzer runtime; it denies
  unknown registries and Git sources and carries no blanket exception.
  _Oracle:_ `cargo deny --locked check licenses sources` exits zero for every
  discovered workspace; mutating dev-dependency coverage, the allowlist, or
  source policy makes the structural checker fail.
  _Evidence type:_ checked-in `cargo-deny` policy, live dependency scan, and
  deterministic mutation test. _Evidence:_ `deny.toml`,
  `scripts/check-rust-dependency-policy.sh`, and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-1b — Automated advisory evidence.** _Requirement:_ RM-1. _Behavior:_ CI
  installs one exact `cargo-deny` version, self-tests workspace discovery, and
  runs the live locked scan; release preparation runs the same self-test and
  live scan. _Oracle:_ the structural checker rejects a floating tool version,
  a missing self-test, or a missing live scan; the hosted and local commands
  exit zero. _Evidence type:_ workflow/configuration mutation tests plus CI and
  release-preparation execution. _Evidence:_
  `.github/workflows/security.yml`, `scripts/release-prep.sh`, and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-1c — Narrow advisory exception parity.** _Requirements:_ RM-1, RM-7.
  _Behavior:_ every ignored RustSec ID has exactly one metadata record with a
  named owner, reviewed reason, and explicit removal trigger; stale metadata,
  duplicate IDs, bare ignores, and incomplete records fail. _Oracle:_ the
  maintenance mutation suite accepts one complete synthetic exception and
  rejects each malformed or mismatched variant with
  `E_RUST_ADVISORY_EXCEPTION`. _Evidence type:_ checked-in empty exception
  registry and deterministic metadata/TOML parity tests. _Evidence:_
  `.github/rust-advisory-exceptions.yml`, `deny.toml`, and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-3a — Reproducible issue forms and routing.** _Requirement:_ RM-3.
  _Behavior:_ the bug form requires reproduction, observed and expected
  behavior, version, and environment; the feature form requires the problem,
  proposed outcome, and alternatives; because Discussions have no supported
  intake owner, the issue chooser exposes no support or design contact link.
  _Oracle:_ malformed or weakened forms and any promoted Discussion route fail
  with stable error categories, while both actionable forms remain directly
  selectable.
  _Evidence type:_ YAML policy checker and deterministic mutation tests.
  _Evidence:_ `.github/ISSUE_TEMPLATE/bug.yml`,
  `.github/ISSUE_TEMPLATE/feature.yml`,
  `.github/ISSUE_TEMPLATE/config.yml`, and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-4a — Coordinated weekly updates and pull-request review.**
  _Requirement:_ RM-4. _Behavior:_ the grouped weekly Dependabot policy from
  issue #151 remains the sole update scheduler for GitHub Actions, the root,
  Zed, and fuzz Cargo workspaces, and both Node workspaces, while a
  pull-request-only dependency-review job rejects moderate-or-higher
  vulnerabilities and detected dependency licenses outside the reviewed SPDX
  allowlist. GitHub reports but cannot fail a dependency whose license it
  cannot identify.
  _Oracle:_ the existing dependency-update checker continues to pass; the
  maintenance checker rejects a weakened severity, license, event, or
  action-pin policy. _Evidence type:_ deterministic configuration tests and
  hosted pull-request workflow. _Evidence:_ `.github/dependabot.yml`,
  `.github/workflows/security.yml`,
  `scripts/check-dependency-update-policy.test.mjs`, and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-4c — Editor package-tool license admission.** _Requirement:_ RM-4.
  _Behavior:_ standard permissive SPDX licenses introduced by the lock-backed
  editor packaging toolchain join the reviewed cross-ecosystem allowlist.
  Scanner-only composite licenses, the restricted VSCE signing runtime, and the
  EPL-licensed Open VSX publisher use exact-version npm package URLs, and no
  packaging-only dependency enters the extension archive. _Oracle:_ the
  maintenance checker rejects a missing, unexpected, or version-broadened
  exception; the package smoke test proves the dependency-free package boundary
  excludes development dependencies. _Evidence type:_
  deterministic policy mutation tests and the packaged-extension witness.
  _Evidence:_ `.github/workflows/security.yml`,
  `scripts/check-repository-maintenance.test.mjs`, and
  `scripts/check-editor-package-smoke.test.mjs`. Tracking: #136. _Status:_
  implemented.
- **RM-4b — Required security contexts.** _Requirements:_ RM-4, RM-5, RM-8.
  _Behavior:_ the live and checked-in mainline rulesets require Rust dependency
  policy, dependency review, both CodeQL language jobs, and pinned workflow-
  security analysis from GitHub Actions application `15368`. _Oracle:_ the
  exact ruleset-payload test rejects an omitted or renamed context, and the
  privileged live checker reports full parity without changing the bypass
  actor. _Evidence type:_ deterministic ruleset test, source-controlled
  manifest, and privileged live API check. _Evidence:_
  `.github/rulesets/mainline.json`,
  `scripts/check-main-ruleset.test.mjs`, and
  `scripts/check-main-ruleset.mjs`. _Status:_ implemented.
- **RM-5a — Useful CodeQL coverage.** _Requirement:_ RM-5. _Behavior:_ one
  advanced CodeQL workflow analyzes Rust and JavaScript/TypeScript with the
  supported build mode on pull requests, default-branch pushes, and weekly
  schedule. _Oracle:_ the maintenance checker rejects omitted languages,
  unsupported events, mutable action references, or a non-`none` build mode;
  both hosted matrix legs upload code-scanning results. _Evidence type:_
  deterministic configuration tests and hosted CodeQL analysis. _Evidence:_
  `.github/workflows/security.yml` and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-6a — Explicit ownership without solo deadlock.** _Requirement:_ RM-6.
  _Behavior:_ `CODEOWNERS` names the current repository owner, while the
  checked-in mainline ruleset continues to require zero approvals and disables
  required code-owner review. _Oracle:_ the maintenance checker rejects missing
  ownership or either approval requirement becoming active. _Evidence type:_
  deterministic policy test plus the existing live-ruleset witness. _Evidence:_
  `.github/CODEOWNERS`, `.github/rulesets/mainline.json`,
  `scripts/check-repository-maintenance.test.mjs`, and
  `scripts/check-main-ruleset.mjs`. _Status:_ implemented.
- **RM-7a — Maintenance configuration mutation suite.** _Requirement:_ RM-7.
  _Behavior:_ one repository command validates issue forms, Discussion routes,
  Rust dependency policy, security workflows, release-preparation wiring, and
  ownership. _Oracle:_ a valid fixture passes and one minimal mutation per
  invariant fails with a stable path-addressed category. _Evidence type:_ Node
  unit test and repository policy command, both run in CI and release
  preparation. _Evidence:_ `scripts/check-repository-maintenance.mjs`,
  `scripts/check-repository-maintenance.test.mjs`,
  `.github/workflows/ci.yml`, and `scripts/release-prep.sh`. _Status:_
  implemented.
- **RM-7b — Failure-blocking security execution.** _Requirements:_ RM-7, RM-8.
  _Behavior:_ mandatory Rust policy, dependency-review, and CodeQL jobs and
  steps cannot use `continue-on-error` or a disabling `if` expression; the
  dependency-review job retains only its exact pull-request event guard.
  _Oracle:_ minimal job- and step-level mutations for both suppression
  mechanisms fail with `E_SECURITY_SUPPRESSION`. _Evidence type:_
  deterministic workflow mutation tests. _Evidence:_
  `scripts/check-repository-maintenance.mjs` and
  `scripts/check-repository-maintenance.test.mjs`. _Status:_ implemented.
- **RM-9a — Deterministic roadmap inventory.** _Requirement:_ RM-9. _Behavior:_
  explicit primary-disposition markers classify each tracked slice as active,
  parked, or delivered, while ordinary historical and epic links remain
  non-owning references. _Oracle:_ a checked-in mocked issue snapshot passes;
  one minimal mutation for a missing open slice, duplicate primary home,
  closed active slice, open delivered slice, and unrecognized marker fails with
  a stable path-addressed category. _Evidence type:_ fixture-backed Node unit
  tests and an offline repository command. _Evidence:_
  `scripts/check-roadmap-inventory.test.mjs`, roadmap fixtures, and
  `scripts/check-roadmap-inventory.mjs`. _Status:_ implemented.
- **RM-9b — Authenticated live reconciliation.** _Requirement:_ RM-9.
  _Behavior:_ an explicit maintenance command reads open and closed issue state
  from GitHub and applies the same deterministic inventory comparison used by
  the fixture suite. _Oracle:_ the command proves every current open non-epic
  slice has one primary active or parked disposition and no closed issue is
  presented as pending. _Evidence type:_ authenticated GitHub API witness kept
  outside the ordinary offline documentation gate. _Evidence:_
  `scripts/check-roadmap-inventory.mjs --live`,
  `.github/workflows/ci.yml`, and `.github/workflows/maintenance.yml`.
  _Status:_ implemented.
- **RM-9c — Honest malformed-fixture type.** _Requirement:_ RM-9. _Behavior:_
  malformed issue-snapshot bytes used to prove JSON refusal must not carry a
  `.json` extension that invites general repository tooling to parse them as a
  valid document. _Oracle:_ the regression fixture retains its malformed bytes
  and still produces `E_ROADMAP_INVALID_ISSUE_SNAPSHOT`, while its path uses an
  explicit non-JSON fixture extension. _Evidence type:_ deterministic Node test
  and malformed text fixture. _Evidence:_
  `scripts/check-roadmap-inventory.test.mjs` and
  `scripts/fixtures/roadmap-inventory/invalid-issues.txt`. _Status:_
  implemented.
- **RM-14a — Duplicate mechanism refusal.** _Requirement:_ RM-14. _Behavior:_
  the offline roadmap structure gate rejects a repeated Architecture
  Accountability mechanism without deleting or conflating distinct rows,
  refuses a missing canonical section or table, ignores table-shaped examples
  outside the authoritative table, and compares plain and inline-code labels
  by displayed identity across LF and CRLF source. Unsupported mechanism-cell
  Markdown is noncanonical. _Oracle:_ a byte-equivalent CRLF success case and
  fixture mutations cover exact duplicate rows, missing/recased, code-indented,
  closing-hash variants in both source orders, or duplicate headings, plain and
  inline-code-styled duplicate table headers, duplicate tables,
  missing or malformed delimiter or data rows, delimiter/header arity
  mismatches, a missing first-cell closing pipe, compact/multi-space/tab-padded
  no-leading-pipe headers, a no-leading-pipe continuing data row, indented code
  plus fenced and commented table-shaped examples, invalid backtick-fence info
  strings plus valid tilde-fence controls, multiline comments that open after
  visible text, a visible duplicate mechanism split by a closed inline HTML
  comment, a multiline comment beginning on a visible table row, and a
  post-table prose control containing a pipe before a multiline comment plus a
  comment-shaped inline-code literal control, inline-code styling and longer
  internal backtick runs, an empty identity, invalid escaping inside and
  outside inline code,
  named/decimal/hexadecimal character references, canonically equivalent
  Unicode, and unsupported emphasis. They fail with
  their stable `E_ROADMAP_*` categories, including both source addresses for a
  duplicate heading, table, or mechanism, while indented, fenced, and
  commented examples immediately after the real authority remain
  non-authoritative. A later H2 separates the duplicate-section fixture from
  the canonical section, and a valid later mechanism table remains detectable
  without turning an incomplete header or unrelated table into authority;
  malformed nested-hash text cannot hide a second table. The process-level
  duplicate leg exits nonzero with empty stdout and exact stderr. _Evidence type:_
  deterministic fixture-backed Node tests plus the existing offline repository
  command. _Evidence:_
  `scripts/check-roadmap-inventory.mjs`,
  `scripts/check-roadmap-inventory.test.mjs`, and
  `scripts/fixtures/roadmap-inventory/roadmap.md`. _Tracking:_
  [#243](https://github.com/flyingrobots/colorful-language/issues/243).
  _Status:_ implemented.
- **RM-10a — Pinned workspace coverage report.** _Requirement:_ RM-10.
  _Behavior:_ one exact `cargo-llvm-cov` release instruments the workspace with
  all features and all targets, emits HTML plus machine-readable JSON, and
  uploads both from a dedicated pull-request and mainline CI job. _Oracle:_ the
  workflow uses the reviewed Rust toolchain and a full-SHA-pinned installer and
  upload action; the coverage command names `--workspace`, `--all-features`,
  and `--all-targets`; the report artifact has an explicit retention period.
  _Evidence type:_ workflow/configuration mutation tests and hosted artifact.
  _Evidence:_ `.github/workflows/ci.yml`,
  `.github/coverage-policy.json`, and
  `scripts/check-coverage-policy.test.mjs`. _Tracking:_
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  _Status:_ implemented.
- **RM-10b — Conservative ratcheting floors.** _Requirement:_ RM-10.
  _Behavior:_ a versioned policy records a freshly measured workspace line
  baseline, a conservative initial floor below it, and separate floors for the
  CLI, LSP, and optional Vale process-transport files. No generated Rust source
  is excluded.
  _Oracle:_ a deterministic checker accepts the reviewed report, rejects a
  workspace or transport regression below its floor, rejects missing files and
  malformed/non-finite counters, and requires a policy edit to lower any
  accepted floor. _Evidence type:_ checked-in policy, report-summary parser,
  and one minimal mutation per invariant. _Evidence:_
  `.github/coverage-policy.json`, `scripts/check-coverage-policy.mjs`, and
  `scripts/check-coverage-policy.test.mjs`. _Tracking:_
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  _Status:_ implemented.
- **RM-10c — Honest baseline and ratchet reference.** _Requirement:_ RM-10.
  _Behavior:_ the maintenance reference records the exact toolchain, command,
  source commit, observed workspace and transport percentages, floor-selection
  rule, artifact contents, and the reviewed procedure for raising or lowering a
  floor. The Unreleased changelog coverage note quotes the same current
  workspace percentage. _Oracle:_ policy tests reject stale or incomplete
  reference values and a stale Unreleased coverage bullet, while lowering a
  floor remains a visible source-controlled change rather than an automatic
  side effect of adding uncovered code. _Evidence type:_ deterministic
  documentation-policy parity test. _Evidence:_
  `docs/workflows/repository-maintenance/README.md`,
  `CHANGELOG.md`,
  `.github/coverage-policy.json`, and
  `scripts/check-coverage-policy.test.mjs`
  `unreleased coverage note matches the machine policy`. _Tracking:_
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  _Status:_ implemented.
- **RM-10d — Coverage follows transport source ownership.** _Requirement:_
  RM-10. _Behavior:_ when CLI transport responsibilities move behind the
  crate-root facade, the per-file ratchet follows every executable source owner
  and does not require the declarative facade to appear in LLVM's report.
  _Oracle:_ the deterministic policy test requires the exact CLI transport
  module inventory and rejects a stale `src/lib.rs` entry. _Evidence type:_
  checked-in policy inventory test plus the hosted LLVM summary. _Evidence:_
  `.github/coverage-policy.json`;
  `scripts/check-coverage-policy.test.mjs`
  `coverage follows every executable CLI source owner`; and CI run
  `30395535174`'s `rust-coverage` artifact. _Tracking:_
  [#223](https://github.com/flyingrobots/colorful-language/issues/223).
  _Status:_ implemented.
- **RM-11a — Explicit workspace doctest evidence.** _Requirement:_ RM-11.
  _Behavior:_ the normal Rust CI job runs
  `cargo test --doc --workspace --locked` as a visible, unconditional, blocking
  step after compiling the supported workspace feature set. _Oracle:_ removing
  the command or any named public API example, guarding the job or step, or
  allowing either to fail without failing the workflow rejects deterministic
  policy evidence. _Evidence type:_ workflow-policy test plus compiled public
  API doctests. _Evidence:_ `.github/workflows/ci.yml`,
  `scripts/check-public-api-doctests.mjs`,
  `scripts/check-public-api-doctests.test.mjs`, and the `Parser`, `Annotator`,
  `Analyzer`, `build_document`, and `visual_role` rustdoc examples. _Tracking:_
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  _Status:_ implemented.
- **RM-11b — Stable doctest-policy input failures.** _Requirement:_ RM-11.
  _Behavior:_ an expected source or workflow input that is missing, moved, or
  unreadable fails closed with one stable category, the repository-relative
  input path, empty standard output, and no raw implementation stack.
  Unexpected programmer errors remain visible rather than being absorbed by a
  blanket entrypoint catch. _Oracle:_ a deterministic process mutation removes
  one expected source input and requires nonzero status, the exact category and
  relative path on standard error, empty standard output, and no Node stack
  frames. _Evidence type:_ process-level input mutation.
  _Evidence:_ `scripts/check-public-api-doctests.mjs` and
  `scripts/check-public-api-doctests.test.mjs`. _Tracking:_
  [#213](https://github.com/flyingrobots/colorful-language/issues/213).
  _Status:_ implemented.
- **RM-12a — Pinned workflow-security gate.** _Requirement:_ RM-12. _Behavior:_
  one versioned policy selects an exact `zizmor` release and its offline,
  workflow-only invocation; the same first-party wrapper scans every checked-in
  workflow in local evidence, a read-only hosted security job, and release
  preparation while `actionlint` remains the syntax and schema oracle. Any
  analyzer exception names one exact rule and workflow location, rationale,
  owner, and removal trigger. The Cargo, Marketplace, and Open VSX release
  selectors are each admitted at one named step and may occur only once across
  all workflows. _Oracle:_ safe fixtures and the live repository pass; minimal
  persisted-checkout-credential and workflow-level write-permission fixtures
  fail with stable, path-addressed categories; a deterministic hanging analyzer
  fails with a stable timeout category before its process-level watchdog;
  policy mutations reject a floating version, weakened thresholds, broadened or
  missing exceptions, moved or duplicated publisher tokens, missing hosted
  command, or missing release-preparation command.
  _Evidence type:_ pinned analyzer execution, deterministic process fixtures,
  and configuration mutation tests. _Evidence:_
  `.github/workflow-security-policy.yml`,
  `scripts/check-workflow-security.mjs`,
  `scripts/check-workflow-security.test.mjs`,
  `scripts/fixtures/workflow-security/`,
  `.github/workflows/security.yml`, and `scripts/release-prep.sh`. _Tracking:_
  [#209](https://github.com/flyingrobots/colorful-language/issues/209).
  _Status:_ implemented.
- **RM-13a — Governed public metadata and deployment authority.**
  _Requirement:_ RM-13. _Behavior:_ one versioned repository profile names the
  maintained README as the homepage, keeps Issues and milestones as the
  delivery authority, records that Discussions have no supported intake owner,
  and assigns publication credentials, rollback, and release evidence to one
  maintainer without claiming that an environment exists. _Oracle:_ profile,
  issue-routing, and documentation mutations reject a missing or alternate
  homepage, promoted unowned Discussion category, direct lowercase Discussion
  URL, absent owner, unreviewed or duplicate credential, empty-environment
  claim, or missing creation threshold; reordered credential and evidence
  inventories remain valid, and an authenticated witness compares the
  configured homepage and environment inventory with live GitHub state.
  _Evidence type:_ deterministic
  configuration mutation tests plus an explicit authenticated API
  witness. _Evidence:_ `.github/repository-profile.yml`,
  `scripts/check-repository-maintenance.mjs`,
  `scripts/check-repository-maintenance.test.mjs`, and this workflow's current
  reference; that witness uses the documented authenticated `gh api`
  commands. _Tracking:_
  [#153](https://github.com/flyingrobots/colorful-language/issues/153).
  _Status:_ implemented.

## Hosted evidence boundary

The mutation suites and structural roadmap check are deterministic and local.
The live RustSec database, GitHub dependency and issue snapshots, and CodeQL
queries are evolving hosted oracles; a new advisory, query, or issue-state
transition can make an unchanged revision fail and requires maintainer triage
rather than a blanket exception. Workflow-security analysis is deliberately
offline and pinned; advancing its analyzer requires a reviewed policy change.
