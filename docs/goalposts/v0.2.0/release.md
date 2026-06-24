# colorful-language v0.2.0 — Release Packet

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
