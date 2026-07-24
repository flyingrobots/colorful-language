# IR — Test Plan

Verification for the Stage 1 surface IR (`colorful.syntax/v1`). All cases are
**implemented**; see [architecture](architecture.md) for the design of record.

Requirements:

- **IR-1** One GraphQL contract generates Rust and TS boundary types that
  agree, and the committed generated output matches what an immutable,
  pinned Wesley checkout actually produces today (not just an ambient
  developer checkout at the time someone last ran `scripts/gen-ir.sh`).
- **IR-2** The IR serializes to a canonical JSON that round-trips byte-for-byte
  across the language boundary.
- **IR-3** The IR honors invariants that SDL cannot express, across a
  corpus spanning empty input, Unicode, CR/LF variants, punctuation-only
  input, long tokens, multiple paragraphs, and contextual ambiguity.
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
- **IR-10** A paragraph boundary in the outline is a blank line: a gap between
  two sentences containing at least two logical line breaks (`\n`, `\r`, or
  `\r\n` — each counted once, never a raw `\n` byte count) with only
  whitespace between them.
- **IR-11** Every `ValidationError` names exactly where it occurred via a
  structured `Path`, is produced by validation running as fixed, ordered
  stages so the overall error order is deterministic, and never lets
  untrusted document content forge output when its `Display` rendering is
  printed by a consumer.
- **IR-12** `schemaHash` is normalized against GraphQL description-line
  edits — a description-only line edit does not change the hash, but any other
  change (including formatting, type, field, or enum edits) does — and both
  sides of the language boundary (`colorful-ir` and the Graft reference
  consumer) normalize identically.

## Cases

- **IR-1a** — *Requirement:* IR-1. *Behavior:* `wesley-cli emit rust` and
  `emit typescript` from `colorful.syntax/v1` produce types covering every
  contract field. *Oracle:* the `colorful-ir` crate compiles the generated Rust;
  `tsc` type-checks the generated TS (`witness/ir-consume.ts`). *Evidence:*
  `crates/colorful-ir/src/generated/`, `scripts/ir-witness.sh` (tsc step).
  *Status:* implemented.
- **IR-1b** — *Requirement:* IR-1. *Behavior:* the committed
  `crates/colorful-ir/{src/generated,ts}/` output is byte-identical to what
  Wesley `0.1.1`, cloned from an immutable pinned commit SHA in
  `flyingrobots/wesley` (not a floating tag/branch, and not an ambient
  developer `COLORFUL_WESLEY_ROOT` checkout), generates from
  `contracts/colorful/*.graphql` today; generation happens into a temporary
  directory, never overwriting the checkout. *Oracle:* `cmp` byte equality
  per generated file; non-zero exit and a unified diff on any drift.
  *Evidence type:* executable script check. *Evidence:* `scripts/check-generated-ir-drift.sh`; CI job
  `generated-ir-drift`; `scripts/release-prep.sh`. *Status:* implemented.
- **IR-2a (the gate)** — *Requirement:* IR-2. *Behavior:* a `DocumentAnalysis`
  round-trips `Rust → JSON A → TS decode → JSON B → Rust decode → JSON C`.
  *Oracle:* `A == B == C` byte-for-byte. *Evidence:* `scripts/ir-witness.sh`
  (CI job `ir-witness`). *Status:* implemented.
- **IR-3a** — *Requirement:* IR-3. *Behavior/oracle:* byte ranges ordered, within
  `utf8ByteLength`, non-overlapping, on char boundaries; every `structure` node's
  range contains its children; `source.contentHash` matches the bytes;
  proven against one hand-written baseline fixture. *Evidence:*
  `colorful-ir` `integration::document_analysis_holds_the_invariants`.
  *Status:* implemented.
- **IR-3b** — *Requirement:* IR-3. *Behavior:* the same invariant oracle as
  IR-3a holds across a committed corpus of seven named fixtures — empty
  input, Unicode, CR/LF variants, punctuation-only input, long tokens,
  multiple paragraphs, and contextual ambiguity (a sentence exercising
  `colorful-lexicon`'s ambiguous-word rules: `book`, `record`, `lead`,
  `fast`) — reusing the exact same assertion function
  (`assert_invariants_hold`) rather than a bespoke check per fixture.
  *Oracle:* same as IR-3a, parameterized. *Evidence:* `colorful-ir`
  `integration::invariant_corpus_holds_across_documented_edge_cases`.
  *Status:* implemented.
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
- **IR-4d** — *Requirement:* IR-4. *Behavior:* the witness TS leg
  (`witness/ir-canonicalize.mjs`) runs `validateWireContract` — the graft
  reference consumer's admission gate minus its graft-specific token-order
  check — against the decoded document and the real source bytes before
  re-emitting, so an unknown field at any nesting level, a missing field, or
  a wrongly typed field is rejected (exit non-zero, for the specific
  expected reason) rather than canonicalized. Deliberately does *not* enforce
  non-overlapping token wire order: that is a graft-projection requirement,
  not part of the wire contract, and `colorful_ir::validate_document` leaves
  it unchecked. This is proven for the TS leg specifically — the Rust leg's
  generated `DocumentAnalysis` deserializes via `serde`'s default
  unknown-field-tolerant behavior, so unknown-field rejection is not yet
  proven symmetric across both languages. *Oracle:* the TS leg exits
  non-zero, with the expected message substring, for each of three
  checked-in negative fixtures (unknown field, missing field, wrong type),
  and exits zero for the valid fixture. *Evidence:*
  `witness/negative/{unknown-field,missing-field,wrong-type}.json`;
  `scripts/ir-witness.sh` (negative-fixtures step, asserting the expected
  message per fixture); `consumers/graft-projection.mjs`'s
  `rejectUnknownFields` calls at the document root, `source`, each token,
  structure node, diagnostic, derivation step, and byte range;
  `consumers/graft-projection.test.mjs`'s unknown-field assertions.
  Verified the negative-fixtures step actually catches a regression: removed
  the unknown-field check, confirmed `scripts/ir-witness.sh` failed exactly
  on the `unknown-field` fixture, then restored it. *Status:* implemented.
