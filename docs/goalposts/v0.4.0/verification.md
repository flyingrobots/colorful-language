# colorful-language v0.4.0 — Verification Witness

This witness is append-only release evidence. A step is marked complete only
after its command or public oracle has been observed.

## Status

- Target version: `0.4.0`
- Previous public tag: `v0.3.0`
- Release phase: pre-publication.
- Packet-planning issue:
  [#280](https://github.com/flyingrobots/colorful-language/issues/280)
- Publication authorities:
  [#154](https://github.com/flyingrobots/colorful-language/issues/154) and
  [#37](https://github.com/flyingrobots/colorful-language/issues/37)
- Annotated `v0.4.0` tag: not available.

## Pre-publication evidence

| Evidence | Oracle | Result |
| --- | --- | --- |
| Scope reconciliation | `git log --first-parent v0.3.0..origin/main`; open issue and PR inventory; `CHANGELOG.md` ledger | Pass on 2026-08-07. The inventory was taken against `main` at `506313898c9a4e87ce41d146844d6c1a26ee63b9`: 110 first-parent commits, 24 open issues, and one open pull request — this release-prep [PR #294](https://github.com/flyingrobots/colorful-language/pull/294). The synchronized 0.4.0 manifests, 21 Markdown files across 10 topic homes, and the release-prep branch's complete 0.4.0 changelog ledger were reviewed after the canonical showcase and editor advisory repairs landed. |
| Release packet policy | `node --test scripts/check-release-packet.test.mjs`; `node scripts/check-release-packet.mjs` | Pass on 2026-08-07 at release-prep candidate `13f4dfbd5edb3b97aa5cd7fcbc779d9f7754d28c`: 49/49 tests; the live packet admitted four uniquely labeled goalposts with observable oracles and 34 inline/reference-inventoried scoped issues. |
| Release profile | `bash scripts/release-profile-check.sh` | Pass on 2026-08-07 at release-prep candidate `13f4dfbd5edb3b97aa5cd7fcbc779d9f7754d28c`: workspace version 0.4.0. |
| Coverage policy | `node --test scripts/check-coverage-policy.test.mjs` | Pass on 2026-08-07: 25/25 tests. The versioned policy in `.github/coverage-policy.json` is unchanged across the release boundary; exact uncovered-line ceilings ratchet the 94.00% measured workspace baseline under a 92% floor. |
| Roadmap inventory | `node scripts/check-roadmap-inventory.mjs`; `node scripts/check-roadmap-inventory.mjs --live --repo flyingrobots/colorful-language --closing-pr 294` | Pass on 2026-08-07: 61 primary markers were structurally valid, and 16 open slices agreed with the live GitHub inventory while treating #293 as delivered by this pull request. |
| Documentation lint | `npx markdownlint-cli2 '**/*.md'` | Pass on 2026-08-07: 74 files, 0 errors. |
| Unified release preparation | `mise exec node@22.23.1 -- bash scripts/release-prep.sh` | Pass on 2026-08-07 at release-prep candidate `13f4dfbd5edb3b97aa5cd7fcbc779d9f7754d28c`: 49/49 release-packet cases, 80 IR-validator mutations with zero survivors, eight packaged crates, cross-language and independent-consumer witnesses, isolated VSIX install smoke, Zed compilation, and `RELEASE PREP PASSED`. |
| Pull-request CI | Required CI and security check rollup | The historical packet-admission rollup passed on [PR #282](https://github.com/flyingrobots/colorful-language/pull/282). Release-prep PR #294 still requires a fresh exact-head hosted rollup after this witness refresh; the historical result does not admit the current candidate. |
| Review | CodeRabbit exact-head review plus zero unresolved GraphQL threads | Release-prep PR #294 requires a fresh exact-head review and a cursor-complete zero-unresolved-thread audit after this witness refresh. Earlier approvals do not admit the current candidate. |
| Release tracker | `[release] v0.4.0`, created from the reviewed packet after merge | [#283](https://github.com/flyingrobots/colorful-language/issues/283) created on the Product Maturity goalpost from the reviewed packet. |
| Final preflight | `bash scripts/release-preflight.sh v0.4.0` on clean, aligned `main` | Release scope is disposed as of 2026-08-07: 28 of 30 scoped slices are closed, with [#154](https://github.com/flyingrobots/colorful-language/issues/154) and [#37](https://github.com/flyingrobots/colorful-language/issues/37) inherently post-tag, and release-prep PR #294 is the sole open pull request. The preflight refuses to run outside `main`, so it executes from aligned `main` only after this change merges. Its result is not yet recorded; no tag or publication is authorized by this witness. |

## Publication evidence

Evidence state: unavailable.

Publication evidence is not available. The following rows are filled
from the immutable tag workflow; this packet does not authorize or claim those
side effects.

| Surface | Required evidence | Result |
| --- | --- | --- |
| Tag | Annotated `v0.4.0` tag and target commit | Not available. |
| Publish workflow | GitHub Actions run URL and final conclusion | Not available. |
| crates.io | All eight `cargo info <crate>@0.4.0` registry oracles | Not available. |
| Native archives | Three archive URLs, SHA-256 sidecars, and GitHub attestation verification | Not available. |
| VS Code Marketplace | Public version URL and downloaded VSIX SHA-256 parity | Not available. |
| Open VSX | Public version URL and downloaded VSIX SHA-256 parity | Not available. |
| Zed | Versioned source archive, attestation, and registry pull request | Not available. |
| Homebrew formula | Attested GitHub Release formula asset | Not available. |
| Software bill of materials | Two CycloneDX assets, one per shipped binary, with JSON well-formedness and GitHub attestation verification | Not available. |
| GitHub Release | Release URL and full asset inventory | Not available. |

## Public verification

Evidence state: unavailable.

Public verification is not available. After publication, record the exact
commands, host/toolchain identity, timestamps, public URLs, and results for:

- clean-machine CLI and LSP installation on every supported native platform;
- `colorful --version`, CLI input contracts, and the real LSP transcript;
- VS Code Marketplace and Open VSX clean installation, activation, semantic
  tokens, diagnostics, theme fallback, and install-to-first-highlight timing;
- Zed registry installation when the external submission is accepted;
- Homebrew install, upgrade, and rollback after a public tap exists;
- checksum, provenance, and public-package byte verification;
- one bounded rollback or patch-forward rehearsal per release channel.

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
