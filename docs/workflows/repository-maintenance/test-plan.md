# Repository Maintenance Test Plan

This plan defines executable evidence for repository intake, dependency
governance, ownership, and security maintenance. GitHub issue
[#152](https://github.com/flyingrobots/colorful-language/issues/152) owns the
broader workflow; the prerequisite advisory remediation is tracked separately
in [#197](https://github.com/flyingrobots/colorful-language/issues/197).

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
  evidence for a maintainer to act. Support and exploratory design conversations
  may route to Discussions without hiding an actionable defect or proposal.
- **RM-4 — Dependency change review.** Weekly dependency updates must remain
  grouped by rollback boundary, and every pull request must reject newly
  introduced dependencies with disallowed licenses or moderate-or-higher known
  vulnerabilities.
- **RM-5 — Static security analysis.** CodeQL must analyze the repository's
  supported Rust and JavaScript/TypeScript source surfaces on pull requests,
  default-branch pushes, and a weekly schedule.
- **RM-6 — Solo-safe ownership.** Repository ownership must be explicit without
  requiring a non-author or code-owner approval before a second trusted human
  exists.
- **RM-7 — Maintenance policy drift.** The repository must reject malformed or
  weakened intake, ownership, dependency, and security configuration before it
  reaches the hosted workflow.

## Cases

- **RM-1a — Root and Zed advisory scan.** *Requirement:* RM-1. *Behavior:* one
  repository command scans both the root workspace and the standalone Zed
  adapter with `cargo deny --locked check advisories`. *Oracle:* both scans exit
  zero without a vulnerability, unsoundness, or blanket-ignore exception.
  *Evidence type:* deterministic workspace command wrapper plus the evolving
  RustSec advisory database. *Evidence:* `scripts/check-rust-advisories.sh` and
  `scripts/check-rust-advisories.test.sh`; the regression seeded by
  `RUSTSEC-2026-0190` is fixed in `editors/zed/Cargo.lock`. *Status:*
  implemented.
- **RM-2a — Shared Rust license and source policy.** *Requirement:* RM-2.
  *Behavior:* the all-workspace dependency scan accepts only the reviewed SPDX
  license set already present in the root and Zed lockfiles, denies unknown
  registries and Git sources, and carries no blanket exception. *Oracle:*
  `cargo deny --locked check licenses sources` exits zero for both workspaces;
  mutating the allowlist or source policy makes the structural checker fail.
  *Evidence type:* checked-in `cargo-deny` policy, live dependency scan, and
  deterministic mutation test. *Status:* planned.
- **RM-1b — Automated advisory evidence.** *Requirement:* RM-1. *Behavior:* CI
  installs one exact `cargo-deny` version, self-tests workspace discovery, and
  runs the live locked scan; release preparation runs the same self-test and
  live scan. *Oracle:* the structural checker rejects a floating tool version,
  a missing self-test, or a missing live scan; the hosted and local commands
  exit zero. *Evidence type:* workflow/configuration mutation tests plus CI and
  release-preparation execution. *Status:* planned.
- **RM-3a — Reproducible issue forms and routing.** *Requirement:* RM-3.
  *Behavior:* the bug form requires reproduction, observed and expected
  behavior, version, and environment; the feature form requires the problem,
  proposed outcome, and alternatives; support and exploratory design contact
  links target the repository's Q&A and Ideas Discussion categories.
  *Oracle:* malformed, weakened, or misrouted fixtures fail with stable error
  categories, while both actionable forms remain directly selectable.
  *Evidence type:* YAML policy checker and deterministic mutation tests.
  *Status:* planned.
- **RM-4a — Coordinated weekly updates and pull-request review.**
  *Requirement:* RM-4. *Behavior:* the grouped weekly Dependabot policy from
  issue #151 remains the sole update scheduler, while a pull-request-only
  dependency-review job rejects moderate-or-higher vulnerabilities and
  dependencies outside the reviewed SPDX allowlist. *Oracle:* the existing
  dependency-update checker continues to pass; the maintenance checker rejects
  a weakened severity, license, event, or action-pin policy. *Evidence type:*
  deterministic configuration tests and hosted pull-request workflow.
  *Status:* planned.
- **RM-5a — Useful CodeQL coverage.** *Requirement:* RM-5. *Behavior:* one
  advanced CodeQL workflow analyzes Rust and JavaScript/TypeScript with the
  supported build mode on pull requests, default-branch pushes, and weekly
  schedule. *Oracle:* the maintenance checker rejects omitted languages,
  unsupported events, mutable action references, or a non-`none` build mode;
  both hosted matrix legs upload code-scanning results. *Evidence type:*
  deterministic configuration tests and hosted CodeQL analysis. *Status:*
  planned.
- **RM-6a — Explicit ownership without solo deadlock.** *Requirement:* RM-6.
  *Behavior:* `CODEOWNERS` names the current repository owner, while the
  checked-in mainline ruleset continues to require zero approvals and disables
  required code-owner review. *Oracle:* the maintenance checker rejects missing
  ownership or either approval requirement becoming active. *Evidence type:*
  deterministic policy test plus the existing live-ruleset witness. *Status:*
  planned.
- **RM-7a — Maintenance configuration mutation suite.** *Requirement:* RM-7.
  *Behavior:* one repository command validates issue forms, Discussion routes,
  Rust dependency policy, security workflows, release-preparation wiring, and
  ownership. *Oracle:* a valid fixture passes and one minimal mutation per
  invariant fails with a stable path-addressed category. *Evidence type:* Node
  unit test and repository policy command, both run in CI and release
  preparation. *Status:* planned.

## Current execution boundary

The planned cases above are owned by issue
[#152](https://github.com/flyingrobots/colorful-language/issues/152). Until
that slice lands, RM-1a remains a documented maintainer command rather than an
automated merge or release gate.