- **IR-4e** — *Requirement:* IR-4. *Behavior:* one shared declarative mutation
  matrix covers every Rust `ValidationError` variant that has an overlapping
  JavaScript `validateWireContract` rejection: both validators start from the
  same canonical producer document, apply the same mutation and optional
  source-byte override, and reject with the matrix's named Rust variant /
  stable JavaScript error code. Graft-only token wire ordering remains outside
  the matrix because it is deliberately stricter than the wire contract.
  *Oracle:* exact case-count equality with the public Rust variant inventory;
  the expected Rust variant is present; JavaScript throws the expected
  `GraftProjectionError.code`; no matrix case is silently skipped. *Evidence
  type:* shared fixture matrix plus Rust/JavaScript executable witnesses.
  *Evidence:* `crates/colorful-ir/tests/fixtures/validator-parity.json`,
  `colorful-ir` `integration::shared_validator_parity_matrix_covers_every_error_variant`,
  `witness/validator-parity.mjs`, and `scripts/ir-witness.sh`. *Status:*
  implemented.
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
  `ProjectionError::MissingPassIdentity`. *Evidence type:* integration test.
  *Evidence:* `colorful-ir`
  `integration::from_classification_rejects_an_unidentified_parser` /
  `..._rejects_an_unidentified_annotator`. *Status:* implemented.
- **IR-8b** — *Requirement:* IR-8. *Behavior:* `from_classification` threads
  each producer's real `pass_identity()` into `derivation` instead of
  hardcoded literals — a different annotator is named under its own honest
  `ruleId` — and rejects two producers claiming the same pass id. *Oracle:*
  `derivation[i].passId`/`ruleId` equal the producer's identity;
  `ProjectionError::DuplicatePassId` on a clash. *Evidence type:* integration
  test. *Evidence:* `colorful-ir`
  `integration::derivation_reports_the_real_producers_pass_identity`,
  `derivation_names_a_different_annotator_honestly`,
  `from_classification_rejects_a_duplicate_pass_id`. *Status:* implemented.
- **IR-8c** — *Requirement:* IR-8. *Behavior:* a received document's derivation
  is validated the same way: an empty `derivation` list, an empty
  `passId`/`ruleId` on a step, or a `passId` shared across steps, is rejected —
  checked across the complete `derivation` list, not only the two steps
  today's producer happens to emit. An empty list is checked explicitly rather
  than left to the per-step loop, since a loop over zero steps would otherwise
  vacuously pass. *Oracle:* `ValidationError::EmptyDerivation` /
  `MissingDerivationIdentity` / `DuplicateDerivationPassId`. *Evidence type:*
  integration test. *Evidence:* `colorful-ir`
  `integration::rejects_an_artifact_with_an_empty_derivation_trace`,
  `rejects_a_derivation_step_with_missing_identity`,
  `rejects_derivation_steps_sharing_a_pass_id`. *Status:* implemented.
- **IR-9a** — *Requirement:* IR-9. *Behavior:* `build_document` parses,
  annotates, and projects a `Parser`/`Annotator` pair (borrowed, not consumed)
  into an `AnalyzedDocument`, sourcing each `PassIdentity` from
  `pass_identity()`. *Oracle:* output is byte-identical to a hand-rolled
  parse/annotate/`from_classification` call. *Evidence type:* integration
  test. *Evidence:* `colorful-projection`
  `tests::builds_the_same_document_a_hand_rolled_pipeline_would`,
  `tests::propagates_a_missing_pass_identity`. *Status:* implemented.
- **IR-9b** — *Requirement:* IR-9. *Behavior:* IR tokens correspond 1:1 by
  index to core tokens — matching byte ranges, and agreeing with the same
  `visual_role`/`visual_role_for` mapping every ANSI/LSP role lookup uses.
  *Oracle:* pairwise equality across `AnalyzedDocument.tokens` and
  `.document.tokens`. *Evidence type:* integration test. *Evidence:*
  `colorful-projection`
  `tests::ir_tokens_correspond_1to1_to_core_tokens`. *Status:* implemented.
