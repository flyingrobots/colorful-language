# IR

The **intermediate representation** of a prose document: `colorful.syntax/v1`.
`colorful` parses and classifies English; the IR is the structured, serializable
form of that analysis, which back-ends (graft, jedit, any editor) consume instead
of re-deriving structure. See [architecture](architecture.md) for the ladder this
sits in and the ownership boundaries.

## Current behavior

`colorful ir [FILE]` (or stdin) emits a `DocumentAnalysis` as **canonical JSON** —
compact, with object keys sorted lexicographically:

```bash
colorful ir essay.txt
```

A `DocumentAnalysis` carries:

- `source` — the analyzed artifact: `unitId`, a `sha256:` `contentHash`, and
  `utf8ByteLength`.
- `tokens` — each classified occurrence: a `byteRange` plus the orthogonal axes
  `tokenKind` (WORD/NUMBER/PUNCTUATION/QUOTE), `lexicalClass`
  (FUNCTION/CONTENT/PROPER_NOUN_CANDIDATE), `functionKind`, and
  `openClassKind` (NOUN/VERB/ADJECTIVE/ADVERB for explicitly tagged content
  words).
- `structure` — a flattened outline tree: paragraphs (depth 0) containing
  sentences (depth 1), children referenced by `childNodeIds`. A paragraph
  boundary is a blank line: a gap between two sentences containing at least
  two *logical* line breaks — `\n`, `\r`, or `\r\n` (a `\r\n` pair counts as
  one break, never two) — with only whitespace between them. This is a byte-
  count-independent rule: a source using `\r` only (classic Mac line
  endings) splits paragraphs exactly like one using `\n\n`.
- `diagnostics` — currently empty in `colorful ir` output. The prose linter
  exists today, but its findings surface through `colorful lint` and
  `colorful-lsp` diagnostics, not through `colorful.syntax/v1`.
- `derivation` — a trace seed per pass (`passId`, `ruleId`, `sourceRanges`,
  `compilerBuildHash`), not yet replayable provenance.
- `contractVersion`, `schemaHash`, `vocabularyHash` — the exact contract identity.

All offsets are **UTF-8 byte offsets** (`ByteRange { startUtf8, endUtf8 }`);
UTF-16 line/column positions are a derived LSP-only projection and are not in the
IR.

## How it is built

The contracts (`contracts/colorful/*.graphql`) and vocabulary manifest
(`contracts/colorful/vocabulary.v1.json`) are the source of truth. Wesley (pinned
`0.1.1`) generates the boundary DTOs — Rust (serde) and TypeScript — into the
`colorful-ir` crate (`crates/colorful-ir/{src/generated,ts}/`). Regenerate with
`scripts/gen-ir.sh` (needs `COLORFUL_WESLEY_ROOT`; the script rejects any Wesley
CLI version other than `0.1.1`). The generated types are a **wire boundary**:
`colorful-core` stays free of them, and
`colorful_ir::from_classification` is the one-way projection from the domain model
into the DTO.

`colorful-projection::build_document` is the single Rust producer front door:
it parses, annotates, and calls `from_classification` with each producer's
`PassIdentity` (`colorful_core::Parser::pass_identity` /
`Annotator::pass_identity`), returning an `AnalyzedDocument` — the parsed
`Tree` and classified tokens alongside the projected `DocumentAnalysis`.
`colorful-cli`'s `analyze_ir`/`diagnose_json` call it directly; `colorful-lsp`
does not, since its semantic-token and diagnostic paths never needed the
projected IR. `from_classification` — and `build_document` in turn — rejects a
parser or annotator that never overrode `pass_identity()` (an
invalid-by-construction empty identity) or two producers claiming the same
derivation stage; `validate_document` rejects the same on a received
artifact, including an empty `derivation` list.

`colorful_ir::canonical_json` is the shared canonical serializer (compact, sorted
keys); the TypeScript side uses the identical algorithm.

