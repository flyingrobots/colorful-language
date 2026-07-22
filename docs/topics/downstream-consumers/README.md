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
5. each token's byte range is in order, in bounds, and on a UTF-8 character
   boundary (zero-width tokens are allowed);
6. tokens are in non-overlapping wire order — a graft-projection-specific
   requirement stricter than the general `colorful.syntax/v1` wire contract,
   which the monotonic cursor in `makeByteToPoint` relies on;
7. `occurrenceId`s are unique;
8. token axis combinations are legal (mirroring `colorful_ir`'s own
   `token_axes_violation`);
9. the outline's structure graph has no duplicate node ids and no dangling
   child references (the same scope `colorful_ir::validate_document` checks,
   no more);
10. `schemaHash`, `vocabularyHash`, and `contentHash` each match this
    consumer's own contract copies, checked in that order.

Only once an artifact passes admission does `project()` convert UTF-8 byte
ranges into row/column spans for Graft syntax classes.

jedit receives Colorful prose structure through Graft. Graft discovers Colorful
by finding a `colorful` CLI on `PATH`, requiring `colorful --version` to report
`0.2.1` or newer, and running `colorful ir -` for `.txt` buffers.

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

This repository's `consumers/` code is a reference consumer and compatibility
witness. It is not the shipped Graft package.

See the [test plan](test-plan.md) for the cases that pin this behavior.
