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

- **RM-1a — Root and Zed advisory scan.** *Requirement:* RM-1. *Behavior:* one
  repository command scans both the root workspace and the standalone Zed
  adapter with a locked `cargo deny` check that includes advisories. *Oracle:*
  both scans exit zero without a vulnerability, unsoundness, or blanket-ignore
  exception.
  *Evidence type:* deterministic workspace command wrapper plus the evolving
  RustSec advisory database. *Evidence:*
  `scripts/check-rust-dependency-policy.sh` and
  `scripts/check-rust-dependency-policy.test.sh`; the regression seeded by
  `RUSTSEC-2026-0190` is fixed in `editors/zed/Cargo.lock`. *Status:*
  implemented.
- **RM-2a — Shared Rust license and source policy.** *Requirement:* RM-2.
  *Behavior:* the all-workspace dependency scan accepts only the reviewed SPDX
  license set present in the root, Zed, fuzz, and validator-complexity fixture
  lockfiles for production and development dependencies, including the
  OSI-approved NCSA terms bundled by the pinned libFuzzer runtime; it denies
  unknown registries and Git sources and carries no blanket exception.
  *Oracle:* `cargo deny --locked check licenses sources` exits zero for every
  discovered workspace; mutating dev-dependency coverage, the allowlist, or
  source policy makes the structural checker fail.
  *Evidence type:* checked-in `cargo-deny` policy, live dependency scan, and
  deterministic mutation test. *Evidence:* `deny.toml`,
  `scripts/check-rust-dependency-policy.sh`, and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-1b — Automated advisory evidence.** *Requirement:* RM-1. *Behavior:* CI
  installs one exact `cargo-deny` version, self-tests workspace discovery, and
  runs the live locked scan; release preparation runs the same self-test and
  live scan. *Oracle:* the structural checker rejects a floating tool version,
  a missing self-test, or a missing live scan; the hosted and local commands
  exit zero. *Evidence type:* workflow/configuration mutation tests plus CI and
  release-preparation execution. *Evidence:*
  `.github/workflows/security.yml`, `scripts/release-prep.sh`, and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-1c — Narrow advisory exception parity.** *Requirements:* RM-1, RM-7.
  *Behavior:* every ignored RustSec ID has exactly one metadata record with a
  named owner, reviewed reason, and explicit removal trigger; stale metadata,
  duplicate IDs, bare ignores, and incomplete records fail. *Oracle:* the
  maintenance mutation suite accepts one complete synthetic exception and
  rejects each malformed or mismatched variant with
  `E_RUST_ADVISORY_EXCEPTION`. *Evidence type:* checked-in empty exception
  registry and deterministic metadata/TOML parity tests. *Evidence:*
  `.github/rust-advisory-exceptions.yml`, `deny.toml`, and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-3a — Reproducible issue forms and routing.** *Requirement:* RM-3.
  *Behavior:* the bug form requires reproduction, observed and expected
  behavior, version, and environment; the feature form requires the problem,
  proposed outcome, and alternatives; because Discussions have no supported
  intake owner, the issue chooser exposes no support or design contact link.
  *Oracle:* malformed or weakened forms and any promoted Discussion route fail
  with stable error categories, while both actionable forms remain directly
  selectable.
  *Evidence type:* YAML policy checker and deterministic mutation tests.
  *Evidence:* `.github/ISSUE_TEMPLATE/bug.yml`,
  `.github/ISSUE_TEMPLATE/feature.yml`,
  `.github/ISSUE_TEMPLATE/config.yml`, and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-4a — Coordinated weekly updates and pull-request review.**
  *Requirement:* RM-4. *Behavior:* the grouped weekly Dependabot policy from
  issue #151 remains the sole update scheduler for GitHub Actions, the root,
  Zed, and fuzz Cargo workspaces, and both Node workspaces, while a
  pull-request-only dependency-review job rejects moderate-or-higher
  vulnerabilities and detected dependency licenses outside the reviewed SPDX
  allowlist. GitHub reports but cannot fail a dependency whose license it
  cannot identify.
  *Oracle:* the existing dependency-update checker continues to pass; the
  maintenance checker rejects a weakened severity, license, event, or
  action-pin policy. *Evidence type:* deterministic configuration tests and
  hosted pull-request workflow. *Evidence:* `.github/dependabot.yml`,
  `.github/workflows/security.yml`,
  `scripts/check-dependency-update-policy.test.mjs`, and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-4c — Editor package-tool license admission.** *Requirement:* RM-4.
  *Behavior:* standard permissive SPDX licenses introduced by the lock-backed
  editor packaging toolchain join the reviewed cross-ecosystem allowlist.
  Scanner-only composite licenses, the restricted VSCE signing runtime, and the
  EPL-licensed Open VSX publisher use exact-version npm package URLs, and no
  packaging-only dependency enters the extension archive. *Oracle:* the
  maintenance checker rejects a missing, unexpected, or version-broadened
  exception; the package smoke test proves the dependency-free package boundary
  excludes development dependencies. *Evidence type:*
  deterministic policy mutation tests and the packaged-extension witness.
  *Evidence:* `.github/workflows/security.yml`,
  `scripts/check-repository-maintenance.test.mjs`, and
  `scripts/check-editor-package-smoke.test.mjs`. Tracking: #136. *Status:*
  implemented.