Presentation is authored once in `contracts/colorful/vocabulary.v1.json`: token
axes (`tokenKind`, `lexicalClass`, optional `openClassKind`) map to
`VisualRole`, then each role projects to ANSI, LSP token type, and graft class.
`vocabularyHash` is the hash of that manifest, so changing a color or role
mapping changes the contract identity. The CLI, LSP, and graft reference
consumer all derive from this manifest.

## Guarantees

- **Cross-language round-trip.** A *valid* document survives
  `Rust → JSON → TypeScript → JSON → Rust` byte-for-byte (`scripts/ir-witness.sh`,
  enforced in CI): the TS leg (`witness/ir-canonicalize.mjs`) and the Rust leg
  (`examples/recanon.rs`) each independently validate the decoded document
  against the contract and the real source bytes before re-emitting it, so
  neither leg can launder a document into clean-looking canonical JSON without
  first agreeing it's valid.
- **Malformed artifacts are rejected, not laundered.** The TS leg runs
  `validateWireContract` (unknown fields at every nesting level, missing
  fields, wrongly typed fields, and the usual range/hash checks) before
  canonicalizing. This is the graft reference consumer's admission gate
  minus its token-wire-ordering check specifically — non-overlapping token
  order is a graft-projection requirement (for its `makeByteToPoint`
  monotonic cursor), not part of the wire contract, which
  `colorful_ir::validate_document` deliberately leaves unchecked, so the
  witness must not be stricter than the Rust leg it round-trips against.
  Proven against three checked-in negative fixtures under `witness/negative/`
  (an unknown field, a missing field, a wrong-typed field) that the witness
  asserts are rejected **for their specific reason**, not merely a nonzero
  exit, on every run. This is proven for the TS leg specifically; the Rust
  leg's generated `DocumentAnalysis` deserializes via `serde`'s default
  (unknown-field-tolerant) behavior, so an unknown field is not yet
  independently proven rejected on the Rust side — a known gap, not a
  claimed guarantee.
- **Structural invariants** (asserted on a committed corpus spanning empty
  input, Unicode, CR/LF variants, punctuation-only input, long tokens,
  multiple paragraphs, and contextual ambiguity — every fixture checked by
  the same oracle function): token ranges are ordered, in-bounds,
  non-overlapping, and on char boundaries; every `structure` node's range
  contains its children; the source digest matches.
- **Structured, path-aware validation errors.** `validate_document` reports
  every failure as a `ValidationError` carrying a `Path` (e.g.
  `tokens[3].byteRange.startUtf8`) naming exactly where the invariant broke,
  rather than a prose string a consumer has to parse. Validation runs as
  seven fixed, independently testable stages — contract identity, source
  identity, token ranges, token axes, structure graph, diagnostics,
  derivation — concatenated in that order, so the error order is
  deterministic for a given input (it is not, however, identical to the
  interleaved-per-token order the pre-`Path` implementation produced).
  Untrusted document strings that flow into the rendered message
  (`contractVersion`, the hash `found` values, derivation `passId`) go through
  `escape_debug()` first, so a malformed artifact cannot forge extra log
  lines or terminal escape sequences in a consumer that prints the error
  text — the `recanon` witness leg being the concrete case that does.

## Known limitations (Stage 1)

- The outline is paragraphs + sentences only; Markdown headings and deeper
  structure come later.
- `VisualRole` is generated from GraphQL, but concrete projection maps live in
  the JSON vocabulary manifest because Wesley drops enum-value directives that
  would otherwise carry them.
- The derivation record is a trace seed, not replayable provenance: `passId`
  and `ruleId` now name a real, validated producer identity, but node-level
  input/output ids, a real `compilerBuildHash`, and artifact hashes come later.
- GraphQL `Int` lowers to `i32`, bounding documents to ~2 GB.

See the [test plan](test-plan.md) for the cases that pin this behavior.
