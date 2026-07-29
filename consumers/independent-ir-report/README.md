# Independent IR report consumer

This zero-dependency Node package is an executable proof that a consumer
outside the Rust workspace can admit `colorful.syntax/v1` artifacts and render
a deterministic Markdown role-span report.

It validates the selected release profile, contract version, schema hash,
vocabulary hash, raw-source UTF-8 validity, source byte length, source digest,
required document shape, token axes, and UTF-8 ranges before rendering. Invalid
input exits with status 1, writes a stable error category to stderr, and leaves
stdout empty. Shape admission is exact: unknown fields are rejected at the
document root and in every nested contract record.
Profile admission also requires every classified visual role to have an
explicit rendering projection.
Unavailable or unreadable source, artifact, and profile paths fail as `E_IO`
without an uncaught Node stack trace.
Report cells escape Markdown table delimiters even when the source text or a
role name contains `|`.
Derivation admission mirrors the producer validator: at least one step,
non-empty `passId` and `ruleId`, and unique `passId` values.
The release label is provenance only. `compatibility.v1.json` selects wire
behavior from the complete contract-version, schema-hash, and vocabulary-hash
tuple. A profile-local field-shape switch, a renamed release label, or a
self-consistent but unregistered tuple cannot reinterpret the contract.

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
workspace and build artifacts, verifies the repository-level two-copy burden
ledger before isolation, installs the package from its lockfile, and runs the
standalone test gate without a repository escape.

## Evidence

The checked-in profiles and artifacts come from the immutable `v0.2.1` and
`v0.3.0` release tags. Both releases identify their wire contract as
`colorful.syntax/v1`; they are two real contract generations rather than an
invented v2 migration. The consumer normalizes the additive `openClassKind`
generation boundary into one role-span model. Its package-local
`compatibility.v1.json` is byte-identical to the canonical
`contracts/colorful/syntax-compatibility.v1.json` authority. That authority
also records the current normalized-schema-hash generation, every predecessor
edge, the wire-shape adapter decision, and migration evidence.

For the v0.3.0 source, the IR, ANSI, and LSP adapters render byte-identical
reports. The generated
[`integration-effort.json`](evidence/integration-effort.json) records the
reviewed comparison:

| Adapter | Nonblank adapter lines | Stable failures | Verified identities |
| --- | ---: | ---: | ---: |
| IR | 249 | 11 | 5 |
| ANSI | 49 | 4 | 1 |
| LSP | 305 | 5 | 2 |

The LSP count includes its JSON-RPC acquisition client; the CLI-backed IR and
ANSI paths share the same trivial process boundary. The IR adapter uniquely
verifies the contract, schema, vocabulary, source length, and source digest and
is now smaller than the alternatives' combined 354 lines. Its structural
admission is generated from the compatibility-selected SDL and reported
separately: 862 unique nonblank lines and 1,724 lines across the two
byte-identical committed copies. The generated total is not counted as authored
adapter improvement. Measurement reads both committed copies and refuses to
emit or update the ledger when either copy is missing or differs from the
package-local canonical bytes. Its 13 reviewed generator cases are registered
exactly once through the named executable inventory in
`scripts/syntax-admission-review-cases.mjs`; missing, extra, or duplicate
registrations fail before the suite runs, and the ledger derives the count from
that same inventory. The resulting decision is to retain stable v1, keep the
explicit generation policy delivered by
[#221](https://github.com/flyingrobots/colorful-language/issues/221), and avoid
adding contract fields without new evidence.
The executable decision records both policy branches explicitly: the IR may be
retained for its bounded correctness advantage or because it is the smallest
adapter. The checked-in result records which branch the current measurements
actually satisfy.
The LSP acquisition path bounds every response wait and the final child-process
exit; a non-terminating server is killed and fails deterministically.

Refresh the tagged fixtures only by building the real releases:

> [!WARNING]
> `--update-fixtures` rewrites checked-in golden evidence. Review the complete
> resulting Git diff before committing it.

```bash
mise exec node@22.23.1 -- \
  bash scripts/version-compat-matrix.sh --update-fixtures
```

See the [IR reference](../../docs/topics/ir/README.md), its
[architecture decision](../../docs/topics/ir/architecture.md#product-evidence-gate),
and the [executable test plan](../../docs/topics/ir/test-plan.md#cases).
