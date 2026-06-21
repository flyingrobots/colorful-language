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

Filled when the tag is cut on the merged `main`.

- Release commit SHA: _TBD_
- Tag `v0.1.0` SHA: _TBD_
- `Release` workflow run: _TBD_
- GitHub Release URL: _TBD_

## Non-blocking notes

- _none yet_
