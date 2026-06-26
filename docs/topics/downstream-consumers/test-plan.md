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
  `0.2.1` or newer.

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
- **CONSUMER-4a** — *Requirement:* CONSUMER-4. *Behavior:* structural keyword,
  proper noun, number, quote, unstyled content, and open-class roles all derive
  their Graft class from the vocabulary manifest. *Oracle:* JavaScript
  assertions. *Evidence:* `consumers/graft-projection.test.mjs`. *Status:*
  implemented.
- **CONSUMER-5a** — *Requirement:* CONSUMER-5. *Behavior:* repository docs state
  the Graft/jedit CLI version floor as `0.2.1` or newer. *Oracle:* documentation
  review. *Evidence:* `README.md`; this topic. *Status:* implemented as docs;
  enforced in the downstream Graft repository.

## Open verification gaps

- End-to-end jedit UI assertions belong in the jedit repository because jedit is
  the runtime host.
- Graft package API compatibility checks belong in the Graft repository; this
  repository keeps only the reference consumer witness.
