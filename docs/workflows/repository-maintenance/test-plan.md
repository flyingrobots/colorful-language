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

## Known gaps

Issue [#152](https://github.com/flyingrobots/colorful-language/issues/152) will
extend this plan before adding issue intake, license/source policy, pull-request
dependency review, CodeQL, and ownership configuration.
