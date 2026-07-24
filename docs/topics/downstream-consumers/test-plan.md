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
  (`E_BYTE_RANGE_BOUNDARY`); zero-width tokens are allowed, matching
  `colorful_ir::validate_document`'s own `start <= end` check; out-of-order or
  overlapping tokens (`E_TOKEN_ORDER`) are rejected, never sorted into
  validity. *Oracle:* JavaScript assertions on `err.code`. *Evidence type:*
  unit test. *Evidence:* `consumers/graft-projection.test.mjs`. *Status:*
  implemented.
- **CONSUMER-6c** — *Requirement:* CONSUMER-6. *Behavior:* duplicate
  `occurrenceId`s (`E_DUPLICATE_OCCURRENCE_ID`) and illegal token axis
  combinations (`E_TOKEN_AXES`, mirroring `colorful_ir`'s
  `token_axes_violation` exactly) are rejected. *Oracle:* JavaScript
  assertions on `err.code`. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
- **CONSUMER-6d** — *Requirement:* CONSUMER-6. *Behavior:* the structure graph
  is checked for duplicate node ids (`E_DUPLICATE_NODE_ID`) and dangling child
  references (`E_DANGLING_CHILD_REF`) — the same scope as
  `colorful_ir::validate_document`, no more: range containment and cycles are
  deliberately not checked, on either side. *Oracle:* JavaScript assertions
  on `err.code`. *Evidence type:* unit test. *Evidence:*
  `consumers/graft-projection.test.mjs`. *Status:* implemented.
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

## Open verification gaps

- End-to-end jedit UI assertions belong in the jedit repository because jedit is
  the runtime host.
- Graft package API compatibility checks belong in the Graft repository; this
  repository keeps only the reference consumer witness.
