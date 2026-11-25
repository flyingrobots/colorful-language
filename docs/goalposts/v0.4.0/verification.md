# colorful-language v0.4.0 — Verification Witness

This witness is append-only release evidence. A step is marked complete only
after its command or public oracle has been observed.

## Status

- Target version: `0.4.0`
- Previous public tag: `v0.3.0`
- Release phase: tagged.
- Packet-planning issue:
  [#280](https://github.com/flyingrobots/colorful-language/issues/280)
- Publication authorities:
  [#154](https://github.com/flyingrobots/colorful-language/issues/154) and
  [#37](https://github.com/flyingrobots/colorful-language/issues/37)
- Annotated `v0.4.0` tag: available. Tag object
  `ed2fd33febf5486ac0f5e0e100e328560b6c2f34` resolves to commit
  `bc17f09d6dec7a5fd7418a26c8f5d7066795583f`. It was pushed on 2026-11-24
  (Pacific time) on the owner's authorization
  ([#345](https://github.com/flyingrobots/colorful-language/issues/345)).
- Tag workflow: publish workflow run
  [45537925550](https://github.com/flyingrobots/colorful-language/actions/runs/45537925550)
  failed in the `Validate release admission` job at the step
  `Self-test release packet policy`, because the packet check then rejected a
  pre-publication witness on the tagged commit
  ([#370](https://github.com/flyingrobots/colorful-language/issues/370)). The
  native-binary and build-and-publish jobs were skipped. No crate, archive,
  VSIX, or GitHub Release was published for `v0.4.0`.

## Pre-publication evidence

| Evidence | Oracle | Result |
| --- | --- | --- |
| Scope reconciliation | `git log --first-parent v0.3.0..origin/main`; open issue and PR inventory; `CHANGELOG.md` ledger | Pass on 2026-08-07. The initial inventory was taken against `main` at `506313898c9a4e87ce41d146844d6c1a26ee63b9`: 110 first-parent commits, 24 open issues, and one open pull request — release-prep [PR #294](https://github.com/flyingrobots/colorful-language/pull/294). Reconciled after that PR merged as `4b9529b0ce44bc5b74ec0dfeac8565b5276bfb08` and before opening the reconciliation slice [#301](https://github.com/flyingrobots/colorful-language/issues/301): 111 first-parent commits, 23 open issues, and one open pull request — [PR #300](https://github.com/flyingrobots/colorful-language/pull/300). At that point PR #300 was outside the prepared 0.4.0 packet: its [#257](https://github.com/flyingrobots/colorful-language/issues/257) work was parked, and its release-visible entry stayed under `Unreleased`, to be held until after the v0.4.0 release boundary unless the packet was deliberately reopened and fully revalidated. The synchronized 0.4.0 manifests, 21 Markdown files across 10 topic homes, and the dated 0.4.0 changelog ledger were then the admitted release scope. The packet was reopened on 2026-11-24 by the reconciliation slice [#359](https://github.com/flyingrobots/colorful-language/issues/359). Against `main` at `345969f7c48b5919d6a4a5f6dfa1019c25aaf7ad` there are 121 first-parent commits since `v0.3.0`, ten of them after the release-prep merge (PRs #302, #332, #338, #300, #347, #307, #348, #349, #351, and #353), 29 open issues including #359, and seven open pull requests: this reconciliation [PR #364](https://github.com/flyingrobots/colorful-language/pull/364), the draft spike [PR #325](https://github.com/flyingrobots/colorful-language/pull/325), and Dependabot PRs #354 through #358, which are held until after the tag. PR #300 merged as `ae8ed4a33ace8338dd9a6da50ec961cc8f027b04` and is no longer held. Its release-visible entry and those of PRs #338, #347, #348, #349, and #353 move from `Unreleased` into the 0.4.0 ledger, now dated 2026-11-24; only the coverage-baseline note stays under `Unreleased`. PRs #302, #332, #307, and #351 added no `Unreleased` entry. PR #338 carried Dependabot PRs #316, #318, #320, #321, #323, #324, #331, and #333, which show as merged; Dependabot PRs #314 and #346 were closed without merging. The reopened scope is revalidated only when final preflight passes on the commit to be tagged. |
| Release packet policy | `node --test scripts/check-release-packet.test.mjs`; `node scripts/check-release-packet.mjs` | Pass on 2026-08-07 at release-prep candidate `13f4dfbd5edb3b97aa5cd7fcbc779d9f7754d28c`: 49/49 tests; the live packet admitted four uniquely labeled goalposts with observable oracles and 34 inline/reference-inventoried scoped issues. The 2026-11-24 reconciliation rerun on the [#359](https://github.com/flyingrobots/colorful-language/issues/359) branch, based on `main` at `345969f7c48b5919d6a4a5f6dfa1019c25aaf7ad`, passes 49/49 tests; the live packet admits four goalposts and 37 inline/reference-inventoried scoped issues. |
| Release profile | `bash scripts/release-profile-check.sh` | Pass on 2026-08-07 at release-prep candidate `13f4dfbd5edb3b97aa5cd7fcbc779d9f7754d28c`: workspace version 0.4.0. The 2026-11-24 reconciliation rerun passes with workspace version 0.4.0. |
| Coverage policy | `node --test scripts/check-coverage-policy.test.mjs` | Pass on 2026-08-07: 25/25 tests. The versioned policy in `.github/coverage-policy.json` is unchanged across the release boundary; exact uncovered-line ceilings ratchet the 94.00% measured workspace baseline under a 92% floor. The 2026-11-24 reconciliation rerun passes 40/40 tests; `.github/coverage-policy.json` is unchanged since the release-prep merge, and the `Unreleased` coverage note still quotes that baseline. |
| Roadmap inventory | `node scripts/check-roadmap-inventory.mjs`; `node scripts/check-roadmap-inventory.mjs --live --repo flyingrobots/colorful-language --closing-pr 302` | The historical release-prep check passed on 2026-08-07 with 61 primary markers and 16 open slices while treating #293 as delivered by PR #294. The post-merge structural and live refresh passes with 62 primary markers and 16 open slices while treating [#301](https://github.com/flyingrobots/colorful-language/issues/301) as delivered by [PR #302](https://github.com/flyingrobots/colorful-language/pull/302). The 2026-11-24 reconciliation structural check passes with 66 primary markers; its live result for [PR #364](https://github.com/flyingrobots/colorful-language/pull/364) is not yet recorded. |
| Documentation lint | `npx markdownlint-cli2 '**/*.md'` | Pass on 2026-08-07: 74 files, 0 errors. The 2026-11-24 reconciliation rerun passes: 73 files, 0 errors. |
| Unified release preparation | `mise exec node@22.23.1 -- bash scripts/release-prep.sh` | Pass on 2026-08-07 at release-prep candidate `13f4dfbd5edb3b97aa5cd7fcbc779d9f7754d28c`: 49/49 release-packet cases, 80 IR-validator mutations with zero survivors, eight packaged crates, cross-language and independent-consumer witnesses, isolated VSIX install smoke, Zed compilation, and `RELEASE PREP PASSED`. It has not passed on `main` at `345969f7c48b5919d6a4a5f6dfa1019c25aaf7ad`: the 2026-11-24 final preflight that runs it stopped at `cargo test`, as the final-preflight row records. |
| Pull-request CI | Required CI and security check rollup | The historical packet-admission rollup passed on [PR #282](https://github.com/flyingrobots/colorful-language/pull/282). The final release-prep [PR #294](https://github.com/flyingrobots/colorful-language/pull/294) head `384d49279a8f78903c0ff9713a411ae02dcd7548` passed its complete hosted rollup on 2026-08-07: the latest result for each of 18 distinct checks was successful before merge as `4b9529b0ce44bc5b74ec0dfeac8565b5276bfb08`. Superseded cancelled runs were excluded by taking the latest result per check name. |
| Review | CodeRabbit exact-head review plus zero unresolved GraphQL threads | Pass on 2026-08-07 for release-prep [PR #294](https://github.com/flyingrobots/colorful-language/pull/294) head `384d49279a8f78903c0ff9713a411ae02dcd7548`: the CodeRabbit check completed successfully under the documented rate-limit disposition, and a cursor-complete GraphQL audit found zero unresolved threads across all six review threads. |
| Release tracker | `[release] v0.4.0`, created from the reviewed packet after merge | [#283](https://github.com/flyingrobots/colorful-language/issues/283) created on the Product Maturity goalpost from the reviewed packet. |
| Final preflight | `bash scripts/release-preflight.sh v0.4.0` on clean, aligned `main` | The 2026-08-07 snapshot had 28 of 30 scoped slices closed, with [#154](https://github.com/flyingrobots/colorful-language/issues/154) and [#37](https://github.com/flyingrobots/colorful-language/issues/37) still open, and release-prep PR #294 merged as `4b9529b0ce44bc5b74ec0dfeac8565b5276bfb08`. The #154 acceptance path became the credential-free GitHub Release VSIX implemented by [PR #307](https://github.com/flyingrobots/colorful-language/pull/307), which merged on 2026-11-24 as `fa73b320500470fd26801d6ffe23a3a83e45c0ed` and completed #154; the release tracker owns the still-unavailable public URL and clean-install witness. PR #300 also merged on 2026-11-24 and is inside the reconciled v0.4.0 scope rather than held after it. On 2026-11-24, 32 of the 33 scoped slices are closed; #37 remains open as may-slip work. Final preflight ran on 2026-11-24 from clean, aligned `main` at `345969f7c48b5919d6a4a5f6dfa1019c25aaf7ad` and exited with status 101: it stopped at `cargo test` in the `colorful-vale` test `timeout_and_process_failure_are_distinct`, and the later release-prep steps did not run in that pass. [#359](https://github.com/flyingrobots/colorful-language/issues/359) records the observed failure. Preflight has not passed; it must pass from clean, aligned `main` on the exact commit to be tagged, after this reconciliation lands. No tag or publication is authorized by this witness. |

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
| VS Code VSIX | GitHub Release asset URL, SHA-256 sidecar, attestation, and downloaded-byte parity with the smoke witness | Not available. |
| Zed | Versioned GitHub Release source archive and attestation; optional registry pull-request state | Not available. |
| Homebrew formula | Attested GitHub Release formula asset | Not available. |
| Software bill of materials | Two CycloneDX assets, one per shipped binary, with JSON well-formedness and GitHub attestation verification | Not available. |
| GitHub Release | Release URL and full asset inventory | Not available. |

## Public verification

Evidence state: unavailable.

Public verification is not available. After publication, record the exact
commands, host/toolchain identity, timestamps, public URLs, and results for:

- clean-machine CLI and LSP installation on every supported native platform;
- `colorful --version`, CLI input contracts, and the real LSP transcript;
- manual GitHub Release VSIX installation, activation, semantic tokens,
  diagnostics, theme fallback, install-to-first-highlight timing, removal, and
  previous-compatible-asset reinstall when one exists;
- Zed source-archive inventory and isolated build, plus registry installation
  only when an external submission is accepted;
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
