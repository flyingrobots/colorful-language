# IR — Test Plan

Verification for the Stage 1 surface IR (`colorful.syntax/v1`). All cases are
**implemented**; see [architecture](architecture.md) for the design of record.

Requirements:

- **IR-1** One GraphQL contract generates Rust and TS boundary types that agree.
- **IR-2** The IR serializes to a canonical JSON that round-trips byte-for-byte
  across the language boundary.
- **IR-3** The IR honors invariants that SDL cannot express.
- **IR-4** A received `DocumentAnalysis` is validated against the contract — and,
  given the source, the real bytes — so a malformed artifact is rejected, not
  re-emitted.
- **IR-5** Generated types are a boundary, not the domain model.
- **IR-6** Presentation lives in one versioned manifest: token axes → `VisualRole`
  → per-surface projection is authored once, hashed into `vocabularyHash`, and the
  CLI, LSP, and graft consumer all derive from it.

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
- **IR-4a** — *Requirement:* IR-4. *Behavior:* `validate_document` accepts a
  produced document (with and without source) and rejects each malformed
  mutation — wrong contract/schema/vocabulary hash, content-hash and byte-length
  mismatch against the real source, out-of-order / out-of-bounds / non-char-
  boundary ranges, negative offsets, illegal token axes, duplicate ids, dangling
  child refs — collecting every failure rather than the first. *Oracle:* expected
  `ValidationError` variants present. *Evidence:* `colorful-ir` `integration`
  tests `a_produced_document_validates_*` and `rejects_*`. *Status:* implemented.
- **IR-4b** — *Requirement:* IR-4. *Behavior:* the witness `recanon` leg validates
  the decoded document against the real source before re-emitting, so a mismatched
  source is rejected. *Oracle:* `recanon` exits non-zero on a mismatched source;
  the round-trip C leg passes the fixture. *Evidence:* `crates/colorful-ir/examples/recanon.rs`;
  `scripts/ir-witness.sh`. *Status:* implemented.
- **IR-4c** — *Requirement:* IR-4. *Behavior:* `colorful ir` output decodes
  through the generated DTO and re-encodes identically. *Oracle:* decode +
  re-encode equals the input. *Evidence:* the witness `recanon` leg; `colorful-ir`
  `tests::round_trips_in_rust`. *Status:* implemented.
- **IR-5a** — *Requirement:* IR-5. *Behavior:* `from_classification` projects
  `colorful-core` types into the DTO; `colorful-core` does not depend on generated
  types. *Oracle:* `colorful-core` compiles standalone. *Evidence:*
  `colorful-core/Cargo.toml` (no `colorful-ir` dep); `colorful_ir::from_classification`.
  *Status:* implemented.
- **IR-6a** — *Requirement:* IR-6. *Behavior:* the manifest maps each `PosClass`
  to the expected `VisualRole` and each role to its ANSI / LSP / graft projection;
  the LSP legend order and `vocabularyHash` derive from it. *Oracle:* table
  equality. *Evidence:* `colorful-ir` `vocabulary::tests::*`. *Status:* implemented.
- **IR-6b** — *Requirement:* IR-6. *Behavior:* CLI ANSI, LSP legend/indices, and
  graft `className` all derive from the manifest (no private copies). *Oracle:*
  the surfaces' golden tests still hold after rewiring to the manifest. *Evidence:*
  `colorful-cli` `tests::golden_*`; `colorful-lsp` semantic-token tests;
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **IR-6c** — *Requirement:* IR-6. *Behavior:* the graft consumer rejects an
  artifact whose `vocabularyHash` does not match its manifest. *Oracle:*
  `verifyVocabularyHash` throws. *Evidence:* `consumers/graft-projection.test.mjs`.
  *Status:* implemented.

## Known gaps / risks

- Enum-value directives are lossy in Wesley L1, so the `VisualRole` *projections*
  live in the separate `colorful.vocabulary/v1` JSON manifest (the hashed source
  of truth), not as syntax-enum directives.
- The derivation trace is a **trace seed**, not replayable provenance: steps carry
  `passId`/`ruleId`/`sourceRanges` and a stand-in `compilerBuildHash`; node-level
  input/output ids and artifact hashes are deferred.
- Canonical JSON rules (key order, number formatting) must be specified and
  enforced on both sides for IR-2a to be meaningful.
