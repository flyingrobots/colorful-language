# colorful-language v0.1.0 — Verification Witness

Record of the release execution. Never claim success for a step not directly
run and observed.

## Discovery

- Target version: `0.1.0`
- Branch (prep): `release/v0.1.0-prep`
- Workspace version (`Cargo.toml`): `0.1.0`
- Latest existing `v*` tag: _(none — first release)_

## Validation gate (prep)

Run on the prep branch before opening the release PR. Record exit status.

| Step | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --all -- --check` | ✅ pass |
| Clippy | `cargo clippy --locked --all-targets --all-features -- -D warnings` | ✅ pass |
| Tests | `cargo test --all --locked` | ✅ pass (50 tests) |
| Release build | `cargo build --release --locked` | ✅ pass |
| Markdown | `markdownlint-cli2 "**/*.md"` | ✅ pass (0 errors) |
| Workflows | `actionlint .github/workflows/*.yml` | ✅ pass |
| Whitespace | `git diff --check <empty-tree> HEAD` | ✅ pass |

## Tag and publish

Released 2026-06-21. The `Release` workflow verified-tag-on-main, re-ran the gate,
published all five crates in dependency order, built the binaries, and created
the GitHub Release — all steps green.

- Release commit SHA: `177ccb26209aae1a70e9233c72e0abaf221a78fa`
- Tag `v0.1.0` SHA: `0dcfc712b11a0bc104e0a5410f5eed57f119f8b0`
- `Release` workflow run:
  <https://github.com/flyingrobots/colorful-language/actions/runs/27919724648>
- GitHub Release:
  <https://github.com/flyingrobots/colorful-language/releases/tag/v0.1.0>
- crates.io @ 0.1.0 (all published, owned by `flyingrobots`):
  [colorful-core](https://crates.io/crates/colorful-core),
  [colorful-lexicon](https://crates.io/crates/colorful-lexicon),
  [colorful-parse](https://crates.io/crates/colorful-parse),
  [colorful-cli](https://crates.io/crates/colorful-cli),
  [colorful-lsp](https://crates.io/crates/colorful-lsp)

## Non-blocking notes

- Release binaries are `x86_64-unknown-linux-gnu` only; macOS/Windows/aarch64
  artifacts are a future cross-build addition.
