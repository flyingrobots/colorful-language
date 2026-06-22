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
  (FUNCTION/CONTENT/PROPER_NOUN_CANDIDATE), and `functionKind`.
- `structure` — a flattened outline tree: paragraphs (depth 0) containing
  sentences (depth 1), children referenced by `childNodeIds`.
- `diagnostics` — empty in `v0` (the linter is a later phase).
- `derivation` — a provenance step per pass.
- `contractVersion`, `schemaHash`, `vocabularyHash` — the exact contract identity.

All offsets are **UTF-8 byte offsets** (`ByteRange { startUtf8, endUtf8 }`);
UTF-16 line/column positions are a derived LSP-only projection and are not in the
IR.

## How it is built

The contracts (`contracts/colorful/*.graphql`) are the source of truth. Wesley
(pinned `0.0.5`) generates the boundary DTOs — Rust (serde) and TypeScript — into
the `colorful-ir` crate (`crates/colorful-ir/{src/generated,ts}/`). Regenerate
with `scripts/gen-ir.sh` (needs `COLORFUL_WESLEY_ROOT`). The generated types are a
**wire boundary**: `colorful-core` stays free of them, and
`colorful_ir::from_classification` is the one-way projection from the domain model
into the DTO.

`colorful_ir::canonical_json` is the shared canonical serializer (compact, sorted
keys); the TypeScript side uses the identical algorithm.

## Guarantees

- **Cross-language round-trip.** The IR survives `Rust → JSON → TypeScript → JSON
  → Rust` byte-for-byte (`scripts/ir-witness.sh`, enforced in CI). Producer and
  consumer can never disagree about the shape.
- **Structural invariants** (asserted on a corpus): token ranges are ordered,
  in-bounds, non-overlapping, and on char boundaries; every `structure` node's
  range contains its children; the source digest matches.

## Known limitations (Stage 1)

- The outline is paragraphs + sentences only; Markdown headings and deeper
  structure come later.
- `VisualRole` (the abstract presentation vocabulary) is generated, but the
  `LexicalClass → VisualRole → {LSP, jedit, graft}` projection maps are not yet
  generated everywhere (a follow-up; Wesley drops the enum-value directives that
  would carry them).
- GraphQL `Int` lowers to `i32`, bounding documents to ~2 GB.

See the [test plan](test-plan.md) for the cases that pin this behavior.
