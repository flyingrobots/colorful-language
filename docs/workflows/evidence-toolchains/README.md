# Evidence toolchains

This workflow tells maintainers which compiler and runtime versions produce
repository evidence, and keeps those choices separate from compatibility
claims made to downstream users.

The repository does not currently have an evidence-toolchain policy. Primary CI
and release jobs select the moving Rust stable channel. JavaScript jobs select
the moving Node 22 line, and the IR witness obtains TypeScript from the ambient
`PATH`. A clean checkout therefore does not select the exact Rust, Node, and
TypeScript versions that produced the last accepted evidence.

The workspace also does not declare a minimum supported Rust version (MSRV).
The commented `rust-version` entry in the workspace manifest records that this
is intentional: a compiler used for repository evidence is not automatically a
verified lower compatibility bound.

Planned verification and the policy acceptance criteria live in the
[evidence-toolchain test plan](test-plan.md).
