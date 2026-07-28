# Independent IR report consumer

This zero-dependency Node package is an executable proof that a consumer
outside the Rust workspace can admit `colorful.syntax/v1` artifacts and render
a deterministic Markdown role-span report.

It validates the selected release profile, contract version, schema hash,
vocabulary hash, source byte length, source digest, required document shape,
token axes, and UTF-8 ranges before rendering. Invalid input exits with status
1, writes a stable error category to stderr, and leaves stdout empty.

## Run the proof

Use the repository's pinned Node version:

```bash
mise exec node@22.23.1 -- npm ci
mise exec node@22.23.1 -- npm run check
```

Run the isolated-copy witness from the repository root:

```bash
bash scripts/check-independent-consumer.sh
```

The witness copies only this package to a temporary directory, rejects
workspace and build artifacts, installs from the lockfile, and runs the full
test and measurement gate.

## Evidence

The checked-in profiles and artifacts come from the immutable `v0.2.1` and
`v0.3.0` release tags. Both releases identify their wire contract as
`colorful.syntax/v1`; they are two real contract generations rather than an
invented v2 migration. The consumer normalizes the additive `openClassKind`
generation boundary into one role-span model.

For the v0.3.0 source, the IR, ANSI, and LSP adapters render byte-identical
reports. The generated
[`integration-effort.json`](evidence/integration-effort.json) records the
reviewed comparison:

| Adapter | Nonblank adapter lines | Stable failures | Verified identities |
| --- | ---: | ---: | ---: |
| IR | 284 | 9 | 5 |
| ANSI | 49 | 4 | 1 |
| LSP | 264 | 5 | 2 |

The LSP count includes its JSON-RPC acquisition client; the CLI-backed IR and
ANSI paths share the same trivial process boundary. The IR adapter is smaller
than the alternatives' combined 313 lines and uniquely verifies the contract,
schema, vocabulary, source length, and source digest. The resulting decision is
to retain stable v1, simplify consumer admission cost where possible, make the
currently hash-selected generation policy explicit in
[#221](https://github.com/flyingrobots/colorful-language/issues/221), generate
shared portable admission through
[#222](https://github.com/flyingrobots/colorful-language/issues/222), and avoid
adding contract fields without new evidence.

Refresh the tagged fixtures only by building the real releases:

```bash
mise exec node@22.23.1 -- \
  bash scripts/version-compat-matrix.sh --update-fixtures
```

See the [IR reference](../../docs/topics/ir/README.md), its
[architecture decision](../../docs/topics/ir/architecture.md#product-evidence-gate),
and the [executable test plan](../../docs/topics/ir/test-plan.md#cases).
