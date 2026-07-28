# Downstream consumers test plan

Verification for tools that consume `colorful.syntax/v1` outside this Rust
workspace.

## Requirements

- **CONSUMER-1** Consumers verify the source bytes before projecting token
  ranges.
- **CONSUMER-2** Consumers verify `vocabularyHash` before applying presentation
  classes.
- **CONSUMER-3** Graft projection converts UTF-8 byte offsets to row/column
  spans without UTF-16 drift.
- **CONSUMER-4** Open-class roles project through the vocabulary manifest, not a
  private class table.
- **CONSUMER-5** jedit/Graft discovery depends on a `colorful` CLI with version
  `0.3.0` or newer.
- **CONSUMER-6** The reference consumer validates a received artifact's
  structural shape, contract identity, and internal consistency before
  projecting it — rejecting malformed input rather than repairing or clamping
  it — via one ordered `validateArtifact` admission gate: cheap structural
  checks first, expensive hashes last.
- **CONSUMER-7** Shared received-artifact invariants remain explicit and
  executable across Rust and JavaScript; any future consumer-specific
  admission rule stays separately named.
- **CONSUMER-8** Rust and JavaScript role/key validators are generated from one
  vocabulary authority and fail CI on regeneration drift.
- **CONSUMER-9** Process-level witness failures reject malformed artifacts under
  stable error categories without emitting canonical output.
- **CONSUMER-10** An independent consumer proves validation, rendering,
  incompatible-version rejection, and migration across two released contract
  generations, then compares that effort with CLI text and LSP tokens.

## Cases

- **CONSUMER-1a** — *Requirement:* CONSUMER-1. *Behavior:* projection rejects a
  source whose bytes do not match the IR `contentHash`. *Oracle:* JavaScript
  assertion. *Evidence:* `consumers/graft-projection.test.mjs`. *Status:*
  implemented.
