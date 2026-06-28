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
| Release profile | `bash scripts/release-profile-check.sh` | ✅ pass; profile matched workspace version `0.3.0`, release signposts, workflows, scripts, and all seven crate versions in `Cargo.lock`. |
| Unified release prep | `bash scripts/release-prep.sh` | ✅ pass; ran profile, Rust fmt/clippy/test, package witness, release build, IR witness with TypeScript contract checking, Graft consumer, VS Code compile, locked Zed compile, Markdown lint, `actionlint`, and whitespace checks. |

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
| Zed source extension | `cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1 --locked` | ✅ pass. |

PR CI also records hosted evidence for these non-tag surfaces through the
`IR cross-language round-trip witness` and `Editor integrations (compile)` jobs.

## crates.io dry-run

| Crate | Command | Result |
| --- | --- | --- |
| `colorful-core` | `cargo publish --dry-run -p colorful-core --locked` | ✅ pass; packaged and verified `colorful-core v0.3.0`, then aborted upload because this was a dry run. |

## Release signpost audit

Run after PR #55 merged and before the public tag was pushed.

| Surface | Command / review | Result |
| --- | --- | --- |
| Topic corpus shape | `find docs/topics -maxdepth 2 -type f \| sort`; per-topic README/test-plan check | ✅ pass; every product topic has a `README.md` and `test-plan.md`, and every topic is linked from `docs/README.md`. |
| Topic corpus routing | `rg "release process\|release-process" docs/topics docs/README.md` | ✅ pass; release-process material lives under `docs/workflows/release-process/`, not product-facing `docs/topics/`. |
| Topic current truth | Diff and grep review against `v0.2.1..HEAD` | ✅ pass; v0.3.0 product surfaces are covered by topic homes: open-class POS, coloring/diagnostic JSON, IR/vocabulary, editor integrations, downstream consumers, and distribution. |
| Topic docs lint | `markdownlint-cli2 "**/*.md"` | ✅ pass; 48 Markdown files, 0 errors. |

## Tag and publish

| Step | Evidence | Result |
| --- | --- | --- |
| Release-prep PR | [#53](https://github.com/flyingrobots/colorful-language/pull/53), merged at `d33c31e16c4ab276849d93e0190855760bb64bf5` | ✅ pass |
| Release lifecycle hardening PR | [#55](https://github.com/flyingrobots/colorful-language/pull/55), merged at `f97b9f5051de7b846892bd2ecf2576bc2567f1ee` | ✅ pass |
| Final preflight | `bash scripts/release-preflight.sh v0.3.0` on clean, aligned `main` | ✅ pass at `f97b9f5` |
| Tag | `git tag -a v0.3.0 -m "release: v0.3.0"`; `git push origin v0.3.0` | ✅ pushed; tag points at `f97b9f5051de7b846892bd2ecf2576bc2567f1ee`. |
| Publish workflow | [Release run 28307678276](https://github.com/flyingrobots/colorful-language/actions/runs/28307678276) | ✅ pass; profile, tag-on-main, fmt, clippy, tests, release build, package witness, crates.io publish, binary archive, and GitHub Release creation all succeeded. |
| GitHub Release | <https://github.com/flyingrobots/colorful-language/releases/tag/v0.3.0> | ✅ published as `colorful-language v0.3.0` at `2026-06-28T01:33:47Z`. |

## Public artifact verification

| Artifact | Command / evidence | Result |
| --- | --- | --- |
| GitHub Release archive | `gh release view v0.3.0 --json url,tagName,name,publishedAt,assets` | ✅ `colorful-language-v0.3.0-x86_64-unknown-linux-gnu.tar.gz`, SHA-256 digest `97ada48355026389ca4cf150eb99323a1bbebacacff303071e4710a135adb3f8`. |
| GitHub Release checksum | same `gh release view` query | ✅ `colorful-language-v0.3.0-x86_64-unknown-linux-gnu.tar.gz.sha256`, SHA-256 digest `aa9c474bc80a0f145b59fe55450e82ce1b766fda2eef2d7710f654714332478f`. |
| crates.io packages | `cargo info <crate>@0.3.0 --quiet` for all seven crates | ✅ `colorful-core`, `colorful-lexicon`, `colorful-parse`, `colorful-ir`, `colorful-lint`, `colorful-cli`, and `colorful-lsp` were all visible in the crates.io registry index. |
| CLI install smoke | `cargo install colorful-cli --version 0.3.0 --locked --root "$tmp_root"` | ✅ installed `colorful-cli v0.3.0` into a temporary root. |
| CLI version smoke | `"$tmp_root/bin/colorful" --version` | ✅ printed `colorful 0.3.0`. |
| Diagnostic JSON smoke | `"$tmp_root/bin/colorful" diagnose --json crates/colorful-cli/fixtures/editor-smoke-prose.txt` | ✅ emitted JSON containing the expected v0.3.0 visual roles (`NOUN`, `VERB`, `ADJECTIVE`, `ADVERB`, etc.) and LSP token types (`noun`, `verb`, `adjective`, `adverb`, etc.). |
| LSP install smoke | `cargo install colorful-lsp --version 0.3.0 --locked --root "$tmp_root"` | ✅ installed `colorful-lsp v0.3.0` into a temporary root. |

## Non-blocking notes

- Release binaries are `x86_64-unknown-linux-gnu` only; macOS/Windows/aarch64
  artifacts are a future cross-build addition.
- Homebrew packaging is tracked separately.
