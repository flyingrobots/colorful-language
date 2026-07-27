# Repository Maintenance

Repository maintenance keeps dependency and intake policy visible, reviewable,
and executable. This page describes only the maintenance controls that exist in
the repository today.

## Rust advisory scan

Run the locked advisory scan from the repository root:

```bash
bash scripts/check-rust-advisories.sh
```

The command requires Git, Cargo, `cargo-deny`, and Python 3. It discovers and
deduplicates every Git-tracked Cargo workspace while pruning `.git`,
`node_modules`, `target`, and `vendor` directories. Untracked scratch manifests
do not affect the policy inventory. The current inventory is:

- the root Rust workspace at `Cargo.toml`; and
- the standalone Zed adapter at `editors/zed/Cargo.toml`.

Both checks use their workspace lockfile and the RustSec advisory database.
Vulnerability and unsoundness advisories fail the command. The repository does
not carry a blanket advisory exception. The checker self-test adds a third
standalone workspace to prove that a future workspace cannot silently escape
the inventory.

The RustSec database is an external, evolving oracle. A newly published
advisory can therefore make an unchanged lockfile fail. The maintainer owns
triage: verify the advisory and dependency path, prefer the narrowest compatible
upgrade, and record any unavoidable exception with its advisory identifier,
reason, and removal trigger.

## Evidence

The requirements, exact oracles, and remaining maintenance gaps live in the
[repository-maintenance test plan](test-plan.md).