- **CONSUMER-2a** — *Requirement:* CONSUMER-2. *Behavior:* projection rejects a
  missing or mismatched `vocabularyHash`. *Oracle:* JavaScript assertion.
  *Evidence:* `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-3a** — *Requirement:* CONSUMER-3. *Behavior:* multibyte UTF-8 before
  a token does not corrupt projected row/column spans. *Oracle:* JavaScript
  assertion. *Evidence:* `consumers/graft-projection.test.mjs`; CI
  `ir-witness` job. *Status:* implemented.
- **CONSUMER-3b** — *Requirement:* CONSUMER-3. *Behavior:* `makeByteToPoint`'s
  column counts Unicode scalar values (code points), not grapheme clusters: a
  combining mark is its own column, a precomposed accented letter is one
  column, and a single-code-point emoji is one column despite two UTF-16
  units. *Oracle:* JavaScript assertions. *Evidence type:* unit test.
  *Evidence:* `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-3c** — *Requirement:* CONSUMER-3. *Behavior:* `makeByteToPoint`
  advances a monotonic cursor forward for sequential (project()'s actual call
  pattern) queries instead of rescanning from row 0 every call, falling back
  to a binary search when a caller queries backward. A deterministic
  complexity check (advances bounded by line count, not line count × call
  count) proves this without timing anything; a separate, non-blocking
  wall-clock benchmark reports median timings for context only. *Oracle:*
  JavaScript assertion on a counter; wall-clock is informational. *Evidence
  type:* unit test (deterministic) plus an informational benchmark.
  *Evidence:* `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-3d** — *Requirement:* CONSUMER-3. *Behavior:* the complete
  fail-closed `project()` boundary runs in release evidence over the same fixed
  899-byte and 45-KB corpora used by the Rust cross-stage matrix. *Oracle:* a
  versioned report records corpus hashes, token/span counts, median latency, and
  source-byte throughput, and deterministic tests reject stale corpora or
  self-inconsistent arithmetic; allocator-level attribution remains explicitly
  unavailable for the JavaScript runtime. *Evidence type:* informational
  release benchmark plus deterministic report-contract test. *Tracking:*
  [#135](https://github.com/flyingrobots/colorful-language/issues/135).
  *Evidence:* `consumers/graft-projection.benchmark.mjs`;
  `crates/colorful-cli/benchmarks/cross-stage-baseline.json`;
  `cross_stage_benchmark_report::cross_stage_benchmark_report_is_complete_and_advisory`.
  *Status:* implemented.
- **CONSUMER-4a** — *Requirement:* CONSUMER-4. *Behavior:* structural keyword,
  proper noun, number, quote, unstyled content, and open-class roles all derive
  their Graft class from the vocabulary manifest. *Oracle:* JavaScript
  assertions. *Evidence:* `consumers/graft-projection.test.mjs`. *Status:*
  implemented.
- **CONSUMER-5a** — *Requirement:* CONSUMER-5. *Behavior:* repository docs state
  the Graft/jedit CLI version floor as `0.3.0` or newer, and an executable
  compatibility matrix proves the floor against the real, immutable `v0.2.1`
  and `v0.3.0` tags: `v0.2.1`'s `--version` probe fails (the flag did not
  exist yet), `v0.3.0`'s succeeds and reports `colorful 0.3.0`, and both
  tags' `colorful ir` output remains a self-consistent artifact for their
  era's own reference consumer, with `openClassKind` absent from `v0.2.1`'s
  output and present in `v0.3.0`'s. *Oracle:* script exit code and printed
  assertions. *Evidence:* `scripts/version-compat-matrix.sh`; `README.md`;
  this topic. *Status:* implemented; the version-gate enforcement itself
  still lives in the downstream Graft repository.
- **CONSUMER-6a** — *Requirement:* CONSUMER-6. *Behavior:* a malformed
  top-level shape, wrong `contractVersion`, wrong declared byte length, or
  invalid UTF-8 source is rejected with a stable `GraftProjectionError.code`
  (`E_ARTIFACT_SHAPE`, `E_CONTRACT_VERSION`, `E_BYTE_LENGTH`, `E_SOURCE_UTF8`),
  in that order, before any hash is checked. *Oracle:* JavaScript assertions
  on `err.code`. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-6b** — *Requirement:* CONSUMER-6. *Behavior:* token byte ranges
  are validated for order (`E_BYTE_RANGE_ORDER`), bounds
  (`E_BYTE_RANGE_BOUNDS`), and UTF-8 char-boundary alignment
  (`E_BYTE_RANGE_BOUNDARY`); empty (`E_TOKEN_EMPTY`), unsorted
  (`E_TOKEN_UNSORTED`), or overlapping (`E_TOKEN_OVERLAP`) token ranges are
  rejected, never sorted into validity. *Oracle:* JavaScript assertions on
  `err.code`. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-6c** — *Requirement:* CONSUMER-6. *Behavior:* duplicate
  `occurrenceId`s (`E_DUPLICATE_OCCURRENCE_ID`) and illegal token axis
  combinations (`E_TOKEN_AXES`, mirroring `colorful_ir`'s
  `token_axes_violation` exactly) are rejected. *Oracle:* JavaScript
  assertions on `err.code`. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-6d** — *Requirement:* CONSUMER-6. *Behavior:* the structure graph
  is checked for duplicate node ids (`E_DUPLICATE_NODE_ID`) and dangling child
  references (`E_DANGLING_CHILD_REF`), invalid paragraph/sentence depth
  (`E_OUTLINE_DEPTH`), cycles (`E_STRUCTURE_CYCLE`), multiple parents
  (`E_MULTIPLE_STRUCTURE_PARENTS`), and children outside their parent range
  (`E_CHILD_RANGE`) — the same scope as `colorful_ir::validate_document`.
  *Oracle:* JavaScript assertions on `err.code`. *Evidence type:* unit test.
  *Evidence:* `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-6e** — *Requirement:* CONSUMER-6. *Behavior:* `schemaHash` is
  independently recomputed from the consumer's own
  `contracts/colorful/syntax.v1.graphql` copy (byte-identical to
  `colorful-ir`'s package-local copy, enforced by
  `scripts/package-witness.sh`) and checked before `vocabularyHash` and
  `contentHash`; corrupting all three at once surfaces `E_SCHEMA_HASH` first.
  *Oracle:* JavaScript assertions on `err.code` and hash equality. *Evidence
  type:* unit test. *Evidence:* `consumers/graft-projection.test.mjs`.
  *Status:* implemented.
