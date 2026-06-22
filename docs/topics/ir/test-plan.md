# IR — Test Plan

Planned verification for the Stage 1 surface IR (`colorful.syntax/v1`). All cases
are **planned** until the IR lands; see [architecture](architecture.md) for the
design of record.

Requirements:

- **IR-1** One GraphQL contract generates Rust and TS boundary types that agree.
- **IR-2** The IR serializes to a canonical JSON that round-trips byte-for-byte
  across the language boundary.
- **IR-3** The IR honors invariants that SDL cannot express.
- **IR-4** `colorful ir <file>` emits a `DocumentAnalysis` that validates against
  its declared `schemaHash`.
- **IR-5** Generated types are a boundary, not the domain model.

## Cases

- **IR-1a** — *Requirement:* IR-1. *Behavior:* `wesley-cli emit rust` and
  `emit typescript`/`zod` from `colorful.syntax/v1` produce types covering every
  contract field. *Oracle:* both compile; field/enum names match the contract.
  *Status:* planned.
- **IR-2a (the gate)** — *Requirement:* IR-2. *Behavior:* a `DocumentAnalysis`
  value round-trips `Rust → canonical JSON A → TS decode → canonical JSON B →
  Rust decode → canonical JSON C`. *Oracle:* `A == B == C` byte-for-byte.
  *Status:* planned.
- **IR-3a** — *Requirement:* IR-3. *Behavior/oracle (assert on a corpus):*
  byte ranges are ordered and within `utf8ByteLength`; tokens do not overlap;
  each token's text equals its source slice; every `structure` node's range
  contains its children's ranges; `source.contentHash` matches the bytes; the
  artifact names the exact `schemaHash`/`vocabularyHash` it implements. *Status:*
  planned.
- **IR-4a** — *Requirement:* IR-4. *Behavior:* `colorful ir <file>` output
  deserializes through the generated decoder without loss. *Oracle:* decode +
  re-encode equals the emitted JSON. *Status:* planned.
- **IR-5a** — *Requirement:* IR-5. *Behavior:* `DocumentAnalysis::from_classification`
  projects `colorful-core` types into the boundary DTO; `colorful-core`'s public
  API is unchanged. *Oracle:* `colorful-core` still compiles without depending on
  generated types. *Status:* planned.

## Known gaps / risks

- Enum-value directives are lossy in Wesley L1, so `VisualRole` projections are
  verified against the separate `colorful.vocabulary` manifest, not the syntax
  enum.
- Canonical JSON rules (key order, number formatting) must be specified and
  enforced on both sides for IR-2a to be meaningful.
