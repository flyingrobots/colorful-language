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
| Scope reconciliation | `git log --first-parent v0.3.0..origin/main`; Unreleased `CHANGELOG.md`; open issue and PR inventory | Pass on 2026-07-29: 102 first-parent commits, 25 open issues, three open dependency-major PRs, synchronized 0.4.0 manifests, and 21 Markdown files across 10 topic homes reviewed. |
| Release packet policy | `node --test scripts/check-release-packet.test.mjs`; `node scripts/check-release-packet.mjs` | Pass on 2026-07-30 at reviewed head `f4e86311b598b6d0063b34edeb9d17342dc627bb`: 49/49 tests; live packet admitted four uniquely labeled goalposts with observable oracles and 33 inline/reference-inventoried scoped issues. |
| Release profile | `bash scripts/release-profile-check.sh` | Pass on 2026-07-29: workspace version 0.4.0. |
| Unified release preparation | `mise exec node@22.23.1 -- bash scripts/release-prep.sh` | Pass on 2026-07-30 at reviewed head `f4e86311b598b6d0063b34edeb9d17342dc627bb`: 49/49 release-packet cases, 80 IR-validator mutations with zero survivors, packaged editor smoke, and `RELEASE PREP PASSED`. |
| Pull-request CI | Required CI and security check rollup | Pass on 2026-07-29 for [PR #282](https://github.com/flyingrobots/colorful-language/pull/282): all 18 reported hosted checks passed before merge commit `cb95cb2b3295dae094e87d52d1b58ef8b1a49d7c`. |
| Review | CodeRabbit exact-head review plus zero unresolved GraphQL threads | Pass on 2026-07-29 at `d26530b4e26dac3549ab2a93da7bd5d2a023cc55`: CodeRabbit approved and a cursor-complete audit found zero unresolved threads. |
| Release tracker | `[release] v0.4.0`, created from the reviewed packet after merge | [#283](https://github.com/flyingrobots/colorful-language/issues/283) created on the Product Maturity goalpost from the reviewed packet. |
| Final preflight | `bash scripts/release-preflight.sh v0.4.0` on clean, aligned `main` | Pending completion or explicit disposition of the release scope; no tag or publication is authorized by this witness. |

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
