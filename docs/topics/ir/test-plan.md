# IR — Test Plan

Verification for the Stage 1 surface IR (`colorful.syntax/v1`). Cases record
their implementation status individually; see [architecture](architecture.md)
for the design of record.

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
- **IR-13** Public vocabulary lookups return `Option`: caller-supplied,
  uncovered token axes fail soft instead of panicking, the validated embedded
  manifest gives complete coverage for every current `PosClass` and generated
  `VisualRole`, and all three fallible signatures are an explicitly documented
  breaking API change in the queued v0.4.0 line, never a silent patch release.
- **IR-14** `validate_document` rejects malformed received-artifact token layout
  and structure graphs, not only malformed individual ranges and identifiers.
- **IR-15** Public adapter and projection input is validated before IR emission,
  with typed path-addressed errors and deterministic precedence.
- **IR-16** Rust and JavaScript vocabulary validators are generated from one
  schema authority and protected by regeneration drift CI.
- **IR-17** The IR witness has process-level negative legs for malformed
  identity, shape, hashes, axes, offsets, and required fields.
- **IR-18** Validator error definitions and complexity budgets are mechanically
  checkable, and mutation evidence replaces speculative invariant-gap hunting
  where it provides value.
- **IR-19** An independent non-Rust consumer proves migration across two
  released contract generations and whether the IR reduces downstream effort
  relative to CLI text or LSP tokens.
- **IR-20** Public IR projection and vocabulary APIs have concise runnable
  examples that demonstrate their fallible boundaries without duplicating the
  IR reference.
- **IR-21** Bounded seeded property evidence exercises valid projection and
  declarative malformed public-tree and received-IR mutations; accepted
  projections always validate, while malformed inputs fail for the exact
  invariant and path they violate.

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
  mismatch against the real source, reversed / out-of-bounds / non-char-
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
  reference consumer's shared admission gate — against the decoded document
  and the real source bytes before re-emitting, so an unknown field at any
  nesting level, a missing field, a wrongly typed field, invalid token layout,
  or malformed outline graph is rejected rather than canonicalized.
  This is proven for the TS leg specifically — the Rust leg's
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
  stable JavaScript error code, including token layout and outline graph
  invariants. *Oracle:* exact case-count equality with the public Rust variant inventory;
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
- **IR-13a** — *Requirement:* IR-13. *Behavior:* public `visual_role` returns
  `None` for caller-supplied axes without an authored mapping, while manifest
  validation and public lookups prove every current `PosClass` and generated
  `VisualRole` maps to `Some`. *Oracle:* exact `Option` equality through the
  public API plus complete manifest coverage. *Evidence type:* unit test.
  *Evidence:* `colorful-ir`
  `vocabulary::tests::visual_role_returns_none_for_uncovered_axes`,
  `pos_classes_map_to_the_expected_roles`, and
  `manifest_parses_and_every_role_has_a_projection`. *Status:* implemented.
- **IR-13b** — *Requirement:* IR-13. *Behavior:* the v0.4.0 changelog names
  `visual_role`, `visual_role_for`, and `projection` changing from total return
  values to `Option` as a breaking API, and a semver comparison against
  `v0.3.0` is interpreted alongside a checked-in compile-time signature
  contract instead of allowing the change to masquerade as patch-compatible.
  *Oracle:* the changelog explicitly calls the signatures breaking; a unit
  test assigns all three public functions to exact `Option`-returning function
  pointer types; the ordinary semver run accepts the declared v0.3 → v0.4
  major-line transition; a forced patch audit fails. *Evidence type:* unit
  test, documentation, and semver audit. *Evidence:* `colorful-ir`
  `vocabulary::tests::public_lookup_signatures_pin_the_v04_fallible_contract`;
  `[Unreleased]` changelog entry; public API docs in
  `crates/colorful-ir/src/vocabulary.rs`; recorded `cargo-semver-checks 0.49.0`
  runs on 2026-07-23:
  `cargo semver-checks --package colorful-ir --baseline-rev v0.3.0` exited zero
  after identifying a major change (therefore running zero applicable checks),
  while the same command with `--release-type patch` ran 223 checks and exited
  100 with five categories of major API violation. The tool did not report
  return-type changes; the checked-in compile-time signature test covers that
  gap rather than overstating the tool's coverage. *Status:* implemented.
