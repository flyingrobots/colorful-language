# colorful-language v0.2.0 — Release Packet

> [!WARNING]
> The `v0.2.0` tag workflow failed during crates.io publishing before a GitHub
> Release was created. Use `v0.2.1` as the public Goalpost 1 release.

## Summary

`v0.2.0` completes **Goalpost 1, "prose linter."** Colorful now turns the same
deterministic parse that powers highlighting into shallow prose diagnostics:
weak words, run-on sentences, sentence-length outliers, and passive-voice
candidates. The findings are available in the terminal through `colorful lint`
and live in editors through `colorful-lsp`.

This release also ships the first public surface IR: `colorful.syntax/v1`,
generated from a Wesley-authored GraphQL contract, plus the
`colorful.vocabulary/v1` presentation manifest. The CLI can emit canonical JSON
with `colorful ir`, and CI proves the artifact round-trips through Rust and
TypeScript without drift.

## Included scope

- `colorful-core` adds the `Analyzer` port and diagnostic domain types:
  `Finding`, `Rule`, and `Severity`.
- `colorful-lint` implements a deterministic `ProseLinter` rule pack:
  `weak-word`, `run-on`, `length-outlier`, and `passive-voice`.
- `colorful-cli` adds `colorful lint [FILE]`, compiler-style diagnostic output,
  non-zero exit on findings, and `colorful ir [FILE]` for canonical IR JSON.
- `colorful-lsp` publishes live lint diagnostics and continues to emit semantic
  tokens from the same parse/classification pipeline.
- `colorful-ir` publishes the generated Rust and TypeScript DTO boundary for
  `colorful.syntax/v1`, the Rust projection from classification to IR, and
  `validate_document` for fail-closed artifact validation.
- `contracts/colorful/vocabulary.v1.json` defines the presentation manifest used
  by CLI ANSI output, LSP semantic-token roles, and the graft reference consumer.
- `consumers/graft-projection.mjs` validates `vocabularyHash`, `contentHash`, and
  UTF-8 byte offsets before projecting the IR to graft classes.
- `editors/vscode/` and `editors/zed/` provide source editor integrations, and
  `editors/README.md` provides configuration recipes for additional editors.

## Who it's for

- Writers who want deterministic warnings for obvious prose issues without
  sending text to a model or service.
- Editor users who want the same lint signal in live diagnostics.
- Tooling authors who need a stable JSON boundary for Colorful's current surface
  parse, classification, outline, and presentation roles.

## Version justification

`0.2.0` is a pre-1.0 minor release because it adds externally meaningful public
surfaces: a new linter crate, a CLI subcommand, LSP diagnostics, a canonical IR
command, two new crates published to crates.io (`colorful-ir` and
`colorful-lint`), generated TypeScript DTOs, and editor-integration source
packages. Pre-1.0 API compatibility is still not guaranteed across minor
versions.

## Explicit non-claims

- **Not a grammar checker.** The linter reports deterministic candidates for
  shallow issues. It does not understand author intent or rewrite prose.
- **Not contextual POS disambiguation.** Open-class noun/verb/adjective/adverb
  disambiguation remains Goalpost 2.
- **Not replayable provenance.** `colorful.syntax/v1` carries source digests and
  derivation trace seed data, but it does not yet claim echo replay or witnessed
  provenance.
- **IR consumers remain open.** The core IR and graft reference consumer ship in
  this release, but the tracked graft and jedit consumer slices remain open.
- **Editor marketplace packages are not published.** VS Code and Zed source
  integrations build in CI and can be installed from source; registry/marketplace
  publishing is a later task.
- **Controlled English is not shipped.** Contract English, Intent English, and
  proof-carrying execution remain roadmap phases.

## Acceptance

- The linter rule pack is covered by deterministic Rust tests for clean prose,
  weak words, run-ons, length outliers, passive-voice candidates, severity, rule
  codes, and source ordering.
- `colorful lint` is covered by CLI tests for output shape, exit status, unknown
  options, path handling, and line/column reporting.
- LSP diagnostics are covered by tests for severity, rule code, source label,
  clean prose, run-on warnings, and UTF-16 ranges.
- `colorful.syntax/v1` round-trips through `scripts/ir-witness.sh`; the witness
  validates the real source before re-emitting canonical JSON.
- IR validation tests cover contract identity, schema and vocabulary hashes,
  content hash and byte length, illegal axes, invalid byte ranges, duplicate IDs,
  dangling outline children, and oversized projection refusal.
- The graft reference consumer coordinate fix is pinned by
  `consumers/graft-projection.test.mjs`.
- The release gate in [`docs/RELEASING.md`](../../RELEASING.md) passes before
  the release-prep PR is merged.

See [`verification.md`](verification.md) for the release witness.

## Historical correction — 2026-07-26

The packet above is preserved as the release record. Its included-scope claim
that the Graft reference consumer validated UTF-8 byte offsets overstated the
fail-closed guarantees present in the tagged `v0.2.0` artifact. That consumer
used byte-based coordinates and verified the vocabulary and source hashes, but
its coordinate mapper clamped out-of-range offsets into the source and decoded
UTF-8 without fatal error handling. A malformed source or range could therefore
be repaired or replacement-decoded instead of being rejected.

The later remediation tracked by
[#64](https://github.com/flyingrobots/colorful-language/issues/64) added one
ordered artifact-admission gate with stable error categories. Current executable
evidence in
[`consumers/graft-projection.test.mjs`](../../../consumers/graft-projection.test.mjs)
rejects malformed source bytes as `E_SOURCE_UTF8` and rejects reversed,
out-of-bounds, or mid-code-point ranges as `E_BYTE_RANGE_ORDER`,
`E_BYTE_RANGE_BOUNDS`, or `E_BYTE_RANGE_BOUNDARY`. The process-level matrix in
[`scripts/ir-witness.sh`](../../../scripts/ir-witness.sh) additionally proves
that an out-of-range offset exits nonzero as `E_BYTE_RANGE_BOUNDS` and emits no
canonical output.

Those checks describe the remediated current consumer, not a protection
retroactively present in `v0.2.0`.