- **RM-4b — Required security contexts.** *Requirements:* RM-4, RM-5, RM-8.
  *Behavior:* the live and checked-in mainline rulesets require Rust dependency
  policy, dependency review, both CodeQL language jobs, and pinned workflow-
  security analysis from GitHub Actions application `15368`. *Oracle:* the
  exact ruleset-payload test rejects an omitted or renamed context, and the
  privileged live checker reports full parity without changing the bypass
  actor. *Evidence type:* deterministic ruleset test, source-controlled
  manifest, and privileged live API check. *Evidence:*
  `.github/rulesets/mainline.json`,
  `scripts/check-main-ruleset.test.mjs`, and
  `scripts/check-main-ruleset.mjs`. *Status:* implemented.
- **RM-5a — Useful CodeQL coverage.** *Requirement:* RM-5. *Behavior:* one
  advanced CodeQL workflow analyzes Rust and JavaScript/TypeScript with the
  supported build mode on pull requests, default-branch pushes, and weekly
  schedule. *Oracle:* the maintenance checker rejects omitted languages,
  unsupported events, mutable action references, or a non-`none` build mode;
  both hosted matrix legs upload code-scanning results. *Evidence type:*
  deterministic configuration tests and hosted CodeQL analysis. *Evidence:*
  `.github/workflows/security.yml` and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-6a — Explicit ownership without solo deadlock.** *Requirement:* RM-6.
  *Behavior:* `CODEOWNERS` names the current repository owner, while the
  checked-in mainline ruleset continues to require zero approvals and disables
  required code-owner review. *Oracle:* the maintenance checker rejects missing
  ownership or either approval requirement becoming active. *Evidence type:*
  deterministic policy test plus the existing live-ruleset witness. *Evidence:*
  `.github/CODEOWNERS`, `.github/rulesets/mainline.json`,
  `scripts/check-repository-maintenance.test.mjs`, and
  `scripts/check-main-ruleset.mjs`. *Status:* implemented.
- **RM-7a — Maintenance configuration mutation suite.** *Requirement:* RM-7.
  *Behavior:* one repository command validates issue forms, Discussion routes,
  Rust dependency policy, security workflows, release-preparation wiring, and
  ownership. *Oracle:* a valid fixture passes and one minimal mutation per
  invariant fails with a stable path-addressed category. *Evidence type:* Node
  unit test and repository policy command, both run in CI and release
  preparation. *Evidence:* `scripts/check-repository-maintenance.mjs`,
  `scripts/check-repository-maintenance.test.mjs`,
  `.github/workflows/ci.yml`, and `scripts/release-prep.sh`. *Status:*
  implemented.
- **RM-7b — Failure-blocking security execution.** *Requirements:* RM-7, RM-8.
  *Behavior:* mandatory Rust policy, dependency-review, and CodeQL jobs and
  steps cannot use `continue-on-error` or a disabling `if` expression; the
  dependency-review job retains only its exact pull-request event guard.
  *Oracle:* minimal job- and step-level mutations for both suppression
  mechanisms fail with `E_SECURITY_SUPPRESSION`. *Evidence type:*
  deterministic workflow mutation tests. *Evidence:*
  `scripts/check-repository-maintenance.mjs` and
  `scripts/check-repository-maintenance.test.mjs`. *Status:* implemented.