- **IR-14a** — *Requirement:* IR-14. *Behavior:* `validate_document` extends its
  current per-range, boundary, identifier, and dangling-reference checks to
  reject empty, unsorted, and overlapping token ranges; invalid
  paragraph/sentence kind-depth pairs; cycles; multiple parents; and parent
  range violations. *Oracle:* one minimal received-artifact mutation per new
  invariant produces, respectively, `EmptyTokenRange`,
  `UnsortedTokenRange`, `OverlappingTokenRange`, `InvalidOutlineDepth`,
  `StructureCycle`, `MultipleStructureParents`, or
  `ChildRangeOutsideParent`, with the exact offending token/range/depth/edge
  path in deterministic token-index then structure-edge order. Existing
  code-point-boundary and duplicate token/node-id mutations remain green; all
  produced fixtures validate. The shared JavaScript wire validator rejects the
  same seven mutations with stable `GraftProjectionError.code` values, keeping
  the exhaustive parity inventory complete. *Evidence type:* public
  `validate_document` mutation tests, Graft consumer tests, and shared
  Rust/JavaScript mutation matrix. *Evidence:*
  `integration::{rejects_an_empty_token_range,rejects_an_unsorted_token_range,
  rejects_overlapping_token_ranges,rejects_an_invalid_outline_kind_depth_pair,
  rejects_a_structure_cycle,rejects_a_child_with_multiple_parents,
  rejects_a_child_outside_its_parent_range}`;
  `crates/colorful-ir/tests/fixtures/validator-parity.json`;
  `consumers/graft-projection.test.mjs`; `scripts/ir-witness.sh`. *Tracking:*
  [#126](https://github.com/flyingrobots/colorful-language/issues/126).
  *Status:* implemented.
- **IR-15a** — *Requirement:* IR-15. *Behavior:* one pure
  `ValidatedClassification` aggregate rejects malformed output from public
  custom parser/annotator ports before an adapter interprets it: unexpected
  tree shape; reversed, out-of-bounds, or non-character-boundary spans;
  unsorted or overlapping siblings/tokens; children outside their sentence;
  and tree/token count or span mismatch. *Oracle:* deterministic tree, token,
  then correspondence precedence plus the exact typed `ClassificationError`
  path for one minimal custom-port mutation per invariant; built-in producer
  output remains valid. *Evidence type:* core aggregate and LSP custom-port
  contract tests. *Evidence:* `colorful-core`
  `tests::validated_classification_{preserves_valid_built_in_shape,
  rejects_an_unexpected_root_kind,rejects_a_reversed_tree_span,
  rejects_an_out_of_bounds_tree_span,rejects_an_unsorted_tree_sibling,
  rejects_an_overlapping_tree_sibling,rejects_a_child_outside_its_sentence,
  rejects_a_mid_code_point_token_span,rejects_an_unsorted_token,
  rejects_an_overlapping_token,rejects_a_tree_token_count_mismatch,
  rejects_a_tree_token_span_mismatch}`; `colorful-lsp`
  `tests::analyze_document_propagates_a_custom_annotators_typed_span_error`.
  *Tracking:*
  [#142](https://github.com/flyingrobots/colorful-language/issues/142).
  *Status:* implemented.
- **IR-15b** — *Requirement:* IR-15. *Behavior:* public IR projection consumes
  the validated aggregate when one is available and preserves the raw
  `from_classification` entry point as a validating compatibility wrapper.
  Invalid producer input maps the existing `ClassificationError` into a typed
  `ProjectionError` instead of creating a parallel range-error model, and
  every projected document passes `validate_document` against its source
  before success is returned. *Oracle:* one minimal public-constructor
  mutation for reversed, out-of-bounds, non-character-boundary, unsorted,
  overlapping, and tree/token mismatch input returns the exact nested error
  variant/path; multi-defect input pins classification-before-identity
  precedence; aggregate-native and compatibility paths emit byte-identical
  valid output; and a core-valid but wire-invalid aggregate returns
  `InvalidProjectedDocument` with the exact receiver-validator error, proving
  that projection cannot bypass its postcondition. *Evidence type:* public
  projection integration tests and producer-front-door tests. *Evidence:*
  `colorful-ir`
  `integration::{projection_rejects_a_reversed_span_with_the_core_error_path,
  projection_rejects_an_out_of_bounds_span_with_the_core_error_path,
  projection_rejects_a_mid_code_point_span_with_the_core_error_path,
  projection_rejects_unsorted_tokens_with_the_core_error_path,
  projection_rejects_overlapping_tokens_with_the_core_error_path,
  projection_rejects_a_tree_token_count_mismatch_with_the_core_error_path,
  projection_rejects_a_tree_token_span_mismatch_with_both_paths,
  projection_checks_classification_before_producer_identity,
  aggregate_native_and_compatibility_projection_are_byte_identical,
  aggregate_projection_rejects_a_document_that_fails_its_postcondition}`;
  `colorful-projection`
  `tests::propagates_a_custom_annotators_typed_classification_error`.
  *Tracking:*
  [#144](https://github.com/flyingrobots/colorful-language/issues/144).
  *Status:* implemented.
- **IR-16a** — *Requirement:* IR-16. *Behavior:* one schema artifact generates
  the Rust and JavaScript role/key validators. The checked-in generator reads
  `contracts/colorful/vocabulary.v1.schema.json`, emits both language
  boundaries deterministically, and never treats either generated file as an
  authority. CI and release preparation generate into a temporary directory
  and compare both outputs byte-for-byte, so either stale consumer fails the
  gate. A schema-mutation fixture adds one legal role and key and proves that
  both outputs change together; the Rust and JavaScript manifest validators
  consume one shared class-role case matrix covering every legal key plus
  illegal axis combinations. *Oracle:* fresh generation is byte-identical to
  both committed outputs; changing the authority changes both outputs; every
  shared case has the same accept/reject result at both generated language
  boundaries. *Evidence type:* schema, generator, drift check, and
  cross-language fixtures. *Evidence:*
  `contracts/colorful/vocabulary.v1.schema.json`,
  `scripts/generate-vocabulary-validators.mjs`,
  `scripts/generate-vocabulary-validators.test.mjs`,
  `scripts/check-generated-vocabulary-drift.sh`,
  `crates/colorful-ir/src/generated/vocabulary_validator_v1.rs`,
  `consumers/generated/vocabulary-validator-v1.mjs`,
  `crates/colorful-ir/tests/fixtures/vocabulary-schema-extension.json`,
  `crates/colorful-ir/tests/fixtures/vocabulary-validator-parity.json`, and
  `vocabulary::tests::shared_class_role_cases_match_generated_rust_validator`;
  CI job `generated-ir-drift`; `scripts/release-prep.sh`. *Tracking:*
  [#145](https://github.com/flyingrobots/colorful-language/issues/145).
  *Status:* implemented.
- **IR-17a** — *Requirement:* IR-17. *Behavior:* real witness processes reject
  mismatched source, invalid JSON, wrong contract/schema/vocabulary hashes,
  illegal axes, fractional/out-of-range offsets, and missing fields without
  writing canonical output. A tenth case makes contract, schema, and
  vocabulary identities wrong together to pin contract-version rejection as
  the first failure. *Oracle:* both
  `node witness/ir-canonicalize.mjs SOURCE < ARTIFACT` and
  `target/debug/examples/recanon SOURCE < ARTIFACT` exit exactly `1`, emit the
  matrix's boundary-specific stable code on stderr, and leave a zero-byte
  stdout file for every case. *Evidence type:* process-level negative matrix.
  *Evidence:* deterministic mutations `mismatched-source`, `invalid-json`,
  `wrong-contract-version`, `wrong-schema-hash`, `wrong-vocabulary-hash`,
  `illegal-axes`, `fractional-offset`, `out-of-range-offset`, `missing-field`,
  and `identity-precedence` in `witness/process-negative.mjs`; alternate source
  `witness/negative/mismatched-source.txt`; process runner and assertions in
  `scripts/ir-witness.sh` (`assert_process_rejection` and the `process_cases`
  loop); stable Rust categories from `ValidationError::code`; stable Node
  categories from `GraftProjectionError.code` and `E_JSON_DECODE`. *Tracking:*
  [#148](https://github.com/flyingrobots/colorful-language/issues/148).
  *Status:* implemented.
- **IR-18a** — *Requirement:* IR-18. *Behavior:* adding a
  `ValidationError` variant requires one authored definition that supplies its
  path and display behavior without three synchronized hand edits. *Oracle:* a
  compile-time inventory and rendering tests fail when any generated/derived
  member is missing. *Evidence type:* declarative error definition and unit
  tests. *Evidence:* `colorful-ir` `define_validation_errors!`,
  `integration::shared_validator_parity_matrix_covers_every_error_variant`,
  `integration::validation_error_display_renders_path_and_message`,
  `integration::validation_errors_display_lists_every_error_by_display_not_debug`,
  and `integration::validation_error_display_escapes_untrusted_document_strings`.
  *Tracking:* [#80](https://github.com/flyingrobots/colorful-language/issues/80).
  *Status:* implemented.
- **IR-18b** — *Requirement:* IR-18. *Behavior:* the validator complexity budget
  is enforced by a reproducible tool or explicitly retired with documented
  rationale. The configured Clippy score is treated as a Rust
  1.97.1-toolchain-bound source-shape heuristic, not a standardized
  human-comprehension metric. *Oracle:* a deliberate over-budget fixture fails
  the named check, the current reference names the evidence toolchain and
  limitation, or the policy and CI remove the unsupported claim together.
  *Evidence type:* source-policy test or reviewed policy deletion. *Evidence:*
  the root `clippy.toml` threshold, the production-only
  `clippy::cognitive_complexity` opt-in in `colorful-ir`,
  `scripts/check-validator-complexity.sh`, its deliberate over-budget fixture
  under `scripts/fixtures/validator-complexity/`, the blocking CI Rust job, and
  `scripts/release-prep.sh`. *Tracking:*
  [#81](https://github.com/flyingrobots/colorful-language/issues/81).
  *Status:* implemented.
- **IR-18c** — *Requirement:* IR-18. *Behavior:* bounded deterministic mutation
  runs prove the validator tests kill reviewed invariant-breaking mutations and
  seed useful survivors into normal regression tests. *Oracle:* the pinned
  mutation corpus reports no unexplained surviving in-scope mutation.
  *Evidence type:* `cargo-mutants` configuration, bounded CI corpus, and seeded
  tests. *Evidence:* `.cargo/mutants.toml`,
  `scripts/fixtures/ir-validator-mutants.txt`,
  `scripts/check-ir-validator-mutants.sh`,
  `integration::rejects_a_cycle_reached_through_an_unvisited_child`, the
  blocking Rust CI job, and `scripts/release-prep.sh`. *Tracking:*
  [#82](https://github.com/flyingrobots/colorful-language/issues/82).
  *Status:* implemented.
- **IR-19a** — *Requirement:* IR-19. *Behavior:* a standalone Node package
  with no Cargo-workspace or third-party runtime dependency admits a
  `DocumentAnalysis` only after validating its required shape, supported
  contract generation, schema and vocabulary identities, raw-source UTF-8,
  source length and digest, and token ranges, then renders a deterministic
  role-span report. Invalid JSON, invalid UTF-8, unsupported generations, wrong
  identities, missing or unknown fields, and mismatched source fail with stable
  error codes and no report on stdout.
  *Oracle:* exact report bytes for valid input; exact process status, error
  code, and empty stdout for every refusal. *Evidence type:* process-level
  consumer tests. *Evidence:*
  `consumers/independent-ir-report/src/{common,profile,ir}.mjs`,
  `consumers/independent-ir-report/bin/report.mjs`, and
  `consumer.test.mjs`
  `the IR process refuses every stable category without output`,
  `the IR process rejects invalid UTF-8 before source identity trust`,
  `the IR process reports file-system failures as stable refusals`,
  `IR admission rejects unknown fields in every document record`,
  `release profiles project every classified visual role`,
  `IR admission enforces derivation trace identity`,
  `Markdown reports escape table delimiters inside code spans`,
  `LSP capture bounds child-process exit`,
  `the retention rule honors both documented decision branches`.
  *Tracking:*
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).
  *Status:* implemented.
- **IR-19b** — *Requirement:* IR-19. *Behavior:* the consumer accepts
  provenance-recorded artifacts emitted by the real `v0.2.1` and `v0.3.0`
  release binaries. It migrates the additive `openClassKind` generation
  boundary into one internal role-span model while preserving the source and
  rejecting unregistered identity combinations. *Oracle:* both fixtures
  render the reviewed common report; generation-specific profile hashes match
  the tagged contract and vocabulary inputs; swapping any profile identity
  fails closed. *Evidence type:* checked-in tagged fixtures, migration tests,
  and a fixture-provenance check. *Evidence:*
  `consumers/independent-ir-report/fixtures/releases/{v0.2.1,v0.3.0}/`,
  `consumers/independent-ir-report/fixtures/expected/{v0.2.1,v0.3.0}.md`,
  `scripts/version-compat-matrix.sh`, and
  `consumer.test.mjs` `v0.2.1 and v0.3.0 IR render the same report`.
  *Tracking:*
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).
  *Status:* implemented.
- **IR-19c** — *Requirement:* IR-19. *Behavior:* IR, ANSI CLI text, and LSP
  semantic tokens perform the same role-span reporting job over the same
  source, with implementation and maintenance burden recorded under one
  executable measurement method. The ledger reports nonblank adapter lines,
  validation/error categories, fixtures, assertions, migration-specific
  lines, runtime dependencies, and process steps. *Oracle:* every adapter
  renders byte-identical output, the committed ledger matches a fresh
  measurement, and the IR rationale applies the reviewed retain/simplify rule
  to the measured result. *Evidence type:* black-box parity test, generated
  integration-effort ledger, and design decision. *Evidence:*
  `consumers/independent-ir-report/src/{ansi,lsp,lsp-fixture,measure}.mjs`,
  `consumers/independent-ir-report/scripts/capture-lsp.mjs`,
  `consumers/independent-ir-report/evidence/integration-effort.json`,
  `consumer.test.mjs`
  `IR, ANSI CLI text, and LSP tokens render the same v0.3.0 job`, and
  `architecture.md` `Product-evidence gate`. *Tracking:*
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).
  *Status:* implemented.
- **IR-19d** — *Requirement:* IR-19. *Behavior:* the proof runs from a clean
  copy containing only the independent package, with no repository
  `Cargo.toml`, `target/`, built Colorful binary, or ambient `node_modules`.
  *Oracle:* `npm ci` and the package's full test/report command pass in the
  temporary copy, and a guard fails if any path escapes that package root.
  *Evidence type:* clean-environment shell witness in CI and release
  preparation. *Evidence:* `scripts/check-independent-consumer.sh`, CI
  `ir-witness`, and `scripts/release-prep.sh`. *Tracking:*
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).
  *Status:* implemented.
- **IR-20a** — *Requirement:* IR-20. *Behavior:* the public producer front door
  projects valid source and demonstrates typed failure handling in a compiled
  rustdoc example. *Oracle:* `cargo test --doc --workspace` runs the success
  assertion and compiles explicit `ProjectionError` handling. *Evidence type:*
  public API doctest. *Evidence:* `colorful-projection` `build_document`
  rustdoc and `scripts/check-public-api-doctests.mjs`. *Tracking:*
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  *Status:* implemented.
- **IR-20b** — *Requirement:* IR-20. *Behavior:* public vocabulary lookups
  demonstrate both an authored mapping and an uncovered caller-supplied
  combination. *Oracle:* `cargo test --doc --workspace` runs exact `Some` and
  `None` assertions. *Evidence type:* public API doctest. *Evidence:*
  `colorful-ir` `vocabulary::visual_role` rustdoc and
  `scripts/check-public-api-doctests.mjs`. *Tracking:*
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  *Status:* implemented.
- **IR-21a** — *Requirement:* IR-21. *Behavior:* one seeded generator chooses a
  valid Unicode source plus a declarative public-tree or received-IR mutation.
  Valid built-in projection must pass `validate_document`; malformed tree
  shapes and span layouts reach all nine typed `ClassificationError` variants;
  received-IR mutations are rejected for the selected `ValidationError` code
  and structured path, not merely for any error. Time-based projection and
  validation fuzz targets reuse the same public entry points outside the
  correctness gate. *Oracle:* exact success postcondition or exact error
  code/path equality for every generated mutation kind, with no panic.
  *Evidence type:* seeded property test, mutation model, fuzz targets, and
  minimized ordinary regressions. *Evidence:*
  `crates/colorful-cli/tests/property_boundaries.rs`
  `seeded_property_boundaries_hold_for_each_generated_case`;
  `fuzz/fuzz_targets/ir_projection.rs`;
  `scripts/check-property-fuzz-policy.mjs`. *Tracking:*
  [#134](https://github.com/flyingrobots/colorful-language/issues/134).
  *Status:* implemented.

## Known gaps / risks

- Enum-value directives are lossy in Wesley L1, so the `VisualRole` *projections*
  live in the separate `colorful.vocabulary/v1` JSON manifest (the hashed source
  of truth), not as syntax-enum directives.
- The derivation trace is a **trace seed**, not replayable provenance: `passId`
  and `ruleId` now name a real, validated producer identity (IR-8), but
  `compilerBuildHash` is still a stand-in, and node-level input/output ids and
  artifact hashes are deferred.
- The independent consumer retains stable v1 under the reviewed cost and
  correctness rule. Its 424-line IR adapter is larger than the 305-line
  LSP protocol and decoding adapter, so reducing duplicate consumer admission
  code is deliberate follow-up debt in
  [#222](https://github.com/flyingrobots/colorful-language/issues/222); the
  measured correctness advantage does not justify expanding the wire contract.
- The `v0.2.1` and `v0.3.0` schema generations share one
  `colorful.syntax/v1` label. IR-19 uses their full identity tuples to fail
  closed, but the compatibility meaning of an intra-v1 schema change remains
  implicit and release-tag-oriented;
  [#221](https://github.com/flyingrobots/colorful-language/issues/221) owns the
  generated/declarative compatibility authority.
