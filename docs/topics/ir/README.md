# IR

The **intermediate representation** of a prose document: `colorful.syntax/v1`.
`colorful` parses and classifies English; the IR is the structured, serializable
export of that analysis for out-of-process consumers such as Graft and jedit.
The CLI and LSP use the shared core tree and classified tokens directly; they do
not decode the serialized IR. See [architecture](architecture.md) for the ladder
this sits in and the ownership boundaries.

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
  `schemaHash` is normalized against GraphQL description-line edits: it
  hashes `contracts/colorful/syntax.v1.graphql` with description lines
  stripped, so a documentation-only description fix does not change the
  hash, while any other edit (including formatting, type, field, or enum
  changes) still does. Both `colorful-ir`'s `syntax_schema_hash()` and the
  Graft reference consumer's `schemaHash()` normalize identically, so the
  two sides of the language boundary never disagree over a cosmetic
  description edit.

All offsets are **UTF-8 byte offsets** (`ByteRange { startUtf8, endUtf8 }`);
UTF-16 line/column positions are a derived LSP-only projection and are not in the
IR.

## How it is built

The GraphQL contracts (`contracts/colorful/*.graphql`), vocabulary manifest
(`contracts/colorful/vocabulary.v1.json`), and vocabulary validator schema
(`contracts/colorful/vocabulary.v1.schema.json`) are the source of truth.
Wesley (pinned `0.1.1`) generates the boundary DTOs — Rust (serde) and
TypeScript — into the `colorful-ir` crate
(`crates/colorful-ir/{src/generated,ts}/`). The checked-in Node generator emits
the Rust and JavaScript vocabulary role/key validators from the validator
schema. Regenerate all boundaries with `scripts/gen-ir.sh` (needs
`COLORFUL_WESLEY_ROOT`; the script rejects any Wesley CLI version other than
`0.1.1`), or regenerate only the vocabulary validators with
`node scripts/generate-vocabulary-validators.mjs`. Generated files are
**boundary code**: never edit them by hand. `colorful-core` stays free of
generated types, and `colorful_ir` owns the one-way projection from the domain
model into the DTO.

`colorful-core` exposes a source-bound `ValidatedClassification` aggregate for
producer adapters. It rejects malformed public tree/token output with typed,
path-addressed `ClassificationError`s and keeps valid values behind read-only
accessors. `colorful_ir::from_validated_classification` consumes that proof
without revalidating it. The `from_classification` entry point remains
signature-compatible for callers with borrowed raw values, but validates them
before entering the same private projection path. Its
`ProjectionError::InvalidClassification` wraps the core error rather than
duplicating a second range-error model.

CI does not trust that regeneration happened correctly against whichever
developer checkout last ran it: `scripts/check-generated-ir-drift.sh` clones
Wesley from an immutable pinned commit SHA (not a floating tag), generates
into a temporary directory, and fails on any byte-for-byte drift against the
committed output. `scripts/check-generated-vocabulary-drift.sh` independently
generates both role/key validators into a temporary directory and compares
them byte-for-byte with the committed Rust and JavaScript boundaries. Its
schema-extension regression proves that adding a role or key changes both
outputs together. Both checks run in CI (`generated-ir-drift`) and as part of
`scripts/release-prep.sh`.

`colorful-projection::build_document` is the single Rust producer front door:
it constructs `ValidatedClassification`, then calls
`from_validated_classification` with each producer's `PassIdentity`
(`colorful_core::Parser::pass_identity` /
`Annotator::pass_identity`), returning an `AnalyzedDocument` — the parsed `Tree`
and classified tokens alongside the projected `DocumentAnalysis`.
`colorful-cli`'s `analyze_ir`/`diagnose_json` call it directly; `colorful-lsp`
does not, since its semantic-token and diagnostic paths never needed the
projected IR. Both projection entry points reject a parser or annotator that
never overrode `pass_identity()` (an invalid-by-construction empty identity) or
two producers claiming the same derivation stage.

Projection has a mandatory producer-side postcondition:
`validate_document(document, Some(source.as_bytes()))` must pass before either
entry point returns success. A core-valid classification that would still
violate a wire invariant returns
`ProjectionError::InvalidProjectedDocument`; no invalid canonical artifact is
returned. `validate_document` independently enforces the same contract on
received artifacts, including an empty `derivation` list.

`colorful_ir::canonical_json` is the shared canonical serializer (compact, sorted
keys); the TypeScript side uses the identical algorithm.

