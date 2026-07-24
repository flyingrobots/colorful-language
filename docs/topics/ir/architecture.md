# IR — Architecture

> Status: **in progress** (Stage 1). This describes the intended structure of
> colorful's intermediate representation and the compiler ladder it sits in. The
> surface IR (`colorful.syntax/v1`) exists on `main`; its current-truth is in this
> topic's [`README.md`](README.md). Boundary validation and the versioned
> vocabulary manifest are implemented for Stage 1. Treat this file as the design
> of record for the deeper ladder that is still in progress, especially
> replayable provenance and the future semantic IR.

## Why an IR

`colorful` parses English into a core tree and classified token stream. The
current ANSI and LSP adapters consume those domain values directly.
`colorful-projection` separately turns the same analysis into the serialized
`colorful.syntax/v1` **intermediate representation** for Graft, jedit, and other
out-of-process consumers. The wire IR is therefore an export boundary, not an
internal object every current surface must decode.

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
  `tokens [{ occurrenceId, byteRange, tokenKind, lexicalClass?, functionKind?,
  openClassKind? }]`, `structure` (outline nodes with `byteRange` + children),
  `diagnostics`, `derivation` (per-pass provenance; see below).
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
  - `OpenClassKind` — `NOUN`, `VERB`, `ADJECTIVE`, `ADVERB` when a content word
    has an explicit open-class decision
- **Presentation is an abstract `VisualRole`** (`STRUCTURAL_KEYWORD`, `TYPE_LIKE`,
  `LITERAL`, `QUOTED`, `MUTED`, `UNSTYLED`, `NOUN`, `VERB`, `ADJECTIVE`,
  `ADVERB`). Generate token axes → `VisualRole`, then `VisualRole → {LSP token,
  jedit role, graft class}`. No editor brand names in the linguistic domain.

## Wesley findings (de-risk, wesley 0.1.1)

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
- Pin an **exact** Wesley version (`0.1.1`) and record it in committed generator
  metadata. An ambient `~/git/wesley` checkout is a developer override, never the
  replay mechanism.

## Boundary discipline

Generated Rust/TS types are **boundary DTOs**, not the internal model. Keep
`colorful-core`'s ergonomic domain types; bridge with the free function
`colorful_ir::from_classification(unit_id, source, tree, tokens,
parser_identity, annotator_identity)`. `colorful-projection::build_document`
is the single Rust producer front door that calls it: it sources each
`PassIdentity` from the `Parser`/`Annotator`'s own `pass_identity()` and
rejects a producer that never overrode it (an invalid-by-construction empty
identity) or two producers claiming the same pass id. Each pass emits a
`DerivationStep`, but Stage 1 records a **trace seed**, not replayable
provenance: every step currently carries `passId` and `ruleId` — now a real,
validated producer identity rather than a hardcoded literal — plus
`sourceRanges` and a `compilerBuildHash` that is itself a stand-in (the crate
version). The richer fields that make derivation *replayable* —
`inputNodeIds`, `outputNodeIds`, and input/output artifact hashes — are
deferred; the trace seed reserves the shape so they can land without a
contract break, but the IR does not yet claim replay.

### Presentation lives in a versioned manifest

`VisualRole` is an abstract enum; the concrete mapping — token axes → `VisualRole`
→ `{ANSI, LSP token type, graft class}` — is authored once in
`contracts/colorful/vocabulary.v1.json`. That manifest's hash **is** the IR's
`vocabularyHash`, so the hash certifies presentation behavior, and the CLI, the
language server, and the graft consumer all derive their colors from it rather
than each keeping a private copy. A consumer can compare its manifest hash to an
artifact's `vocabularyHash` to detect vocabulary drift.

## Product-evidence gate

Stage 1 compatibility is preserved while the project tests whether the wire
contract lowers real downstream cost. The independent-consumer proof
[#156](https://github.com/flyingrobots/colorful-language/issues/156) compares
the same consumer job across `colorful.syntax/v1`, CLI text, and LSP semantic
tokens, including validation, migration, adapter code, and failure handling.

The decision rule is:

- retain the contract when the independent consumer shows a material
  correctness, integration, or migration advantage;
- simplify implementation or optional surface area without changing public v1
  bytes when the same job can be served more cheaply;
- introduce a deliberately versioned contract, with migration evidence, when a
  worthwhile simplification cannot preserve v1 bytes;
- do not add replayable provenance, CNL, or Edict fields merely to make the
  contract look more complete.

The broader [deep-end evidence gate](../../../ROADMAP.md#deep-end-evidence-gate)
controls when new provenance, CNL, and Edict surface area resumes. It preserves
the compiler ladder above as the long-term design while requiring the current
product, distribution, and consumer boundary to earn the next expansion.
