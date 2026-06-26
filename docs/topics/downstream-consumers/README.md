# Downstream consumers

Downstream consumers are tools that use Colorful's structured output without
linking to Colorful internals. The current contract is the `colorful` CLI and the
`colorful.syntax/v1` IR, not a Rust library API.

## Current behavior

`colorful ir [FILE]` emits canonical JSON for `colorful.syntax/v1`. Consumers
read that artifact, verify the source and vocabulary identity, and project it
into their own UI or data model.

The repository includes a Graft reference consumer in
[`consumers/graft-projection.mjs`](../../../consumers/graft-projection.mjs). It
does three important things:

- verifies the IR `contentHash` against the raw UTF-8 source bytes;
- verifies `vocabularyHash` against the checked-in vocabulary manifest;
- converts UTF-8 byte ranges into row/column spans for Graft syntax classes.

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
