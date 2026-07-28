# Downstream consumers

Downstream consumers are tools that use Colorful's structured output without
linking to Colorful internals. The current contract is the `colorful` CLI and the
`colorful.syntax/v1` IR, not a Rust library API.

## Current behavior

`colorful ir [FILE]` emits canonical JSON for `colorful.syntax/v1`. Consumers
read that artifact, verify the source and vocabulary identity, and project it
into their own UI or data model.

The repository includes a Graft reference consumer in
[`consumers/graft-projection.mjs`](../../../consumers/graft-projection.mjs).
Before projecting anything, `validateArtifact(buffer, ir)` runs one ordered
admission gate over the received artifact — cheap structural checks first,
expensive hashes last — and rejects a malformed artifact with a stable
`GraftProjectionError.code` rather than repairing, clamping, or sorting it
into validity:

1. top-level shape (every field this consumer dereferences exists with the
   right primitive type);
2. `contractVersion` matches `colorful.syntax/v1`;
3. the declared `source.utf8ByteLength` matches the real byte length;
4. the source bytes are valid UTF-8;
5. each token's byte range is in order, in bounds, non-empty, and on a UTF-8
   character boundary;
6. tokens are ordered by start offset and do not overlap;
7. `occurrenceId`s are unique;
8. token axis combinations are legal (mirroring `colorful_ir`'s own
   `token_axes_violation`);
9. the outline's paragraph/sentence depths are valid; node ids are unique;
   child references resolve, have one parent, stay inside the parent range,
   and form an acyclic graph;
10. `diagnostics` and `derivation` are shape- and range-valid; `derivation` is
    non-empty, each step's `passId` and `ruleId` are non-empty, and `passId`
    (not `ruleId`) is unique across steps — mirroring
    `colorful_ir::validate_document`'s own derivation checks exactly, no more;
11. `schemaHash`, `vocabularyHash`, and `contentHash` each match this
    consumer's own contract copies, checked in that order.

Every enum-shaped field (`tokenKind`, `lexicalClass`, `functionKind`,
`openClassKind`, outline node `kind`) is checked against the actual wire
enum, not just "is a string", and every integer field is held to the real
`colorful.syntax/v1` wire range (signed `i32`), not merely "any JS safe
integer" — both as part of step 1's shape check.

Only once an artifact passes admission does `project()` convert UTF-8 byte
ranges into row/column spans for Graft syntax classes.

The informational release benchmark drives that complete fail-closed
`project()` boundary over the shared 899-byte and 45-KB committed corpora:

```bash
node consumers/graft-projection.benchmark.mjs
```

The cross-stage harness invokes this authority under the recorded Node
toolchain and publishes its median latency and source-byte throughput in
[`cross-stage-baseline.json`](../../../crates/colorful-cli/benchmarks/cross-stage-baseline.json).
Correctness CI checks the corpus identities and report arithmetic but does not
gate on wall-clock time. Node does not expose a precise allocator-event oracle
comparable to the Rust probe, so the report marks allocator attribution
unavailable instead of treating process heap deltas as allocation counts.

jedit receives Colorful prose structure through Graft. Graft discovers Colorful
by finding a `colorful` CLI on `PATH`, requiring `colorful --version` to report
`0.3.0` or newer, and running `colorful ir -` for `.txt` buffers.

The floor is `0.3.0`. `scripts/version-compat-matrix.sh` builds the real,
immutable `v0.2.1` and `v0.3.0` tags in isolated prefixes and proves why: the
`--version` flag did not exist at `v0.2.1` (it was added five commits later,
in `fix(cli): support downstream Colorful discovery`, and first ships in
`v0.3.0`), so a version-probing discovery mechanism cannot detect `v0.2.1` as
compatible — the probe itself fails against it. The matrix also confirms both
tags' `colorful ir` output remains a self-consistent `colorful.syntax/v1`
artifact for that era's own reference consumer, and that `openClassKind` is
absent from `v0.2.1`'s output and present in `v0.3.0`'s (an additive field, not
something an older consumer needs to specially handle).

The repository also includes
[`consumers/independent-ir-report`](../../../consumers/independent-ir-report/README.md),
a zero-dependency Node proof that does not link the Rust workspace. It validates
the contract, schema, vocabulary, raw-source UTF-8 validity, source length,
source digest, required shape, token axes, and UTF-8 ranges before rendering a
deterministic Markdown role-span report. Checked-in artifacts from the real
`v0.2.1` and `v0.3.0`
release tags prove migration across two released `colorful.syntax/v1`
generations, and the v0.3.0 IR, ANSI, and LSP adapters produce byte-identical
reports for the same Unicode source.

The executable burden ledger measures 424 nonblank IR adapter lines versus 49
for ANSI and 264 for LSP including its JSON-RPC acquisition client. The IR is
larger than the alternatives' combined 313 lines, but it alone verifies all
five wire identities and stays below the reviewed limit of twice their combined
size. The decision is therefore to retain stable v1, reduce admission cost
where possible, and keep new contract surface frozen until separate product
evidence justifies it.

For source-checkout development, install the CLI into a stable user directory:

```bash
scripts/install-local.sh
export PATH="$HOME/.colorful-language/bin:$PATH"
colorful --version
```

## Boundaries

Colorful owns the IR contract, vocabulary manifest, canonical JSON, and CLI
producer. Graft owns its projection adapter and jedit integration path. jedit
does not call Colorful directly in the current architecture.

This repository's `consumers/` code consists of reference consumers,
compatibility witnesses, and the independent proof package. None is the shipped
Graft package.

See the [test plan](test-plan.md) for the cases that pin this behavior.