- **RM-9a — Deterministic roadmap inventory.** *Requirement:* RM-9. *Behavior:*
  explicit primary-disposition markers classify each tracked slice as active,
  parked, or delivered, while ordinary historical and epic links remain
  non-owning references. *Oracle:* a checked-in mocked issue snapshot passes;
  one minimal mutation for a missing open slice, duplicate primary home,
  closed active slice, open delivered slice, and unrecognized marker fails with
  a stable path-addressed category. *Evidence type:* fixture-backed Node unit
  tests and an offline repository command. *Evidence:*
  `scripts/check-roadmap-inventory.test.mjs`, roadmap fixtures, and
  `scripts/check-roadmap-inventory.mjs`. *Status:* implemented.
- **RM-9b — Authenticated live reconciliation.** *Requirement:* RM-9.
  *Behavior:* an explicit maintenance command reads open and closed issue state
  from GitHub and applies the same deterministic inventory comparison used by
  the fixture suite. *Oracle:* the command proves every current open non-epic
  slice has one primary active or parked disposition and no closed issue is
  presented as pending. *Evidence type:* authenticated GitHub API witness kept
  outside the ordinary offline documentation gate. *Evidence:*
  `scripts/check-roadmap-inventory.mjs --live`,
  `.github/workflows/ci.yml`, and `.github/workflows/maintenance.yml`.
  *Status:* implemented.
- **RM-9c — Honest malformed-fixture type.** *Requirement:* RM-9. *Behavior:*
  malformed issue-snapshot bytes used to prove JSON refusal must not carry a
  `.json` extension that invites general repository tooling to parse them as a
  valid document. *Oracle:* the regression fixture retains its malformed bytes
  and still produces `E_ROADMAP_INVALID_ISSUE_SNAPSHOT`, while its path uses an
  explicit non-JSON fixture extension. *Evidence type:* deterministic Node test
  and malformed text fixture. *Evidence:*
  `scripts/check-roadmap-inventory.test.mjs` and
  `scripts/fixtures/roadmap-inventory/invalid-issues.txt`. *Status:*
  implemented.
