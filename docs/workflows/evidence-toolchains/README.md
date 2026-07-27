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

## Reviewing dependency updates

Dependabot opens five independent weekly groups from
`.github/dependabot.yml`:

| Group | Dependency boundary | Rollback boundary |
| --- | --- | --- |
| `github-actions` | Every GitHub Actions workflow | Workflow-only revert |
| `cargo` | The root Cargo workspace and lockfile | Core Rust dependency revert |
| `zed-cargo` | Standalone Zed Cargo workspace and lockfile | Zed-only revert |
| `root-node` | Root evidence tooling and lockfile | Evidence-tooling revert |
| `vscode` | VS Code adapter packages and lockfile | Editor-adapter revert |

Do not combine these groups. Their evidence, failure modes, and rollback scopes
differ. Issue
[#152](https://github.com/flyingrobots/colorful-language/issues/152) may extend
repository maintenance around this configuration, but this workflow remains the
single owner of update sources, grouping, and cadence.

For an action update, inspect the upstream release and source commit, retain the
full 40-character commit SHA in every `uses:` reference, and keep its release
or source-version comment on the same line. For Cargo or Node updates, inspect
the manifest and lockfile diff for unrelated movement, review upstream release
and advisory notes, and run the affected gate plus the full release-preparation
gate before merging.

Changing a primary Rust, Node, or TypeScript evidence release remains a manual
policy change: update every authority and current reference named above in the
same reviewed pull request. A Dependabot lockfile update must not silently
change those exact declarations.

Run the update-policy evidence directly with:

```bash
npm ci
node --test scripts/check-dependency-update-policy.test.mjs
node scripts/check-dependency-update-policy.mjs
```

The mutation suite rejects a floating action ref, a missing action-version
comment, any missing, duplicate, or unexpected update source, a non-weekly
cadence, and group-name or wildcard-pattern drift. The live check scans every
workflow file, including workflows added later.

The complete requirements and evidence map live in the
[evidence-toolchain test plan](test-plan.md).
