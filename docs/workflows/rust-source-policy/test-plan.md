# Rust source policy test plan

Verification for first-party production crate-root inventory, unsafe-code
declarations, supported targets, and reviewed exceptions.

Canonical issue:
[#146](https://github.com/flyingrobots/colorful-language/issues/146).

## Requirements

- **RSP-1** Every first-party production library, binary, and editor-adapter
  crate root must declare `#![forbid(unsafe_code)]` or have one explicit,
  reviewed exception.
- **RSP-2** The source-policy check must derive its inventory from Cargo target
  metadata for both the main workspace and the standalone Zed adapter so a new
  production root cannot be omitted silently.
- **RSP-3** The normal CI gate must execute the inventory check.
- **RSP-4** An exception must name its exact crate root and a repository design
  record that explains scope, rationale, containment, ownership, and removal
  criteria.
- **RSP-5** The declared policy must compile for the main workspace and the
  Zed adapter's supported `wasm32-wasip1` target.
- **RSP-6** Documentation must state that crate-root policy does not constrain
  unsafe code inside third-party dependencies.

## Cases

- **RSP-1a** — *Requirements:* RSP-1, RSP-2, RSP-4. *Behavior:* inspect
  production targets reported by Cargo for the main workspace and Zed adapter;
  reject every root that lacks `#![forbid(unsafe_code)]` unless an exception
  registry names that root and an existing design record. *Oracle:* the current
  repository fails for the three unprotected roots, passes after they declare
  the policy, and any newly inventoried unprotected production root fails.
  *Evidence type:* executable source-policy script. *Evidence:*
  `scripts/check-rust-source-policy.sh`,
  `scripts/check-rust-source-policy.test.sh`, and
  `docs/workflows/rust-source-policy/exceptions.tsv`. *Status:* implemented.
- **RSP-2a** — *Requirements:* RSP-3, RSP-6. *Behavior:* normal CI runs the
  source-policy check, while the workflow reference states the first-party
  boundary and exception process. *Oracle:* workflow inspection plus
  documentation checks. *Evidence type:* CI workflow and current operational
  reference. *Evidence:* the `rust` job in `.github/workflows/ci.yml` and
  `docs/workflows/rust-source-policy/README.md`. *Status:* implemented.
- **RSP-3a** — *Requirement:* RSP-5. *Behavior:* the main workspace and Zed
  adapter compile with the declarations enabled on their supported targets.
  *Oracle:* the Rust gate passes and the Zed adapter builds for
  `wasm32-wasip1`. *Evidence type:* compiler execution. *Evidence:* the `rust`
  and `editors` jobs in `.github/workflows/ci.yml`. *Status:* implemented.
