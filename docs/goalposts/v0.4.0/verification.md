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
| Release packet policy | `node --test scripts/check-release-packet.test.mjs`; `node scripts/check-release-packet.mjs` | Pass on 2026-07-29: 24/24 tests; live packet admitted four goalposts and 33 scoped issues. |
| Release profile | `bash scripts/release-profile-check.sh` | Pass on 2026-07-29: workspace version 0.4.0. |
| Unified release preparation | `mise exec node@22.23.1 -- bash scripts/release-prep.sh` | Pass on 2026-07-29 at `b2303d0de30611fec6ce88a6bdaa3a3276a5b323`: 24 release-packet cases, 80 IR-validator mutations with zero survivors, packaged editor smoke, and `RELEASE PREP PASSED`. |
| Pull-request CI | Required CI and security check rollup | Pass on 2026-07-29 at pushed head `7a4f351693d5c9c3837bfd79583e0ca68a1083ad`: all 17 executable checks and CodeRabbit succeeded; the exact reviewed head remains pending push. |
| Review | CodeRabbit or Codex review plus zero unresolved GraphQL threads | Codex reported five actionable threads against the earlier pushed head; their regression fixes pass locally, and exact-head review and thread resolution remain pending push. |
| Release tracker | `[release] v0.4.0`, created from the reviewed packet after merge | Pending packet merge. |
| Final preflight | `bash scripts/release-preflight.sh v0.4.0` on clean, aligned `main` | Pending packet and tracker. |

## Publication evidence

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
| GitHub Release | Release URL and full asset inventory | Not available. |

## Public verification

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

The release retrospective is pending and therefore not available. After public
verification, record:

- planned versus actual scope;
- must-ship, may-slip, and excluded outcomes;
- publication failures, reruns, or operator interventions;
- user-visible regressions and fallout issues;
- repeatable wins and process changes;
- the next release or patch recommendation.
