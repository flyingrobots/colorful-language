# colorful-language v0.3.0 — Verification Witness

Record of the release execution. Never claim success for a step not directly
run and observed.

## Discovery

- Target version: `0.3.0`
- Branch (prep): `release/v0.3.0`
- Merge target: `origin/main` at `fb818a5`
- Sync state after `git fetch origin main --tags`: ahead 4, behind 0 against
  `origin/main`
- Workspace version (`Cargo.toml`): `0.3.0`
- Latest existing `v*` tag before prep: `v0.2.1`
- Previous completed release: `v0.2.1`
- Target tag existed before prep: no local or remote `v0.3.0` tag found.

## Validation gate (prep)

Run on the prep branch before opening the release PR. Record exit status.

| Step | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --all -- --check` | ✅ pass |
| Clippy | `cargo clippy --locked --all-targets --all-features -- -D warnings` | ✅ pass |
| Tests | `cargo test --all --locked` | ✅ pass (125 unit tests) |
| Package witness | `bash scripts/package-witness.sh` | ✅ pass; checked package-local contract copies, packaged all seven publishable crates, extracted the tarballs, and checked the extracted package workspace. |
| Release build | `cargo build --release --locked` | ✅ pass |
| Markdown | `markdownlint-cli2 "**/*.md"` | ✅ pass (48 files, 0 errors) |
| Workflows | `actionlint .github/workflows/*.yml` | ✅ pass |
| Whitespace | `git diff --check "$(git hash-object -t tree /dev/null)" HEAD` | ✅ pass |

After adopting the repo-local Continuum release profile, the unified release-prep
script was run on `docs/adapt-release-lifecycle` before opening the follow-up PR
that carries the profile and guard changes:

| Step | Command | Result |
| --- | --- | --- |
| Release profile | `bash scripts/release-profile-check.sh` | ✅ pass; profile matched workspace version `0.3.0`, release signposts, workflows, scripts, and all seven crates. |
| Unified release prep | `bash scripts/release-prep.sh` | ✅ pass; ran profile, Rust fmt/clippy/test, package witness, release build, IR witness, Graft consumer, VS Code compile, Zed compile, Markdown lint, `actionlint`, and whitespace checks. |

## Supplemental witnesses

These commands mirror CI surfaces that are not repeated by the tag-triggered
release workflow.

| Surface | Command | Result |
| --- | --- | --- |
| CLI version | `cargo run --quiet -p colorful-cli -- --version` | ✅ pass; printed `colorful 0.3.0`. |
| CLI help | `cargo run --quiet -p colorful-cli -- --help` | ✅ pass; listed `colorful diagnose [--json] [FILE]` and `-V, --version`. |
| Diagnostic JSON | `cargo run --quiet -p colorful-cli -- diagnose --json crates/colorful-cli/fixtures/editor-smoke-prose.txt` | ✅ pass; emitted `colorful.diagnose/v1` with all expected visual roles and LSP token types. |
| IR witness | `bash scripts/ir-witness.sh` | ✅ pass; Rust, TypeScript decode, and Rust decode canonical JSON were byte-identical, and the generated TypeScript contract type-checked. |
| Graft projection consumer | `node consumers/graft-projection.test.mjs` | ✅ pass. |
| VS Code source extension | `npm ci && npm run compile` in `editors/vscode` | ✅ pass. |
| Zed source extension | `cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1` | ✅ pass. |

PR CI also records hosted evidence for these non-tag surfaces through the
`IR cross-language round-trip witness` and `Editor integrations (compile)` jobs.

## crates.io dry-run

| Crate | Command | Result |
| --- | --- | --- |
| `colorful-core` | `cargo publish --dry-run -p colorful-core --locked` | ✅ pass; packaged and verified `colorful-core v0.3.0`, then aborted upload because this was a dry run. |

## Tag and publish

Pending. Fill after the release-prep PR merges, tag `v0.3.0` is pushed, and the
tag-triggered `Release` workflow completes.

## Non-blocking notes

- Release binaries are `x86_64-unknown-linux-gnu` only; macOS/Windows/aarch64
  artifacts are a future cross-build addition.
- Homebrew packaging is tracked separately.
