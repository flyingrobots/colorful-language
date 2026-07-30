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
| Ruby | 3.4.10 | `.github/workflows/release.yml` |
| cargo-mutants | 27.0.0 | `scripts/check-ir-validator-mutants.sh` |
| proptest | 1.11.0 | root `Cargo.toml` / `Cargo.lock` pair |
| libfuzzer-sys | 0.4.13 | `fuzz/Cargo.toml` / `fuzz/Cargo.lock` pair |
| cargo-fuzz | 0.13.2 | `scripts/check-property-fuzz-policy.mjs` |

`rust-toolchain.toml` selects the compiler, `rustfmt`, `clippy`, and the
`wasm32-wasip1` target for a rustup-enabled source checkout. Primary CI and the
release workflow select Rust 1.97.1 explicitly. Their Node steps read
`.node-version`.

The blocking IR validator mutation gate installs the exact `cargo-mutants`
release named above and rejects any other version before generating or running
the reviewed corpus. Its scope and exclusions live in `.cargo/mutants.toml`;
the IR topic owns the behavioral evidence.

Ruby is a release-only evidence runtime. The tag workflow installs Ruby 3.4.10
through the reviewed full-SHA `ruby/setup-ruby` action before syntax-checking
the generated Homebrew formula. `scripts/check-release-distribution.mjs`
rejects a different action commit, Ruby release, or setup input; normal
repository JavaScript and Rust evidence does not depend on Ruby.

## Property and fuzz evidence

The blocking correctness corpus is deterministic: one checked-in 32-byte seed
drives exactly 256 cases through parser, annotator, projection/validation, and
CLI/LSP coordinate properties. Run the same command used by CI and release
preparation:

```bash
cargo test --locked -p colorful-cli --test property_boundaries -- --test-threads=1
```

The target is marked `test = false`, so `cargo test --all --locked` does not
execute it a second time. The explicit command is the sole bounded-corpus gate
and keeps the exact case budget visible and policy-checkable. CI and release
preparation format, lint, and compile every standalone fuzz binary without
executing a time-based session:

```bash
cargo fmt --manifest-path fuzz/Cargo.toml --all -- --check
cargo clippy --manifest-path fuzz/Cargo.toml --locked --bins -- -D warnings
cargo check --manifest-path fuzz/Cargo.toml --locked --bins
```

Time-based fuzzing is a maintainer action, never a correctness-CI step. Install
the reviewed driver, then run each checked-in target for a bounded session:

```bash
cargo install cargo-fuzz --version 0.13.2 --locked
cargo +nightly fuzz run parser -- -max_total_time=60
cargo +nightly fuzz run annotator -- -max_total_time=60
cargo +nightly fuzz run ir_projection -- -max_total_time=60
cargo +nightly fuzz run coordinates -- -max_total_time=60
```

The fuzz runtime is pinned independently in `fuzz/Cargo.lock`. Increase a
session's time only for deliberate local investigation. When shrinking exposes
a regression, turn the minimized input into an ordinary deterministic Rust
test before closing the issue; do not make a time budget or machine-dependent
fuzz throughput a merge oracle.

Run the configuration contract directly with:

```bash
node --test scripts/check-property-fuzz-policy.test.mjs
node scripts/check-property-fuzz-policy.mjs
```

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

Dependabot opens six independent weekly groups from
`.github/dependabot.yml`:

| Group | Dependency boundary | Rollback boundary |
| --- | --- | --- |
| `github-actions` | Every GitHub Actions workflow | Workflow-only revert |
| `cargo` | The root Cargo workspace and lockfile | Core Rust dependency revert |
| `zed-cargo` | Standalone Zed Cargo workspace and lockfile | Zed-only revert |
| `fuzz-cargo` | Direct standalone fuzz-runtime dependencies and fuzz lockfile | Fuzz-runtime-only revert |
| `root-node` | Root evidence tooling except TypeScript | Evidence-tooling revert |
| `vscode` | VS Code packages except TypeScript and the host-pinned `@types/node` release | Editor-adapter revert |

Do not combine these groups. Their evidence, failure modes, and rollback scopes
differ. Issue
[#152](https://github.com/flyingrobots/colorful-language/issues/152) may extend
repository maintenance around this configuration, but this workflow remains the
single owner of update sources, grouping, and cadence.

The `/fuzz` source has one exact `allow` boundary derived from direct external
dependencies in `fuzz/Cargo.toml`; currently that is only `libfuzzer-sys`.
Product and adapter versions remain in the root Cargo workspace. Path
dependencies let fuzz targets exercise those crates without granting the
standalone update source authority to rewrite `Cargo.toml`. The policy checker
parses both manifests and rejects a fuzz dependency that duplicates a root
workspace dependency, a missing allowlist, or any broader/substituted allow
rule.

For an action update, inspect the upstream release and source commit, retain the
full 40-character commit SHA in every `uses:` reference, and keep its release
or source-version comment on the same line. A Docker action is the sole remote
format exception: use `docker://<image>@sha256:<64 lowercase hex characters>`
plus the same-line image-version comment; mutable image tags are rejected.
Local `./` actions remain source-controlled by the repository. For Cargo or
Node updates, inspect the manifest and lockfile diff for unrelated movement,
review upstream release and advisory notes, and run the affected gate plus the
full release-preparation gate before merging.

Changing a primary Rust, Node, or TypeScript evidence release remains a manual
policy change: update every authority and current reference named above in the
same reviewed pull request. Both npm update sources explicitly ignore
`typescript`, because an independent root or VS Code update cannot satisfy the
cross-graph exact-version invariant. The VS Code source also ignores every
`@types/node` update because the exact declaration release and minimum-host API
compile are one extension-host compatibility policy. Any declaration update
requires a coordinated policy and package-smoke change. A Dependabot lockfile
update must not silently move that pin.

Run the update-policy evidence directly with:

```bash
npm ci
node --test scripts/check-dependency-update-policy.test.mjs
node scripts/check-dependency-update-policy.mjs
```

The mutation suite rejects a floating action ref, a missing action-version
comment, any missing, duplicate, or unexpected update source, a non-weekly
cadence, group-name or wildcard-pattern drift, and any attempt to automate one
side of the shared TypeScript pin. It also rejects a missing, scalar, or
partial `@types/node` exclusion and any fuzz allowlist or manifest change that
would overlap the root Cargo authority. The live check parses the YAML node
graph, so legal key quoting or whitespace cannot hide a `uses` entry, and scans
every workflow file, including workflows added later. It also rejects a Docker
action unless an immutable SHA-256 image digest replaces a mutable tag.

The complete requirements and evidence map live in the
[evidence-toolchain test plan](test-plan.md).
