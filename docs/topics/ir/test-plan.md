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
- **IR-7** The surface IR carries open-class noun, verb, adjective, and adverb as
  an optional `openClassKind` axis on `WORD` / `CONTENT` tokens, and the
  vocabulary manifest projects those axes without private surface copies.
- **IR-8** Every `derivation` step names an honest, checkable producer identity
  (`passId`/`ruleId`): a `Parser`/`Annotator` that never overrides
  `pass_identity()` reports an invalid-by-construction empty identity, and both
  the emitter (`from_classification`) and the receiver (`validate_document`)
  reject a missing or duplicate identity rather than accept a plausible-looking
  placeholder.
- **IR-9** `colorful-projection::build_document` is the single Rust-only front
  door from a `Parser`/`Annotator` pair to an `AnalyzedDocument`; the IR tokens
  it projects correspond 1:1 by index to the core tokens the annotator produced.

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
  (CI job `ir-witness`). *Status:* implemented.
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
- **IR-7a** — *Requirement:* IR-7. *Behavior:* `PosClass::Open` projects into the
  generated DTO as `tokenKind: WORD`, `lexicalClass: CONTENT`, and a matching
  `openClassKind`. *Oracle:* token-axis equality and `DocumentAnalysis`
  serialization. *Evidence:* `colorful-ir`
  `integration::open_class_pos_projects_with_explicit_open_class_kind`. *Status:*
  implemented.
- **IR-7b** — *Requirement:* IR-7. *Behavior:* validation accepts only legal
  `openClassKind` combinations and rejects malformed token axes. *Oracle:*
  `ValidationError::IllegalTokenAxes`. *Evidence:* `colorful-ir`
  `integration::rejects_illegal_token_axes`. *Status:* implemented.
- **IR-7c** — *Requirement:* IR-7. *Behavior:* the graft consumer validates the
  manifest's open-class axis and projects noun/verb/adjective/adverb classes
  through `graftClass`. *Oracle:* JavaScript assertions. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **IR-8a** — *Requirement:* IR-8. *Behavior:* `Parser`/`Annotator`'s default
  `pass_identity()` is the invalid-by-construction empty `PassIdentity`;
  production implementations (`ProseParser`, `ContextualOpenClassAnnotator`,
  `LexicalAnnotator`) override it with a real `passId`/`ruleId`, and
  `from_classification` rejects a producer that never did. *Oracle:*
  `ProjectionError::MissingPassIdentity`. *Evidence:* `colorful-ir`
  `integration::from_classification_rejects_an_unidentified_parser` /
  `..._rejects_an_unidentified_annotator`. *Status:* implemented.
- **IR-8b** — *Requirement:* IR-8. *Behavior:* `from_classification` threads
  each producer's real `pass_identity()` into `derivation` instead of
  hardcoded literals — a different annotator is named under its own honest
  `ruleId` — and rejects two producers claiming the same pass id. *Oracle:*
  `derivation[i].passId`/`ruleId` equal the producer's identity;
  `ProjectionError::DuplicatePassId` on a clash. *Evidence:* `colorful-ir`
  `integration::derivation_reports_the_real_producers_pass_identity`,
  `derivation_names_a_different_annotator_honestly`,
  `from_classification_rejects_a_duplicate_pass_id`. *Status:* implemented.
- **IR-8c** — *Requirement:* IR-8. *Behavior:* a received document's derivation
  is validated the same way: an empty `passId`/`ruleId`, or a `passId` shared
  across steps, is rejected — checked across the complete `derivation` list,
  not only the two steps today's producer happens to emit. *Oracle:*
  `ValidationError::MissingDerivationIdentity` / `DuplicateDerivationPassId`.
  *Evidence:* `colorful-ir`
  `integration::rejects_a_derivation_step_with_missing_identity`,
  `rejects_derivation_steps_sharing_a_pass_id`. *Status:* implemented.
- **IR-9a** — *Requirement:* IR-9. *Behavior:* `build_document` parses,
  annotates, and projects a `Parser`/`Annotator` pair (borrowed, not consumed)
  into an `AnalyzedDocument`, sourcing each `PassIdentity` from
  `pass_identity()`. *Oracle:* output is byte-identical to a hand-rolled
  parse/annotate/`from_classification` call. *Evidence:* `colorful-projection`
  `tests::builds_the_same_document_a_hand_rolled_pipeline_would`,
  `tests::propagates_a_missing_pass_identity`. *Status:* implemented.
- **IR-9b** — *Requirement:* IR-9. *Behavior:* IR tokens correspond 1:1 by
  index to core tokens — matching byte ranges, and agreeing with the same
  `visual_role`/`visual_role_for` mapping every ANSI/LSP role lookup uses.
  *Oracle:* pairwise equality across `AnalyzedDocument.tokens` and
  `.document.tokens`. *Evidence:* `colorful-projection`
  `tests::ir_tokens_correspond_1to1_to_core_tokens`. *Status:* implemented.

## Known gaps / risks

- Enum-value directives are lossy in Wesley L1, so the `VisualRole` *projections*
  live in the separate `colorful.vocabulary/v1` JSON manifest (the hashed source
  of truth), not as syntax-enum directives.
- The derivation trace is a **trace seed**, not replayable provenance: `passId`
  and `ruleId` now name a real, validated producer identity (IR-8), but
  `compilerBuildHash` is still a stand-in, and node-level input/output ids and
  artifact hashes are deferred.
- Canonical JSON rules (key order, number formatting) must be specified and
  enforced on both sides for IR-2a to be meaningful.
