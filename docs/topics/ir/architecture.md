# IR — Architecture

> Status: **in progress** (Stage 1). This describes the intended structure of
> colorful's intermediate representation and the compiler ladder it sits in. The
> surface IR (`colorful.syntax/v1`) exists on `main`; its current-truth is in this
> topic's [`README.md`](README.md). Treat this file as the design of record for
> the deeper ladder (boundary validation, a versioned vocabulary manifest, and
> replayable provenance) that is **not yet** fully implemented.

## Why an IR

`colorful` parses English into structure. That structure is an **intermediate
representation**: ANSI color, LSP semantic tokens, graft projections, and (later)
an executable interpreter are all *back-ends* over the same IR — the classic
compiler shape (front-end → IR → back-ends) pointed at English.

The IR is also a **contract across a language boundary**: a Rust producer
(`colorful`) and TypeScript consumers (graft, jedit). Hand-writing the types on
both sides is exactly the drift [Wesley](https://github.com/flyingrobots) exists
to eliminate, so the IR is authored **once as a GraphQL contract** and Wesley
generates the Rust and TS types from it.

## The compiler ladder + strict ownership

Each system owns exactly one layer; nothing is poured into a single omniscient
`ColorfulIR` object.

```text
freeform English        (later: untrusted LLM elaboration — a separate tier)
   ▼
Controlled Natural English (CNL)         ── colorful owns surface syntax
   ▼
colorful CST + source map
   ▼
colorful surface AST
   ▼
resolved semantic IR                     ── colorful owns what text MEANS
   ├── schema declarations ─→ canonical GraphQL SDL ─→ Wesley L1 ─→ Rust / TS / codecs
   │                                                   (Wesley owns domain-empty facts)
   └── executable intents ─→ Edict surface AST ─→ Edict compiler ─→ Core IR ─→ sealed bundle
                                                   (Edict owns semantics + verification + sealing)
   ▼
derivation trace + hashes  ─→ Echo        (echo owns hosted admission + witnessed evidence)
                                           (continuum owns the PROVEN shared boundary — later)
```

Governing law: **colorful may describe anything, but it may compile only what the
target can prove.** A budget or capability written in English is a *claim*; the
target (Edict) verifies it. colorful never mints a "proven" artifact about its
own behavior.

The **surface IR** (this topic, Stage 1) and the future **semantic IR** are
*separate contracts*, not one extended. The surface IR is a document model
(drives highlighting, LSP, graft); the semantic IR is an intent model (drives
Edict lowering) and evolves with the CNL grammar.

## Stage 1 — the surface contract

Two contracts:

- `colorful.syntax/v1` — `DocumentAnalysis`: `contractVersion`, `schemaHash`,
  `vocabularyHash`, `source { unitId, contentHash, utf8ByteLength }`,
  `tokens [{ occurrenceId, byteRange, tokenKind, lexicalClass?, functionKind? }]`,
  `structure` (outline nodes with `byteRange` + children), `diagnostics`.
- `colorful.vocabulary/v1` — the enums and their *render intent*.

Design commitments (frozen before the ecosystem depends on them):

- **`ByteRange { startUtf8, endUtf8 }`**, never naked `start/end`. UTF-8 byte
  offsets are **authoritative**; UTF-16 line/column are *derived adapter
  projections* for LSP only. (`colorful-core` already treats spans as byte
  offsets; the LSP path already does the UTF-16 conversion — keep that split.)
- Every artifact carries `schemaHash`, `vocabularyHash`, and a source
  `contentHash`. A span without a named source is a coordinate without a planet.
- **`PosClass` is split** into orthogonal axes, because it currently conflates
  token kind, lexical family, heuristic interpretation, and presentation:
  - `TokenKind` — `WORD`, `NUMBER`, `PUNCTUATION`, `QUOTE`
  - `LexicalClass` — `FUNCTION`, `CONTENT`, `PROPER_NOUN_CANDIDATE`
  - `FunctionKind` — `ARTICLE`, `PREPOSITION`, `CONJUNCTION`, `PRONOUN`,
    `AUXILIARY`, `DETERMINER`, `NEGATOR`
  - (reserved) `PartOfSpeech` — a later contextual annotation, not baked in now.
- **Presentation is an abstract `VisualRole`** (`STRUCTURAL_KEYWORD`, `TYPE_LIKE`,
  `LITERAL`, `QUOTED`, `MUTED`, `UNSTYLED`). Generate `LexicalClass → VisualRole`,
  then `VisualRole → {LSP token, jedit role, graft class}`. No editor brand names
  in the linguistic domain.

## Wesley findings (de-risk, wesley 0.0.5)

- `wesley-cli emit rust` emits structs/enums deriving `serde::{Serialize,
  Deserialize}` with `#[serde(rename = ...)]` — **codecs work out of the box**, so
  no bespoke generator crate is needed for Stage 1.
- `emit typescript` emits declarations only; runtime decoding uses the `zod`
  target (the path jedit already uses).
- **Enum-value directives are dropped in L1 lowering** — a `@renderHint` on each
  `LexicalClass` value does not survive. Therefore `VisualRole` and its
  projections live in the **separate `colorful.vocabulary` manifest**, not as
  enum-value directives. (Landing a Wesley `EnumValueDefinition` fidelity fix is a
  possible later upstream contribution.)
- GraphQL `Int` lowers to Rust `i32` (a bounded wire scalar, ~2 GB; acceptable for
  v1, a custom unsigned scalar is a later refinement).
- Pin an **exact** Wesley version (`0.0.5`) and record it in committed generator
  metadata. An ambient `~/git/wesley` checkout is a developer override, never the
  replay mechanism.

## Boundary discipline

Generated Rust/TS types are **boundary DTOs**, not the internal model. Keep
`colorful-core`'s ergonomic domain types; bridge with a projection
`DocumentAnalysis::from_classification(source, tree, tokens)`. Emit a
`DerivationStep` provenance record per pass from day one
(`passId, ruleId, inputNodeIds, outputNodeIds, sourceRanges, inputArtifactHashes,
outputArtifactHashes, compilerBuildHash`) so explanation and replay are built in,
not retrofitted.