Presentation is authored once in `contracts/colorful/vocabulary.v1.json`: token
axes (`tokenKind`, `lexicalClass`, optional `openClassKind`) map to
`VisualRole`, then each role projects to ANSI, LSP token type, and graft class.
`vocabularyHash` is the hash of that manifest, so changing a color or role
mapping changes the contract identity. Legal role names and token-axis keys are
authored separately in `contracts/colorful/vocabulary.v1.schema.json`; generated
Rust and JavaScript validators make both language boundaries enforce that one
matrix. The CLI, LSP, and graft reference consumer all derive from the manifest
and generated validators. The public Rust lookups
`visual_role`, `visual_role_for`, and `projection` return `Option`: every
current `PosClass` and generated `VisualRole` maps to `Some` because manifest
validation requires complete coverage, while caller-supplied token axes without
an authored mapping return `None`. These fallible signatures are an intentional
breaking API change in the queued v0.4.0 line; downstream callers moving from
v0.3 must handle the `Option` result.

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
  fields, wrongly typed fields, token layout, outline graph integrity, and the
  usual range/hash checks) before canonicalizing. This is the same shared wire
  admission gate used by the Graft reference consumer, so the TypeScript
  witness and Rust validator reject the same token-order and structure-graph
  corruptions.
  Proven against three checked-in negative fixtures under `witness/negative/`
  (an unknown field, a missing field, a wrong-typed field) that the witness
  asserts are rejected **for their specific reason**, not merely a nonzero
  exit, on every run. This is proven for the TS leg specifically; the Rust
  leg's generated `DocumentAnalysis` deserializes via `serde`'s default
  (unknown-field-tolerant) behavior, so an unknown field is not yet
  independently proven rejected on the Rust side — a known gap, not a
  claimed guarantee.
- **Process refusals have stable categories and no output.** The witness runs
  both real boundary executables against ten deterministic cases: mismatched
  source bytes, invalid JSON, wrong contract/schema/vocabulary identities,
  illegal token axes, fractional and out-of-range offsets, a missing required
  field, and one multi-identity corruption that pins contract-version failure
  first. Every Node and Rust leg must exit exactly `1`, include its stable code
  on stderr, and leave stdout empty. Rust semantic validation categories come
  from `ValidationError::code`; JSON/DTO failures use `E_JSON_DECODE`. The Node
  leg reports `GraftProjectionError.code` or `E_JSON_DECODE`.
- **Structural invariants** (asserted on a committed corpus spanning empty
  input, Unicode, CR/LF variants, punctuation-only input, long tokens,
  multiple paragraphs, and contextual ambiguity — every fixture checked by
  the same oracle function): token ranges are ordered, in-bounds,
  non-overlapping, and on char boundaries; every `structure` node's range
  contains its children; the source digest matches.
- **Structured, path-aware validation errors.** `validate_document` reports
  every failure as a `ValidationError` carrying a `Path` (e.g.
  `tokens[3].byteRange.startUtf8`) naming exactly where the invariant broke,
  plus a stable `code()` equal to its variant name, rather than making a
  process consumer parse display prose. Validation runs as
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
- **Strict token and outline invariants.** Received token ranges must be
  non-empty, ordered by start offset, and non-overlapping in addition to each
  range being ordered, in bounds, and on UTF-8 character boundaries.
  Paragraph nodes have depth 0, sentence nodes have depth 1, child references
  form an acyclic graph with at most one parent per child, and every parent
  range contains each child's range. Graph traversal is iterative so hostile
  depth cannot overflow the process stack.
- **Cross-language validator parity.** One shared 25-case declarative mutation
  matrix starts both validators from the same canonical Rust-produced Unicode
  document, then requires each mutation to produce its named Rust
  `ValidationError` variant and stable JavaScript `GraftProjectionError.code`.
  Rust's exhaustive variant matcher makes a newly added public validation
  error a compile-time inventory change; case-count equality then requires a
  corresponding shared mutation. `scripts/ir-witness.sh` runs both legs.

## Known limitations (Stage 1)

- The outline is paragraphs + sentences only; Markdown headings and deeper
  structure come later.
- `VisualRole` is generated from GraphQL, but concrete projection maps live in
  the JSON vocabulary manifest because Wesley drops enum-value directives that
  would otherwise carry them.
- The derivation record is a trace seed, not replayable provenance: `passId`
  and `ruleId` now name a real, validated producer identity, but node-level
  input/output ids, a real `compilerBuildHash`, and artifact hashes are not
  implemented. Expanding that surface is evidence-gated rather than assumed.
- GraphQL `Int` lowers to `i32`, bounding documents to ~2 GB.

See the [test plan](test-plan.md) for the cases that pin this behavior and the
[architecture decision rule](architecture.md#product-evidence-gate) for
retaining, simplifying, or deliberately versioning the contract.
