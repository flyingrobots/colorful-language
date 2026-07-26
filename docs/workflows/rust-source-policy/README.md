# Rust source policy

This workflow tells contributors which first-party Rust crate roots prohibit
unsafe code and where to verify that boundary.

## Current behavior

Every first-party production target reported by Cargo declares:

```rust
#![forbid(unsafe_code)]
```

The normal Rust CI job runs:

```bash
bash scripts/check-rust-source-policy.sh
```

The checker recursively discovers `Cargo.toml` files, asks `cargo metadata`
which workspace owns each manifest, deduplicates those workspaces, and obtains
their target roots from Cargo. It does not maintain parallel workspace or
crate-name lists. It inventories the production target kinds `bin`, `cdylib`,
`dylib`, `lib`, `proc-macro`, `rlib`, and `staticlib`. Development-only
benchmark, example, and test targets are outside this production-root contract.

Discovery prunes only directory components named `.git`, `node_modules`,
`target`, or `vendor`. These are repository metadata, installed JavaScript
dependencies, Cargo output, and vendored dependencies rather than first-party
source. A new workspace anywhere else in the repository enters the policy
automatically.

Only a declaration in the crate preamble satisfies the check. The same text in
a child module, comment, or string literal does not protect the crate and does
not pass the policy.

The executable evidence and supported-target compiler oracles are recorded in
the [test plan](test-plan.md).

## What the declaration guarantees

The declaration constrains first-party source compiled as part of the crate that
contains it. It does not make any claim about unsafe code inside third-party
dependencies.

Because `forbid` cannot be relaxed by a child module, first-party code below an
inventoried root cannot introduce an `unsafe` block, function, trait, or
implementation without a compiler error.

## Exception process

No exception is currently approved. Exceptions are registered in
[`exceptions.tsv`](exceptions.tsv) as an exact crate-root path and a
`docs/design/*.md` record separated by one tab.

A proposed exception or relaxation must arrive through a pull request with an
architecture review. Its design record must explain:

- the exact root and unsafe capability in scope;
- why safe Rust cannot satisfy the requirement;
- how the unsafe boundary is contained and tested;
- who owns the exception;
- what evidence or dependency change would allow its removal.

The checker rejects an exception for an uninventoried root, a missing design
record, a duplicate entry, or a root that already forbids unsafe code. It
canonicalizes every record path, so parent traversal and symlink escapes cannot
leave `docs/design/`. Removing the declaration without adding a reviewed record
therefore fails CI rather than silently weakening the policy.
