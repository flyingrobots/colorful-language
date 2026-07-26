# Rust source policy

This workflow tells contributors which first-party Rust crate roots prohibit
unsafe code and where to verify that boundary.

## Current behavior

Every library crate in the main Cargo workspace declares
`#![forbid(unsafe_code)]`. The `colorful` and `colorful-lsp` binary roots and the
standalone Zed adapter root do not currently declare the same policy. CI does
not yet inventory production Cargo targets for missing declarations.

The executable policy extension is tracked by
[#146](https://github.com/flyingrobots/colorful-language/issues/146) and its
[test plan](test-plan.md). This page describes only the policy enforced on
`main`; it will change when executable evidence lands.

## Boundary

The declaration constrains first-party source compiled as part of the crate that
contains it. It does not make any claim about unsafe code inside third-party
dependencies.
