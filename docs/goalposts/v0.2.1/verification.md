# colorful-language v0.2.1 — Verification Witness

Record of the release execution. Never claim success for a step not directly
run and observed.

## Discovery

- Target version: `0.2.1`
- Branch (prep): `release/v0.2.1`
- Workspace version (`Cargo.toml`): `0.2.1`
- Latest existing `v*` tag before prep: `v0.2.0`
- Previous completed release: `v0.1.0`
- Failed release attempt: `v0.2.0`
- Target tag existed before prep: no local or remote `v0.2.1` tag found.

## Validation gate (prep)

Run on the prep branch before opening the release PR. Record exit status.

| Step | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --all -- --check` | ✅ pass |
| Clippy | `cargo clippy --locked --all-targets --all-features -- -D warnings` | ✅ pass |
| Tests | `cargo test --all --locked` | ✅ pass (100 unit tests) |
| Package witness | `bash scripts/package-witness.sh` | ✅ pass; packaged all seven publishable crates, extracted the tarballs, and checked the extracted package workspace. |
| Release build | `cargo build --release --locked` | ✅ pass |
| Markdown | `markdownlint-cli2 "**/*.md"` | ✅ pass (0 errors) |
| Workflows | `actionlint .github/workflows/*.yml` | ✅ pass |
| Whitespace | `git diff --check "$(git hash-object -t tree /dev/null)" HEAD` | ✅ pass |

## Supplemental witnesses

These commands mirror CI surfaces that are not repeated by the tag-triggered
release workflow.

| Surface | Command | Result |
| --- | --- | --- |
| IR round-trip | `bash scripts/ir-witness.sh` | ✅ pass; Rust, TypeScript, and Rust re-canonicalized JSON were byte-identical (`4796` bytes). |
| graft reference consumer | `node consumers/graft-projection.test.mjs` | ✅ pass |
| VS Code extension | `npm run compile` in `editors/vscode` | ✅ pass; package version `0.2.1`. |
| Zed extension | `cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1` | ✅ pass; package version `0.2.1`. |

## crates.io dry-run

| Crate | Command | Result |
| --- | --- | --- |
| `colorful-core` | `cargo publish --dry-run -p colorful-core --locked` | ✅ pass; packaged 5 files and verified `colorful-core v0.2.1`. |

Dependent crate dry-runs cannot complete before `colorful-core v0.2.1` exists on
crates.io. The package witness verifies every crate from extracted package
tarballs before the release PR merges and before the tag workflow publishes.

## Tag and publish

Pending until the release-prep PR is merged and `v0.2.1` is tagged on `main`.

- Release commit SHA: Pending
- Tag `v0.2.1` SHA: Pending
- `Release` workflow run: Pending
- GitHub Release: Pending
- crates.io @ 0.2.1: Pending

## Non-blocking notes

- Release binaries are `x86_64-unknown-linux-gnu` only; macOS/Windows/aarch64
  artifacts are a future cross-build addition.
