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

Support questions route to the Q&A Discussion category. Early, exploratory
design routes to Ideas. Both issue forms remain directly selectable, so those
links do not hide an actionable defect or concrete proposal.

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
- the standalone Zed adapter at `editors/zed/Cargo.toml`.

Both checks use their workspace lockfile. Vulnerability and unsoundness
advisories fail through the evolving RustSec database. Production and
development dependencies with licenses outside the reviewed SPDX allowlist
fail, as do Git dependencies and registries other than the public crates.io
index. There are no active advisory or per-crate license exceptions. The
checker self-test adds a third standalone workspace to prove that a future
workspace cannot silently escape the inventory.

The RustSec database is an external, evolving oracle. A newly published
advisory can therefore make an unchanged lockfile fail. The maintainer owns
triage: verify the advisory and dependency path, prefer the narrowest compatible
upgrade, and do not add a bare ignore. If no compatible fix exists, add the
RustSec ID to `deny.toml` and one matching record to
`.github/rust-advisory-exceptions.yml`. The record must name one GitHub owner,
the reviewed reason, and an explicit removal trigger. The policy checker rejects
missing, duplicate, incomplete, or stale records and any mismatch between the
two files.

## Hosted security gates

The `Security` workflow runs for pull requests, pushes to `main`, every Monday,
and manual recovery:

- the Rust dependency-policy job installs `cargo-deny` 0.18.9 with a
  full-SHA-pinned installer, then runs the discovery self-test and live locked
  scan;
- dependency review runs only on pull requests and rejects newly introduced
  moderate-or-higher vulnerabilities across runtime, development, and unknown
  scopes, plus detected licenses outside the reviewed cross-ecosystem allowlist;
  a dependency whose license GitHub cannot identify is reported but cannot be
  failed by that action; and
- CodeQL uses its supported build-free analysis for both Rust and
  JavaScript/TypeScript, then uploads one result category per language.

The same repository-policy mutation tests run in the required documentation job
and release preparation. Release preparation also reruns the Rust self-test and
live dependency scan. The mainline ruleset requires the Rust policy,
dependency-review, and both CodeQL language contexts, so these hosted failures
block the normal merge path. The structural checker also rejects an `if` guard
or `continue-on-error` setting that could suppress any mandatory security job or
step.

## Updates and ownership

`.github/dependabot.yml` remains the only dependency-update scheduler. Its
weekly groups preserve separate rollback boundaries for GitHub Actions, the
root and Zed Cargo workspaces, root Node evidence tooling, and the VS Code
adapter.

`CODEOWNERS` assigns the repository to `@flyingrobots`. This is ownership
metadata, not a second-human gate: the checked-in and live mainline ruleset
requires zero approvals and does not require code-owner review. Enable either
requirement only after a second trusted human can satisfy it.

## Evidence

The requirements, exact oracles, and mutation coverage live in the
[repository-maintenance test plan](test-plan.md).