- **RM-14a — Duplicate mechanism refusal.** *Requirement:* RM-14. *Behavior:*
  the offline roadmap structure gate rejects a repeated Architecture
  Accountability mechanism without deleting or conflating distinct rows,
  refuses a missing canonical section or table, ignores table-shaped examples
  outside the authoritative table, and compares plain and inline-code labels
  by displayed identity across LF and CRLF source. Unsupported mechanism-cell
  Markdown is noncanonical. *Oracle:* a byte-equivalent CRLF success case and
  fixture mutations cover exact duplicate rows, missing/recased or
  code-indented headings, comment-altered and closing-hash variants in both
  source orders, duplicate headings, comment-altered header and delimiter
  source, plain, inline-code-styled, inline-linked,
  numeric-character-reference, fully styled, and partially
  asterisk-emphasized duplicate table headers plus unresolved-reference and
  intraword-underscore negative controls, incomplete plain and styled header
  controls, an incomplete no-leading-pipe header control,
  duplicate tables before and after the canonical section,
  missing or malformed delimiter or data rows, an empty table followed by a
  later valid table, delimiter/header arity mismatches, a missing first-cell
  closing pipe, non-breaking-space-padded header and delimiter cells,
  compact/multi-space/tab-padded no-leading-pipe headers, a no-leading-pipe
  continuing data row, indented code plus fenced and commented table-shaped
  examples, raw HTML block variants, an indented comment opener followed by a
  visible table, invalid backtick-fence info strings plus valid tilde-fence
  controls, multiline comments that open after visible text or an unmatched
  backtick, a visible duplicate mechanism split by a closed inline HTML
  comment, a multiline comment beginning on a visible table row, and
  post-table prose controls containing a literal or inline-code pipe plus a
  comment-shaped inline-code literal control, inline-code styling and longer
  internal backtick runs, an empty identity, invalid escaping inside and
  outside inline code,
  named/decimal/hexadecimal character references, canonically equivalent
  Unicode, NUL/replacement-character equivalence, and unsupported emphasis.
  They fail with
  their stable `E_ROADMAP_*` categories, including both source addresses for a
  duplicate heading, table, or mechanism and identical LF/CRLF failure
  addresses, while indented, fenced, and commented examples immediately after
  the real authority remain non-authoritative. ATX H1/H2 and Setext H2 fixtures
  prove a peer section cannot supply missing canonical authority. A later H2
  separates the duplicate-section fixture from the canonical section, and a
  valid later mechanism table remains detectable without turning an incomplete
  header or unrelated table into authority; malformed nested-hash text cannot
  hide a second table. The process-level duplicate leg exits nonzero with empty
  stdout and exact stderr. *Evidence type:* deterministic fixture-backed Node
  tests plus the existing offline repository command. *Evidence:*
  `scripts/check-roadmap-inventory.mjs`,
  `scripts/check-roadmap-inventory.test.mjs`, and
  `scripts/fixtures/roadmap-inventory/roadmap.md`. *Tracking:*
  [#243](https://github.com/flyingrobots/colorful-language/issues/243).
  *Status:* implemented.
- **RM-10a — Pinned workspace coverage report.** *Requirement:* RM-10.
  *Behavior:* one exact `cargo-llvm-cov` release instruments the workspace with
  all features and all targets, emits HTML plus machine-readable JSON, and
  uploads both from a dedicated pull-request and mainline CI job. *Oracle:* the
  workflow uses the reviewed Rust toolchain and a full-SHA-pinned installer and
  upload action; the coverage command names `--workspace`, `--all-features`,
  and `--all-targets`; the report artifact has an explicit retention period.
  *Evidence type:* workflow/configuration mutation tests and hosted artifact.
  *Evidence:* `.github/workflows/ci.yml`,
  `.github/coverage-policy.json`, and
  `scripts/check-coverage-policy.test.mjs`. *Tracking:*
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  *Status:* implemented.
- **RM-10b — Conservative ratcheting floors.** *Requirement:* RM-10.
  *Behavior:* a versioned policy records a freshly measured workspace line
  baseline, a conservative initial floor below it, and separate floors for the
  CLI, LSP, and optional Vale process-transport files. No generated Rust source
  is excluded.
  *Oracle:* a deterministic checker accepts the reviewed report, rejects a
  workspace or transport regression below its floor, rejects missing files and
  malformed/non-finite counters, and requires a policy edit to lower any
  accepted floor. *Evidence type:* checked-in policy, report-summary parser,
  and one minimal mutation per invariant. *Evidence:*
  `.github/coverage-policy.json`, `scripts/check-coverage-policy.mjs`, and
  `scripts/check-coverage-policy.test.mjs`. *Tracking:*
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  *Status:* implemented.
- **RM-10c — Honest baseline and ratchet reference.** *Requirement:* RM-10.
  *Behavior:* the maintenance reference records the exact toolchain, command,
  source commit, observed workspace and transport percentages, floor-selection
  rule, artifact contents, and the reviewed procedure for raising or lowering a
  floor. The Unreleased changelog coverage note quotes the same current
  workspace percentage. *Oracle:* policy tests reject stale or incomplete
  reference values and a stale Unreleased coverage bullet, while lowering a
  floor remains a visible source-controlled change rather than an automatic
  side effect of adding uncovered code. *Evidence type:* deterministic
  documentation-policy parity test. *Evidence:*
  `docs/workflows/repository-maintenance/README.md`,
  `CHANGELOG.md`,
  `.github/coverage-policy.json`, and
  `scripts/check-coverage-policy.test.mjs`
  `unreleased coverage note matches the machine policy`. *Tracking:*
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  *Status:* implemented.
- **RM-10d — Coverage follows transport source ownership.** *Requirement:*
  RM-10. *Behavior:* when CLI transport responsibilities move behind the
  crate-root facade, the per-file ratchet follows every executable source owner
  and does not require the declarative facade to appear in LLVM's report.
  *Oracle:* the deterministic policy test requires the exact CLI transport
  module inventory and rejects a stale `src/lib.rs` entry. *Evidence type:*
  checked-in policy inventory test plus the hosted LLVM summary. *Evidence:*
  `.github/coverage-policy.json`;
  `scripts/check-coverage-policy.test.mjs`
  `coverage follows every executable CLI source owner`; and CI run
  `30395535174`'s `rust-coverage` artifact. *Tracking:*
  [#223](https://github.com/flyingrobots/colorful-language/issues/223).
  *Status:* implemented.
- **RM-11a — Explicit workspace doctest evidence.** *Requirement:* RM-11.
  *Behavior:* the normal Rust CI job runs
  `cargo test --doc --workspace --locked` as a visible, unconditional, blocking
  step after compiling the supported workspace feature set. *Oracle:* removing
  the command or any named public API example, guarding the job or step, or
  allowing either to fail without failing the workflow rejects deterministic
  policy evidence. *Evidence type:* workflow-policy test plus compiled public
  API doctests. *Evidence:* `.github/workflows/ci.yml`,
  `scripts/check-public-api-doctests.mjs`,
  `scripts/check-public-api-doctests.test.mjs`, and the `Parser`, `Annotator`,
  `Analyzer`, `build_document`, and `visual_role` rustdoc examples. *Tracking:*
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  *Status:* implemented.
- **RM-11b — Stable doctest-policy input failures.** *Requirement:* RM-11.
  *Behavior:* an expected source or workflow input that is missing, moved, or
  unreadable fails closed with one stable category, the repository-relative
  input path, empty standard output, and no raw implementation stack.
  Unexpected programmer errors remain visible rather than being absorbed by a
  blanket entrypoint catch. *Oracle:* a deterministic process mutation removes
  one expected source input and requires nonzero status, the exact category and
  relative path on standard error, empty standard output, and no Node stack
  frames. *Evidence type:* process-level input mutation.
  *Evidence:* `scripts/check-public-api-doctests.mjs` and
  `scripts/check-public-api-doctests.test.mjs`. *Tracking:*
  [#213](https://github.com/flyingrobots/colorful-language/issues/213).
  *Status:* implemented.
- **RM-12a — Pinned workflow-security gate.** *Requirement:* RM-12. *Behavior:*
  one versioned policy selects an exact `zizmor` release and its offline,
  workflow-only invocation; the same first-party wrapper scans every checked-in
  workflow in local evidence, a read-only hosted security job, and release
  preparation while `actionlint` remains the syntax and schema oracle. Any
  analyzer exception names one exact rule and workflow location, rationale,
  owner, and removal trigger. The Cargo, Marketplace, and Open VSX release
  selectors are each admitted at one named step and may occur only once across
  all workflows. *Oracle:* safe fixtures and the live repository pass; minimal
  persisted-checkout-credential and workflow-level write-permission fixtures
  fail with stable, path-addressed categories; a deterministic hanging analyzer
  fails with a stable timeout category before its process-level watchdog;
  policy mutations reject a floating version, weakened thresholds, broadened or
  missing exceptions, moved or duplicated publisher tokens, missing hosted
  command, or missing release-preparation command.
  *Evidence type:* pinned analyzer execution, deterministic process fixtures,
  and configuration mutation tests. *Evidence:*
  `.github/workflow-security-policy.yml`,
  `scripts/check-workflow-security.mjs`,
  `scripts/check-workflow-security.test.mjs`,
  `scripts/fixtures/workflow-security/`,
  `.github/workflows/security.yml`, and `scripts/release-prep.sh`. *Tracking:*
  [#209](https://github.com/flyingrobots/colorful-language/issues/209).
  *Status:* implemented.
- **RM-13a — Governed public metadata and deployment authority.**
  *Requirement:* RM-13. *Behavior:* one versioned repository profile names the
  maintained README as the homepage, keeps Issues and milestones as the
  delivery authority, records that Discussions have no supported intake owner,
  and assigns publication credentials, rollback, and release evidence to one
  maintainer without claiming that an environment exists. *Oracle:* profile,
  issue-routing, and documentation mutations reject a missing or alternate
  homepage, promoted unowned Discussion category, direct lowercase Discussion
  URL, absent owner, unreviewed or duplicate credential, empty-environment
  claim, or missing creation threshold; reordered credential and evidence
  inventories remain valid, and an authenticated witness compares the
  configured homepage and environment inventory with live GitHub state.
  *Evidence type:* deterministic
  configuration mutation tests plus an explicit authenticated API
  witness. *Evidence:* `.github/repository-profile.yml`,
  `scripts/check-repository-maintenance.mjs`,
  `scripts/check-repository-maintenance.test.mjs`, and this workflow's current
  reference; that witness uses the documented authenticated `gh api`
  commands. *Tracking:*
  [#153](https://github.com/flyingrobots/colorful-language/issues/153).
  *Status:* implemented.

## Hosted evidence boundary

The mutation suites and structural roadmap check are deterministic and local.
The live RustSec database, GitHub dependency and issue snapshots, and CodeQL
queries are evolving hosted oracles; a new advisory, query, or issue-state
transition can make an unchanged revision fail and requires maintainer triage
rather than a blanket exception. Workflow-security analysis is deliberately
offline and pinned; advancing its analyzer requires a reviewed policy change.
