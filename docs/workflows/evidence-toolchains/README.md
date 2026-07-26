# Evidence toolchains

This workflow tells maintainers which compiler and runtime versions produce
repository evidence, and keeps those choices separate from compatibility
claims made to downstream users.

## Primary evidence versions

These checked-in versions are the reproducibility oracle:

| Tool | Exact release | Authority |
| --- | --- | --- |
| Rust | 1.97.1 | `rust-toolchain.toml` |
| Node | 22.23.1 | `.node-version` |
| TypeScript | 5.9.3 | root and VS Code `package.json` / `package-lock.json` pairs |

`rust-toolchain.toml` selects the compiler, `rustfmt`, `clippy`, and the
`wasm32-wasip1` target for a rustup-enabled source checkout. Primary CI and the
release workflow select Rust 1.97.1 explicitly. Their Node steps read
`.node-version`.

Run the root install before the IR witness so it uses the repository compiler
rather than an ambient `tsc`:

```bash
npm ci
bash scripts/ir-witness.sh
```

The VS Code adapter owns a separate dependency graph but uses the same exact
TypeScript release:

```bash
npm --prefix editors/vscode ci
npm --prefix editors/vscode run compile
```

## Compatibility is a separate claim

The workspace does not declare a minimum supported Rust version (MSRV).
`Cargo.toml` records that the omission is intentional. Rust 1.97.1 proves the
accepted repository state on one reviewed compiler; it does not prove that
every older compiler works.

An MSRV may be declared only after a dedicated lower-bound CI matrix identifies
and continuously verifies the same compiler across all workspace crates and
the standalone Zed adapter. Until that evidence exists, older compilers are
unverified and no lower compatibility bound is advertised.

The advisory `Toolchain compatibility` workflow runs every Monday and can be
started manually. It exercises the current Rust stable channel and the
supported Node 22 line. A red advisory run does not change the primary pins or
block an unrelated pull request. The maintainer owns triage: reproduce the
failure, open or link an issue, and either restore compatibility or record an
intentional support-policy change before updating a primary version.

## Updating a primary version

Update a primary version only in a reviewed maintenance pull request. Change
the authority file, every package declaration and lock that repeats the value,
the primary workflow selectors, and this reference together. Run:

```bash
node scripts/check-evidence-toolchains.mjs --self-test
node scripts/check-evidence-toolchains.mjs
bash scripts/release-prep.sh
```

The policy checker rejects ranges, mismatched locks, moving selectors in
primary workflows, fixed selectors in the compatibility workflow, and a
silently declared MSRV. The weekly advisory lane supplies the forward signal;
it never silently rewrites the reviewed evidence versions.

The complete requirements and evidence map live in the
[evidence-toolchain test plan](test-plan.md).
