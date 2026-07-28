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

### Wire generations are selected by identity

`colorful.syntax/v1` is a contract family, not sufficient evidence of one wire
shape. The canonical
`contracts/colorful/syntax-compatibility.v1.json` manifest selects a supported
generation by the complete contract-version, schema-hash, and vocabulary-hash
tuple. It records the raw-SDL `v0.2.1` and `v0.3.0` identities plus the current
description-normalized schema identity, their predecessor edges, the exact hash
mode, their wire-shape adapter, and executable migration evidence.

Description-only SDL changes preserve a generation. A nullable field,
vocabulary identity, or schema-hash algorithm change requires a new explicit
generation inside v1. A required field, field removal or reinterpretation, or
enum change requires a new contract version. This makes compatibility a
reviewed decision instead of an inference from a release tag. The standalone
consumer treats release names as provenance and derives `openClassKind`
presence only from the matched manifest generation.

## Product-evidence gate

The independent-consumer proof
[#156](https://github.com/flyingrobots/colorful-language/issues/156) compares
one deterministic Markdown role-span report across `colorful.syntax/v1`, ANSI
CLI output, and LSP semantic tokens. The standalone Node package has no Cargo
workspace or third-party runtime dependency. It admits real artifacts from the
immutable `v0.2.1` and `v0.3.0` release tags, normalizes their additive
`openClassKind` generation boundary, and fails closed on incompatible
identities. Both releases use `colorful.syntax/v1`; this is migration across
two released contract generations, not an invented v2.

The generated integration-effort ledger records:

| Adapter | Nonblank adapter lines | Migration lines | Stable failures | Verified identities |
| --- | ---: | ---: | ---: | ---: |
| IR | 424 | 48 | 11 | 5 |
| ANSI | 49 | 0 | 4 | 1 |
| LSP | 305 | 0 | 5 | 2 |

Shared profile loading, compatibility selection, and report rendering account
for another 384 nonblank lines and are excluded from every adapter equally. The
exact source, fixtures, assertions, dependencies, and process steps behind
these counts live in
`consumers/independent-ir-report/evidence/integration-effort.json`.
The LSP count includes its JSON-RPC acquisition client; IR and ANSI use the
same CLI process boundary, so neither count includes that shared invocation.

The reviewed rule retains stable v1 when the IR uniquely verifies the contract,
schema, vocabulary, source length, and source digest and its adapter is no
larger than twice the ANSI and LSP adapters combined, or when the IR is the
smallest adapter. Otherwise the project preserves compatibility but simplifies
implementation or optional surface area before adding contract fields.
`src/decision.mjs` is the executable authority for both branches; its unit test
prevents this prose and the measured result from diverging.

The result is **retain stable v1**: 424 IR lines are 1.20 times the alternatives'
combined 354 lines, within the two-times bound, while only the IR authenticates
all five wire identities. The result is not permission to expand the contract.
Consumer admission remains the cost to reduce; replayable provenance, CNL, and
Edict fields remain frozen until new evidence justifies them. The three
supported `colorful.syntax/v1` identities now have the authored compatibility
policy delivered by
[#221](https://github.com/flyingrobots/colorful-language/issues/221).
[#222](https://github.com/flyingrobots/colorful-language/issues/222) owns
replacing duplicated hand-written structural admission with generated portable
validation while preserving explicitly semantic checks. A worthwhile
simplification that cannot preserve v1 bytes still requires a deliberately
versioned contract and fresh migration evidence.

The broader [deep-end evidence gate](../../../ROADMAP.md#deep-end-evidence-gate)
controls when new provenance, CNL, and Edict surface area resumes. It preserves
the compiler ladder above as the long-term design while requiring the current
product, distribution, and consumer boundary to earn the next expansion.
