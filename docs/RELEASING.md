# Releasing

A release happens when externally meaningful behavior changes. It is not just a
tag plus a changelog edit: it is a deliberate packet that says what is shipping,
why this version number is correct, and what is *not* claimed.

This is the lean, cargo-native runbook for `colorful-language`. (It follows the
shape of the `wesley` release process — guards → versioning → validation → tag →
publish — without that repo's bespoke `xtask`/pnpm/crates.io machinery.)

## Required artifacts per release

| Artifact | Purpose |
| --- | --- |
| `docs/goalposts/vX.Y.Z/release.md` | The release packet: scope, version justification, explicit non-claims, acceptance. |
| `docs/goalposts/vX.Y.Z/verification.md` | The witness: commands run, results, tag/commit SHAs, Release URL. Filled at tag time. |
| `CHANGELOG.md` | The historical ledger of externally meaningful change (Keep a Changelog). |
| Git tag `vX.Y.Z` + GitHub Release | The shipped surface. |

The crate versions are kept in lock-step via `Cargo.toml`'s `workspace.package`.
`README.md` may link to durable release surfaces (the Releases page, the
changelog) but must not become a per-version release log.

## Runbook

### Phase 0 — Discovery

Record, before changing anything: the current branch, exact sync state vs
`origin/main`, the latest `v*` tag, the workspace version, and the intended
target version. If any cannot be determined confidently, stop.

### Phase 1 — Guards

Stop at the first failure:

1. Working tree is clean.
2. The release-prep work is on a branch (not committed directly to `main`).
3. `git fetch origin main --tags` succeeds and the prep branch is current with
   `origin/main`.
4. The target tag does not already exist locally or on the remote.

### Phase 2 — Versioning and notes

1. Confirm the target version matches the release scope and SemVer impact
   (pre-1.0: breaking changes bump the minor).
2. Set `workspace.package.version` (lock-step for all crates).
3. Promote `CHANGELOG.md` `[Unreleased]` to `[X.Y.Z] - <date>`; add a fresh
   empty `[Unreleased]` and the compare links.
4. Write `docs/goalposts/vX.Y.Z/release.md` (the packet).
5. Update `ROADMAP.md` status for any goalpost the release completes.

### Phase 3 — Validation (the gate)

Run, in order, and stop on the first failure:

```bash
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --all --locked
bash scripts/package-witness.sh
cargo build --release --locked
markdownlint-cli2 "**/*.md"
actionlint .github/workflows/*.yml
git diff --check "$(git hash-object -t tree /dev/null)" HEAD
```

Do not claim success from queued or in-progress CI. This is the full pre-merge
release gate.

The tag-triggered `Release` workflow verifies that the tag is on `main` and then
repeats the Rust fmt, clippy, test, and release-build guard. It does not repeat
the package witness, Markdown lint, workflow lint, whitespace checks, the IR
witness, or editor integration compilation; those surfaces must already be green
on the merged PR.

### Phase 4 — Commit, tag, publish

1. Open the release-prep PR; merge it to `main` after CI is green.
2. On the merged `main`, create an annotated tag:
   `git tag -a vX.Y.Z -m "colorful-language vX.Y.Z"`.
3. Verify the tag points at the release commit.
4. Push the tag: `git push origin vX.Y.Z`. This triggers
   [`.github/workflows/release.yml`](../.github/workflows/release.yml), which
   verifies the tag is on `main`, repeats the Rust final guard, publishes the
   crates, builds the `colorful` and `colorful-lsp` binaries, and creates the
   GitHub Release.
5. Record the witness in `docs/goalposts/vX.Y.Z/verification.md`: commands,
   results, tag/commit SHAs, and the Release URL.

## Pre-tag sign-off (human judgement)

Copy into the release-prep PR body and complete before tagging:

- [ ] **CHANGELOG reflects the actual diff.** `git log <prev-tag>..HEAD --oneline`
      accounts for every user-visible change; nothing significant is silently
      absent.
- [ ] **Living docs are current.** The `docs/topics/` references and crate
      READMEs describe behavior that exists on `main` (no stale ports, claims, or
      examples).
- [ ] **No known issue silently shipped.** Open issues affecting this release's
      correctness are either fixed or acknowledged in the CHANGELOG / a follow-on
      issue.
- [ ] **Version is justified.** The packet's version justification matches the
      SemVer impact of the diff.

## crates.io

The seven crates publish to crates.io under flat, idiomatic names
(`colorful-core`, `colorful-lexicon`, `colorful-parse`, `colorful-ir`,
`colorful-lint`, `colorful-cli`, `colorful-lsp`) — crates.io has no `@scope/`
namespacing; org identity comes from **ownership** and the `repository` link. The
release workflow publishes them in dependency order: `colorful-core` →
`colorful-lexicon`, `colorful-parse` → `colorful-ir`, `colorful-lint` →
`colorful-cli`, `colorful-lsp`. (`colorful-ir` and `colorful-lint` arrived after
v0.1.0, which shipped only the first five.)

**Prerequisites (one-time):**

- A `CARGO_REGISTRY_TOKEN` repository secret holding a crates.io API token for
  the `flyingrobots` account. Without it, the `Publish to crates.io` step fails
  and no GitHub Release is created (the tag is harmless to re-run).
- After the first publish, the crates are owned by `flyingrobots`. Add any
  additional owners with `cargo owner --add <user-or-team> <crate>`.

Validate locally before tagging:

```bash
cargo publish --dry-run -p colorful-core --locked
```

Dependent crates can only dry-run once their dependencies are already on
crates.io; the workflow's ordered publish handles that on the real run. Note that
crates.io versions are **immutable** (yank-only) — a tagged version is permanent.
