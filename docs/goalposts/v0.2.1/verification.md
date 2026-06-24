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
| Package witness | `bash scripts/package-witness.sh` | ✅ pass; checked package-local contract copies, packaged all seven publishable crates, extracted the tarballs, and checked the extracted package workspace. |
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
tarballs before the release PR merges and before the tag workflow publishes. It
also verifies that the package-local `colorful-ir` contract inputs match the root
contract sources byte-for-byte.

## Tag and publish

Observed after PR #33 merged and tag `v0.2.1` was pushed.

- Release PR: [PR #33](https://github.com/flyingrobots/colorful-language/pull/33)
- Release commit SHA: `3ff6a1d317cd8df30a8ac86a30077f4282484544`
- Tag `v0.2.1` object SHA: `212e9fc984310dffbd2c24bc209a40b718aa6383`
- Tag target commit SHA: `3ff6a1d317cd8df30a8ac86a30077f4282484544`
- `Release` workflow run: ✅ pass; [run 28114921733](https://github.com/flyingrobots/colorful-language/actions/runs/28114921733)
- GitHub Release: ✅ published at `2026-06-24T16:53:10Z`; [release v0.2.1](https://github.com/flyingrobots/colorful-language/releases/tag/v0.2.1)
- Release assets:
  - `colorful-language-v0.2.1-x86_64-unknown-linux-gnu.tar.gz`
  - `colorful-language-v0.2.1-x86_64-unknown-linux-gnu.tar.gz.sha256`
- crates.io @ 0.2.1: ✅ all seven workspace crates visible.

| Crate | crates.io checksum |
| --- | --- |
| `colorful-core` | `8727f9b235a4943b03b4dfe28a584816983c4b3b855f0b404e3c681d26aa8cc1` |
| `colorful-lexicon` | `8a7c45364a0d090e77a404bda0d6fc09f8ff46ca734b4cabf4cd18cf6b76639d` |
| `colorful-parse` | `bb123b66ef04c43a752b2ad9997b8a11886b39ccfdbf785062ecd2546990e77b` |
| `colorful-ir` | `401bd382504109f6e8101f8068e649ff333c8671159cf67f99c0d35228bc6302` |
| `colorful-lint` | `2fea14229717b5d26ac6b07afd90ee191b8be1129af733fabbb1e74ec806746e` |
| `colorful-cli` | `f323c30fd47037aad375f2bead7d1408e401a28bd9b7bf0de988730637f3789d` |
| `colorful-lsp` | `39b638d5e75244070864edc206579e014ade955b984d8fd33f11e49698b6e926` |

## Non-blocking notes

- Release binaries are `x86_64-unknown-linux-gnu` only; macOS/Windows/aarch64
  artifacts are a future cross-build addition.