- **IR-10a** — *Requirement:* IR-10. *Behavior:* a named
  `logical_line_break_count` counts `\n`, `\r`, and `\r\n` as one break each,
  never double-counting a `\r\n` pair; `is_paragraph_break` additionally
  requires the gap be pure whitespace. *Oracle:* direct equality on hand-built
  gap strings. *Evidence type:* unit test. *Evidence:* `colorful-ir`
  `tests::logical_line_break_count_treats_crlf_as_one_break`,
  `tests::is_paragraph_break_requires_only_whitespace_between_the_breaks`.
  *Status:* implemented.
- **IR-10b** — *Requirement:* IR-10. *Behavior:* a blank line made of `\r`
  only (classic Mac line endings, no `\n` byte anywhere) splits paragraphs
  exactly like `\n\n`; a single `\r` does not; a `\r\n\r\n` blank line counts
  as one boundary, not two. *Oracle:* paragraph count over the projected
  outline. *Evidence type:* integration test. *Evidence:* `colorful-ir`
  `integration::a_carriage_return_only_blank_line_splits_paragraphs`,
  `a_single_carriage_return_does_not_split_paragraphs`,
  `a_crlf_blank_line_splits_paragraphs_exactly_once`. *Status:* implemented.

- **IR-11a** — *Requirement:* IR-11. *Behavior:* every `ValidationError`
  variant's `path()` renders the exact field it names (e.g.
  `derivation[0]`, `diagnostics[0].byteRange.endUtf8`), and validation runs
  as seven fixed stages — contract identity, source identity, token ranges,
  token axes, structure graph, diagnostics, derivation — so errors spanning
  every stage come back in that stage order. *Oracle:* per-error `path.
  to_string()` equality (exact for most variants; a path-prefix check for
  `IllegalTokenAxes` and `DanglingChildRef`, whose exact index depends on
  fixture shape rather than the invariant under test); relative positions of
  one error from each of the seven stages, including source identity.
  *Evidence type:* unit +
  integration test. *Evidence:* `colorful-ir`
  `integration::rejects_wrong_contract_schema_and_vocabulary`,
  `integration::rejects_content_hash_and_byte_length_against_the_real_source`,
  `integration::rejects_a_range_out_of_order_and_out_of_bounds`,
  `integration::rejects_a_negative_offset`,
  `integration::rejects_a_range_off_a_utf8_char_boundary`,
  `integration::rejects_illegal_token_axes`,
  `integration::rejects_a_duplicate_token_id`,
  `integration::rejects_a_dangling_child_ref`,
  `integration::rejects_a_duplicate_node_id`,
  `integration::rejects_an_out_of_bounds_diagnostic_range`,
  `integration::negative_declared_byte_length_is_rejected_without_a_source`,
  `integration::byte_length_mismatch_is_reported_even_for_non_utf8_source`,
  `integration::rejects_a_derivation_step_with_missing_identity`,
  `integration::rejects_an_artifact_with_an_empty_derivation_trace`,
  `integration::rejects_derivation_steps_sharing_a_pass_id`,
  `integration::error_order_follows_the_seven_validator_stages`. *Status:*
  implemented.
- **IR-11b** — *Requirement:* IR-11. *Behavior:* `ValidationError`'s `Display`
  renders `"at {path}: {message}"`, and `ValidationErrors` lists each error by
  `Display`, not `Debug`; document-controlled strings interpolated into that
  text (`contractVersion`, hash `found` values, derivation `passId`) are
  escaped via `escape_debug()` before rendering, so a value containing a
  newline or a terminal control sequence comes out as visible, inert text
  instead of being interpreted by a consumer's terminal. *Oracle:* exact
  rendered string equality; absence of raw control characters in rendered
  output for a hostile fixture value. *Evidence type:* unit test. *Evidence:*
  `colorful-ir`
  `integration::validation_error_display_renders_path_and_message`,
  `integration::validation_errors_display_lists_every_error_by_display_not_debug`,
  `integration::validation_error_display_escapes_untrusted_document_strings`.
  *Status:* implemented.

- **IR-12a** — *Requirement:* IR-12. *Behavior:* a description-only line edit
  does not change the normalized hash, but any other edit (including formatting
  or shape changes) still does. *Oracle:* hash equality/inequality on synthetic
  SDL strings. *Evidence type:* unit test. *Evidence:* `colorful-ir`
  `tests::strip_graphql_descriptions_removes_only_description_lines`,
  `tests::schema_hash_is_unchanged_by_a_description_only_edit`,
  `tests::schema_hash_changes_when_shape_changes`. *Status:* implemented.
- **IR-12b** — *Requirement:* IR-12. *Behavior:* the Graft reference
  consumer's `stripGraphqlDescriptions` normalizes identically to
  `colorful-ir`'s `strip_graphql_descriptions`, including trailing-newline
  handling, so `schemaHash()` on both sides of the language boundary
  matches for the real contract. *Oracle:* hash equality on synthetic SDL
  strings; cross-language hash equality verified manually against the real
  contract at authoring time. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.

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