- **CONSUMER-6f** — *Requirement:* CONSUMER-6. *Behavior:* `tokenKind`,
  `lexicalClass`, `functionKind`, `openClassKind`, and outline node `kind`
  are checked against the actual wire enum, not merely "is a string" — an
  unknown value is rejected at admission (`E_ARTIFACT_SHAPE`) instead of
  later throwing an uncoded `Error` from deep inside projection. Integer
  fields (`occurrenceId`, `nodeId`, `depth`, child ids, byte offsets) are
  held to the real `colorful.syntax/v1` wire range (signed `i32`), not
  merely "any JS safe integer". *Oracle:* JavaScript assertions on
  `err.code`. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-6g** — *Requirement:* CONSUMER-6. *Behavior:* `diagnostics` and
  `derivation` are shape- and range-validated like `tokens`/`structure`; an
  empty `derivation` (`E_EMPTY_DERIVATION`), a step with an empty
  `passId`/`ruleId` (`E_MISSING_DERIVATION_IDENTITY`), or two steps sharing a
  `passId` (`E_DUPLICATE_DERIVATION_PASS_ID`) are each rejected — mirroring
  `colorful_ir::validate_document`'s own derivation checks exactly. *Oracle:*
  JavaScript assertions on `err.code`. *Evidence type:* unit test.
  *Evidence:* `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-7a** — *Requirement:* CONSUMER-7. *Behavior:* when
  `validate_document` adopts inter-token and structure-graph invariants,
  `validateWireContract` adopts the same received-artifact scope. *Oracle:* one
  shared mutation matrix names the expected Rust variant and JavaScript error
  code for each shared invariant.
  *Evidence type:* cross-language mutation fixtures and executable parity tests.
  *Evidence:* `crates/colorful-ir/tests/fixtures/validator-parity.json`;
  `integration::shared_validator_parity_matrix_covers_every_error_variant`;
  `witness/validator-parity.mjs`; `scripts/ir-witness.sh`.
  *Tracking:*
  [#126](https://github.com/flyingrobots/colorful-language/issues/126).
  *Status:* implemented.
- **CONSUMER-8a** — *Requirement:* CONSUMER-8. *Behavior:* one schema artifact
  generates Rust and JavaScript role/key validators, and either stale consumer
  fails regeneration CI. *Oracle:* generated files are byte-identical to fresh
  output and both consumers accept/reject the same manifest keys.
  *Evidence type:* generator drift check and cross-language fixtures. *Evidence:*
  `scripts/check-generated-vocabulary-drift.sh`,
  `scripts/generate-vocabulary-validators.test.mjs`, and
  `crates/colorful-ir/tests/fixtures/vocabulary-validator-parity.json`.
  *Tracking:*
  [#145](https://github.com/flyingrobots/colorful-language/issues/145).
  *Status:* implemented.
- **CONSUMER-9a** — *Requirement:* CONSUMER-9. *Behavior:* real witness
  processes reject mismatched source, invalid JSON, wrong hashes, illegal axes,
  fractional/out-of-range offsets, and missing fields with no canonical output.
  *Oracle:* nonzero status, exact stable error category, and empty canonical
  output for every fixture. *Evidence type:* process-level negative matrix.
  *Evidence:* `scripts/ir-witness.sh` and `witness/process-negative.mjs`.
  *Tracking:*
  [#148](https://github.com/flyingrobots/colorful-language/issues/148).
  *Status:* implemented.
- **CONSUMER-10a** — *Requirement:* CONSUMER-10. *Behavior:* a non-Rust
  consumer validates source identity/schema/vocabulary/version, renders a useful
  artifact, rejects an incompatible version, and migrates across two released
  contract generations before repeating the job with CLI text and LSP tokens.
  *Oracle:*
  exact rejection/rendering/migration results plus a reviewed integration-effort
  ledger; the contract is simplified rather than expanded if it does not reduce
  downstream cost. *Evidence type:* independent executable consumer and
  measured migration report. *Evidence:*
  `consumers/independent-ir-report/`,
  `consumers/independent-ir-report/evidence/integration-effort.json`,
  `scripts/version-compat-matrix.sh`, and
  `scripts/check-independent-consumer.sh`. *Tracking:*
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).
  *Status:* implemented.

## Open verification gaps

- End-to-end jedit UI assertions belong in the jedit repository because jedit is
  the runtime host.
- Graft package API compatibility checks belong in the Graft repository; this
  repository keeps only the reference consumer witness.
- The independent proof retains stable v1 because the IR uniquely verifies five
  identities within its reviewed two-times adapter-size bound. The remaining
  risk is implementation cost: its 239-line adapter is nearly as large as the
  264-line LSP protocol and decoding adapter, so contract expansion stays
  frozen while
  [#222](https://github.com/flyingrobots/colorful-language/issues/222)
  simplifies consumer admission.
