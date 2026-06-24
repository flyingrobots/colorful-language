# colorful-language v0.2.0 — Verification Witness

Record of the release execution. Never claim success for a step not directly
run and observed.

## Discovery

- Target version: `0.2.0`
- Branch (prep): `release/v0.2.0`
- Workspace version (`Cargo.toml`): `0.2.0`
- Latest existing `v*` tag before prep: `v0.1.0`
- Previous release: `v0.1.0`
- Target tag existed before prep: no local or remote `v0.2.0` tag found.

## Validation gate (prep)

Run on the prep branch before opening the release PR. Record exit status.

| Step | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --all -- --check` | ✅ pass |
| Clippy | `cargo clippy --locked --all-targets --all-features -- -D warnings` | ✅ pass |
| Tests | `cargo test --all --locked` | ✅ pass (100 unit tests) |
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
| VS Code extension | `npm run compile` in `editors/vscode` | ✅ pass; package version `0.2.0`. |
| Zed extension | `cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1` | ✅ pass; package version `0.2.0`. |

## crates.io dry-run

| Crate | Command | Result |
| --- | --- | --- |
| `colorful-core` | `cargo publish --dry-run -p colorful-core --locked` | ✅ pass; packaged 5 files and verified `colorful-core v0.2.0`. |

## Tag and publish

Failed on 2026-06-24. The tag workflow verified the tag was on `main`, passed the
Rust final guard, and then stopped during `Publish to crates.io` while verifying
the `colorful-ir` package tarball.

- Release commit SHA: `088b7b7281d5e246ce8b61911ee7792aaa007d2e`
- Tag `v0.2.0` SHA: `d88381ed063b8b9c01f82209a6a114d79b8188ec`
- `Release` workflow run:
  <https://github.com/flyingrobots/colorful-language/actions/runs/28085545997>
- Failed job:
  <https://github.com/flyingrobots/colorful-language/actions/runs/28085545997/job/83150525231>
- Failure: `colorful-ir` used `include_str!` for root-level `contracts/` files
  that were not present in the crate package tarball.
- crates.io @ 0.2.0:
  [colorful-core](https://crates.io/crates/colorful-core),
  [colorful-lexicon](https://crates.io/crates/colorful-lexicon), and
  [colorful-parse](https://crates.io/crates/colorful-parse) published before the
  workflow stopped.
- Not published at 0.2.0:
  `colorful-ir`, `colorful-lint`, `colorful-cli`, and `colorful-lsp`.
- GitHub Release: not created.
- Recovery: `v0.2.1`.

## Non-blocking notes

- Release binaries are `x86_64-unknown-linux-gnu` only; macOS/Windows/aarch64
  artifacts are a future cross-build addition.
