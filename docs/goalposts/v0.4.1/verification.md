# colorful-language v0.4.1 — Verification Witness

This witness is append-only release evidence. A step is marked complete only
after its command or public oracle has been observed.

## Status

- Target version: `0.4.1`
- Previous public tag: `v0.4.0`
- Previous tag status: `v0.4.0` was tagged and never published, and
  the last published release is `v0.3.0`. The annotated `v0.4.0` tag points at
  `bc17f09d6dec7a5fd7418a26c8f5d7066795583f`; its publish workflow failed at
  admission validation, and its witness is at the terminal `abandoned` phase
  with `v0.4.1` named as the version that carries its work forward
  ([v0.4.0 witness](../v0.4.0/verification.md)). Scope is reconciled against
  `v0.4.0`; the user-facing notes and the changelog preface describe the
  upgrade from `v0.3.0`, as the owner decided on
  [#380](https://github.com/flyingrobots/colorful-language/issues/380).
- Release phase: pre-publication.
- Release-preparation issue:
  [#388](https://github.com/flyingrobots/colorful-language/issues/388)
- Release tracker: `[release] v0.4.1` does not exist yet. It is created from
  the reviewed packet after merge, and the `v0.4.0` tracker
  [#283](https://github.com/flyingrobots/colorful-language/issues/283) is then
  closed as superseded, as the owner decided on
  [#381](https://github.com/flyingrobots/colorful-language/issues/381).
- Annotated `v0.4.1` tag: not available.

## Pre-publication evidence

| Evidence | Oracle | Result |
| --- | --- | --- |
| Scope reconciliation | `git log --first-parent v0.4.0..origin/main`; `git diff --stat v0.4.0 origin/main`; open issue and PR inventory; `CHANGELOG.md` ledger | Pass on 2026-11-26 against `main` at `f37f5fd3f469201768f20fa639445995778da822`. Since `v0.4.0` there are 10 first-parent commits, the merges of PRs #369, #373, #372, #377, #389, #376, #391, #390, #392, and #393, carrying 51 non-merge commits that change 23 files and work for issues #345, #370, #371, #375, #384, #374, #385, #386, #383, and #387. No file under `crates/`, `contracts/`, `consumers/`, `editors/`, or `fuzz/` changed, so the released source is the `v0.4.0` source apart from the version lines this preparation changes. There are 26 open issues, including #388 and the `v0.4.0` tracker #283, and seven open pull requests: this release preparation, the draft spike [PR #325](https://github.com/flyingrobots/colorful-language/pull/325), and Dependabot PRs #354 through #358, which stay held until after the tag. The `Unreleased` entries for #371, #384, #385, #387, #374, #386, #370, and #383 move into the dated `0.4.1` ledger; only the coverage-baseline note stays under `Unreleased`. |
| Version sources | `bash scripts/release-profile-check.sh`; `node scripts/check-editor-version-policy.mjs`; `git diff --stat` of the version change | Pass on 2026-11-26: `Release profile OK for workspace version 0.4.1` and `check-editor-version-policy passed: 8 source(s) at 0.4.1; colorful-lsp >=0.4.0 <0.5.0`. The lockfiles were regenerated with `cargo update -w --offline` (root and Zed), `cargo metadata --manifest-path fuzz/Cargo.toml --offline`, and `npm version 0.4.1 --no-git-tag-version` (VS Code); across the eight files the diff is 24 changed lines, each a workspace package's own version moving from 0.4.0 to 0.4.1, and no dependency moved. The internal dependency requirements stay `version = "0.4.0"`, which Cargo reads as `^0.4.0` and 0.4.1 satisfies. |
| Release packet policy | `node --test scripts/check-release-packet.test.mjs`; `node scripts/check-release-packet.mjs` | Pass on 2026-11-26 at preparation-branch commit `a4fbc1c229978c4f8daa27052e741eb7d3830909`: 66/66 tests, and `check-release-packet: v0.4.1 pre-publication packet satisfied (3 goalposts, 18 scoped issues)`, with the `v0.4.0` witness admitted as an `abandoned` predecessor. |
| Coverage policy | `node --test scripts/check-coverage-policy.test.mjs` | Pass on 2026-11-26: 40/40 tests. `.github/coverage-policy.json` is unchanged, and the coverage-baseline note is the only entry left under `Unreleased`. |
| Roadmap inventory | `node scripts/check-roadmap-inventory.mjs`; `node scripts/check-roadmap-inventory.mjs --live --repo flyingrobots/colorful-language --closing-pr 394` | Pass on 2026-11-26: 67 primary markers are structurally valid, and the live check finds 14 open slices and 67 primary markers in agreement for [PR #394](https://github.com/flyingrobots/colorful-language/pull/394). #388 carries no `slice` label, so its roadmap entry has no primary marker; #283 keeps its active marker until it is closed. |
| Unified release preparation | `mise exec node@22.23.1 -- bash scripts/release-prep.sh` | Pass on 2026-11-26 at preparation-branch commit `a4fbc1c229978c4f8daa27052e741eb7d3830909` under Node 22.23.1: `Release profile OK for workspace version 0.4.1`, 66/66 release-packet cases, eight version sources at 0.4.1, 80 IR-validator mutants tested with zero survivors (63 caught, 17 unviable), 56 `test result: ok` lines with no failed test binary, `PACKAGE WITNESS PASSED`, the cross-language, independent-consumer, local VSIX install, and Zed compile witnesses, 76 Markdown files with zero errors, and `RELEASE PREP PASSED`. |
| Pull-request CI | Required CI and security check rollup | Recorded for the final head of the release-preparation pull request. |
| Release tracker | `[release] v0.4.1`, created from the reviewed packet after merge | Not created; it follows the merge of this packet. |
| Final preflight | `bash scripts/release-preflight.sh v0.4.1` on clean, aligned `main` | Not run; it is an owner action after merge, from clean, aligned `main`. |
| Release workflow dry run | `gh workflow run release.yml --repo flyingrobots/colorful-language --ref main` on the commit that passed final preflight | Not run; it follows final preflight and precedes the tag. |

## Publication evidence

Evidence state: unavailable.

Publication evidence is not available. The following rows are filled from
the immutable tag workflow; this packet does not authorize or claim those
side effects.

| Surface | Required evidence | Result |
| --- | --- | --- |
| Tag | Annotated `v0.4.1` tag and target commit | Not available. |
| Publish workflow | GitHub Actions run URL and final conclusion | Not available. |
| crates.io | All eight `cargo info <crate>@0.4.1` registry oracles | Not available. |
| Native archives | Three archive URLs, SHA-256 sidecars, and GitHub attestation verification | Not available. |
| VS Code VSIX | GitHub Release asset URL, SHA-256 sidecar, attestation, and downloaded-byte parity with the smoke witness | Not available. |
| Zed | Versioned GitHub Release source archive and attestation; optional registry pull-request state | Not available. |
| Homebrew formula | Attested GitHub Release formula asset | Not available. |
| Software bill of materials | Two CycloneDX assets, one per shipped binary, with JSON well-formedness and GitHub attestation verification | Not available. |
| GitHub Release | Release URL and full asset inventory | Not available. |

## Public verification

Evidence state: unavailable.

Public verification is not available. After publication, record the exact
commands, host and toolchain identity, timestamps, public URLs, and results
for:

- clean-machine CLI and LSP installation on every supported native platform;
- `colorful --version`, CLI input contracts, and the real LSP transcript;
- manual GitHub Release VSIX installation, activation, semantic tokens,
  diagnostics, theme fallback, install-to-first-highlight timing, and removal;
- Zed source-archive inventory and isolated build, plus registry installation
  only when an external submission is accepted;
- Homebrew install, upgrade, and rollback after a public tap exists;
- checksum, provenance, and public-package byte verification;
- one bounded patch-forward rehearsal per release channel, because no earlier
  compatible release of the 0.4 line exists to roll back to.

Until those oracles run, current-reference publication claims remain absent.

## Retrospective

Evidence state: unavailable.

The release retrospective is pending and therefore not available. After public
verification, record:

- planned versus actual scope;
- must-ship, may-slip, and excluded outcomes;
- publication failures, reruns, or operator interventions;
- user-visible regressions and fallout issues;
- repeatable wins and process changes;
- the next release or patch recommendation.
