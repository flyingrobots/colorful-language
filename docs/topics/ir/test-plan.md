# IR — Test Plan

Verification for the Stage 1 surface IR (`colorful.syntax/v1`). All cases are
**implemented**; see [architecture](architecture.md) for the design of record.

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
  `emit typescript` from `colorful.syntax/v1` produce types covering every
  contract field. *Oracle:* the `colorful-ir` crate compiles the generated Rust;
  `tsc` type-checks the generated TS (`witness/ir-consume.ts`). *Evidence:*
  `crates/colorful-ir/src/generated/`, `scripts/ir-witness.sh` (tsc step).
  *Status:* implemented.
- **IR-2a (the gate)** — *Requirement:* IR-2. *Behavior:* a `DocumentAnalysis`
  round-trips `Rust → JSON A → TS decode → JSON B → Rust decode → JSON C`.
  *Oracle:* `A == B == C` byte-for-byte. *Evidence:* `scripts/ir-witness.sh`
  (CI job `ir-witness`); passes at 4796 bytes. *Status:* implemented.
- **IR-3a** — *Requirement:* IR-3. *Behavior/oracle:* byte ranges ordered, within
  `utf8ByteLength`, non-overlapping, on char boundaries; every `structure` node's
  range contains its children; `source.contentHash` matches the bytes. *Evidence:*
  `colorful-ir` `integration::document_analysis_holds_the_invariants`. *Status:*
  implemented.
- **IR-4a** — *Requirement:* IR-4. *Behavior:* `colorful ir` output decodes
  through the generated DTO and re-encodes identically. *Oracle:* decode +
  re-encode equals the input. *Evidence:* the witness `recanon` leg; `colorful-ir`
  `tests::round_trips_in_rust`. *Status:* implemented.
- **IR-5a** — *Requirement:* IR-5. *Behavior:* `from_classification` projects
  `colorful-core` types into the DTO; `colorful-core` does not depend on generated
  types. *Oracle:* `colorful-core` compiles standalone. *Evidence:*
  `colorful-core/Cargo.toml` (no `colorful-ir` dep); `colorful_ir::from_classification`.
  *Status:* implemented.

## Known gaps / risks

- Enum-value directives are lossy in Wesley L1, so `VisualRole` projections are
  verified against the separate `colorful.vocabulary` manifest, not the syntax
  enum.
- Canonical JSON rules (key order, number formatting) must be specified and
  enforced on both sides for IR-2a to be meaningful.
