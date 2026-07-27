# Merge-gate test plan

Verification for the protected `main` branch, its required evidence, and safe
recovery when a required check changes identity.

Canonical issue:
[#150](https://github.com/flyingrobots/colorful-language/issues/150).

## Requirements

- **MG-1** The active default-branch ruleset must require the nine authoritative
  CI contexts for documentation, Rust, package publication, IR interoperability,
  editor compilation, dependency policy, dependency review, and two-language
  CodeQL.
- **MG-2** Each required context must come from the GitHub Actions application,
  and pull requests must be tested against the latest default-branch state.
- **MG-3** Adding required checks must preserve the existing deletion,
  non-fast-forward, signed-commit, merge-only pull-request, review-thread, and
  bypass-actor policies.
- **MG-4** A pull request with a failing required check must be blocked without
  bypass, while a representative pull request with all required checks passing
  must remain eligible for a normal merge.
- **MG-5** Maintainers must have an exact, reviewable recovery procedure for a
  renamed or retired required context without weakening unrelated protections.
- **MG-6** Repository evidence must detect live ruleset drift with stable failure
  categories and a source-controlled desired-state manifest.
- **MG-7** A security job that rejects dependency or static-analysis failures
  must be a required status check rather than an advisory signal.

## Cases

- **MG-1a** — *Requirements:* MG-1, MG-2, MG-3, MG-6. *Behavior:* the
  source-controlled `mainline` manifest and live ruleset require
  `Docs & whitespace`, `Rust (fmt, clippy, test)`, `Cargo package witness`,
  `IR cross-language round-trip witness`, and
  `Editor integrations (compile)`, plus `Rust dependency policy`,
  `Dependency review`, `CodeQL (rust)`, and
  `CodeQL (javascript-typescript)` from GitHub Actions application `15368`, with
  strict default-branch freshness and enforcement on branch creation. The prior
  deletion, non-fast-forward, signature, pull-request, thread-resolution, and
  repository-role bypass settings remain unchanged. *Oracle:* a
  deterministic checker compares the governed live fields with the manifest and
  reports the first mismatch using a stable error category. The read-only CI
  token may omit bypass actors or return them as `null`; an explicit mode
  accepts only those redacted representations, while the privileged maintainer
  check remains strict and visible mismatches still fail.
  *Evidence type:* ruleset manifest, checker self-test, privileged live API
  inspection, and CI execution. *Evidence:*
  `.github/rulesets/mainline.json`,
  `scripts/check-main-ruleset.mjs`,
  `scripts/check-main-ruleset.test.mjs`, and the `docs` job in
  `.github/workflows/ci.yml`. *Status:* implemented.
- **MG-2a** — *Requirement:* MG-4. *Behavior:* a disposable pull request whose
  documentation check fails is reported as blocked even after its other
  required checks finish; no bypass merge is attempted. *Oracle:* the pull
  request check rollup names the failing required context and GitHub reports a
  blocked merge state. *Evidence type:* disposable GitHub pull request and
  ruleset evaluation. *Evidence:* closed, unmerged pull request
  [#183](https://github.com/flyingrobots/colorful-language/pull/183) and Actions
  run
  [30249653591](https://github.com/flyingrobots/colorful-language/actions/runs/30249653591);
  its remote branch was deleted after the proof. *Status:* implemented.
- **MG-2b** — *Requirement:* MG-4. *Behavior:* the real slice pull request
  remains normally merge-eligible after all five ruleset contexts and the
  pre-existing classic CodeRabbit requirement pass. *Oracle:* GitHub reports
  all effective required checks successful and a clean merge state without an
  administrative override. *Evidence type:* GitHub pull request check rollup
  and ruleset evaluation. *Evidence:* pull request
  [#184](https://github.com/flyingrobots/colorful-language/pull/184) at
  `e6665df`, with all effective requirements passing in Actions run
  [30250791566](https://github.com/flyingrobots/colorful-language/actions/runs/30250791566)
  and GitHub reporting `CLEAN` and `MERGEABLE`. *Status:* implemented.
- **MG-3a** — *Requirement:* MG-5. *Behavior:* the current workflow reference
  gives exact planned-rename and emergency-recovery procedures that preserve
  every unrelated rule and verify the replacement context's source before
  changing the live requirement. *Oracle:* documentation inspection and the
  executable live-contract check after recovery. *Evidence type:* current
  workflow reference and checker. *Evidence:*
  `docs/workflows/merge-gate/README.md` and
  `scripts/check-main-ruleset.mjs`. *Status:* implemented.
- **MG-4a** — *Requirement:* MG-7. *Behavior:* the mainline ruleset requires
  `Rust dependency policy`, `Dependency review`, `CodeQL (rust)`, and
  `CodeQL (javascript-typescript)` from GitHub Actions application `15368` in
  addition to the five existing contexts. *Oracle:* the update-payload test
  rejects omission of any context, and the privileged live checker preserves
  every non-status rule and the bypass actor while reporting manifest parity.
  *Evidence type:* deterministic ruleset test, source-controlled manifest, and
  privileged live API check. *Evidence:*
  `.github/rulesets/mainline.json`,
  `scripts/check-main-ruleset.test.mjs`, and
  `scripts/check-main-ruleset.mjs`. *Status:* implemented.

## Ruleset change audit

The live mutation on 2026-07-27 changed one governed rule and preserved every
other field.

| Field | Before | After |
| --- | --- | --- |
| Ruleset identity and scope | `17949589`, `mainline`, active, default branch | unchanged |
| Bypass actor | repository-role actor `5`, `always` | unchanged |
| Ref protection | deletion and non-fast-forward protection | unchanged |
| Commit protection | verified signatures | unchanged |
| Pull-request policy | merge commits only, stale approvals dismissed, all threads resolved, no required approval count | unchanged |
| Required checks | none | five named contexts, GitHub Actions application `15368`, strict freshness, enforced on creation |

The update endpoint for this slice was the repository-ruleset endpoint only. A
separate classic branch-protection layer requiring CodeRabbit application
`347564` was not mutated and remains part of GitHub's effective merge gate.

The security expansion on 2026-07-27 added four GitHub Actions contexts to the
existing five: `Rust dependency policy`, `Dependency review`, `CodeQL (rust)`,
and `CodeQL (javascript-typescript)`. GitHub reported each context from
application `15368` on pull request #199 before the update. The ruleset identity,
scope, bypass actor, ref and signature protections, pull-request policy, strict
freshness, and classic CodeRabbit layer were unchanged.
