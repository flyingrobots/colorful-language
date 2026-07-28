# Coloring

Coloring is the end-to-end path from text to colored output. It has three parts:
a shared classification service, a terminal renderer (CLI), and a language
server (LSP). The structural parser and the lexicon feed all of it.

## Classification (`ContextualOpenClassAnnotator`)

The `Annotator` port produces the classified `Vec<Token>` for a parsed tree. The
default `ContextualOpenClassAnnotator::annotate(source, tree)` walks the tree in
source order and assigns each leaf a `PosClass`:

- **Words** are first classified by `LexicalAnnotator<SeedOpenClassLexicon>`.
  The seed lexicon maps representative unambiguous content words to
  `Open(Noun)`, `Open(Verb)`, `Open(Adjective)`, or `Open(Adverb)`. The
  proper-noun heuristic then upgrades a capitalized `Content` or `Open(_)` word
  to `ProperNoun` *only* when it is not the first word of its sentence or line,
  and the line is not a title-case run. Sentence- or line-initial words keep the
  class returned by the seed lexicon. After that shared lexical pass, the
  contextual adapter refines only remaining `Content` tokens from a small
  ambiguous set such as `book` and `fast` when local context is strong.
- **Punctuation** is classified structurally: quotation marks become `Quote`, all
  other punctuation becomes `Punctuation`.

This is the single source of truth both front ends consume.

Before either front end interprets spans, it constructs
`colorful_core::ValidatedClassification`. This pure boundary verifies the
public tree shape; reversed, out-of-bounds, and mid-code-point spans; sibling
and token ordering/non-overlap; child containment; and one-to-one tree-leaf /
token correspondence. It returns the first deterministic, path-addressed
`ClassificationError` instead of letting malformed custom adapter output reach
string slicing or position arithmetic.

## Terminal output (`colorful` CLI)

File and stdin input must be valid UTF-8. Every single-document command
(`colorful`, `ir`, `diagnose`, `lint`) reads through `std::fs::read_to_string`
(or the stdin equivalent), which rejects malformed input outright — a file
containing invalid UTF-8 bytes exits non-zero with
`stream did not contain valid UTF-8` on stderr, never a silent lossy
conversion into corrupted-but-readable text. Non-UTF-8 encodings are not
supported; that would need explicit detection and transcoding, not a change
to this behavior.

`colorful <file>` (or stdin) renders each token with an ANSI color: function
words bold magenta (the "keywords"), proper nouns bold yellow, nouns blue, verbs
red, adjectives yellow, adverbs magenta, numbers cyan, quotes green, punctuation
dim; unlisted content words use the default foreground. Whitespace and gaps are
emitted verbatim, so stripping the escapes reproduces the input exactly.
`--no-color` and the `NO_COLOR` environment variable disable color and pass the
text through unchanged.

The binary uses the fallible `try_colorize()` entry point and reports an invalid
built-in classification as input-data failure. The compatibility `colorize()`
function keeps its existing total signature and fails closed to unchanged text
if that internal invariant ever regresses.

`colorful diagnose --json <file>` emits a compact machine-readable report for
troubleshooting CLI and editor output. The report uses the same production parser
and annotator as `colorful`, `colorful ir`, and `colorful-lsp`, then decodes each
token into:

- the source text and UTF-8 byte range;
- `tokenKind`, `lexicalClass`, `functionKind`, and `openClassKind`;
- the vocabulary-backed `visualRole`;
- the ANSI projection used by the terminal;
- the graft class;
- the LSP semantic token type and legend index.

Use `colorful ir` for the stable downstream consumer contract. Use
`colorful diagnose --json` when checking whether a terminal, Zed, jedit, or
another editor is rendering the classes Colorful actually produced.

The committed smoke fixture
[`crates/colorful-cli/fixtures/editor-smoke-prose.txt`](../../../crates/colorful-cli/fixtures/editor-smoke-prose.txt)
contains README-style prose plus deterministic noun, verb, adjective, adverb,
proper noun, quote, number, and punctuation probes for cross-editor comparison.

## Editor output (`colorful-lsp`)

The server keeps a `ropey` mirror of each open document, applies incremental
`didChange` edits (UTF-16 columns, clamped against malformed positions), and
answers `textDocument/semanticTokens/full` with delta-encoded tokens.

The default path is still a **skeleton** highlighter: it accentuates structure
and deterministic open-class decisions while leaving unlisted ordinary content
unstyled, so a paragraph is not flooded with color. The legend maps `PosClass`
onto semantic token types through the shared vocabulary manifest:

| `PosClass` | token type |
| --- | --- |
| `Function(_)` | `keyword` |
| `ProperNoun` | `class` |
| `Number` | `number` |
| `Quote` | `string` |
| `Content` | *(unstyled)* |
| `Open(Noun)` | `noun` |
| `Open(Verb)` | `verb` |
| `Open(Adjective)` | `adjective` |
| `Open(Adverb)` | `adverb` |
| `Punctuation` | *(unstyled)* |

The default CLI/LSP use `ContextualOpenClassAnnotator`, so open-class rows appear
for the small seed table and the supported contextual patterns. Unknown content
remains `Content` and is still unstyled.

Each open document has a rope mirror, client version, monotonic server
generation, cancellation handle, and cached analysis. Opening a document starts
analysis immediately. Incremental edits update the rope, cancel pending work,
advance the generation, and debounce replacement analysis for 50 ms. The server
clones a rope snapshot while it holds the document entry, then converts and
analyzes that snapshot on the blocking pool after releasing the map guard.

Analysis remains whole-document, but it runs once per accepted generation:
parsing and classification produce one cached value that supplies both
diagnostics and semantic tokens. A semantic-token request waits for that
generation's cache and returns the generation as its `resultId`; it does not
start a second parse. A per-document publication gate and generation/cancellation
check prevent late old work from replacing the cache or publishing diagnostics.
If parser/annotator validation fails, the server emits no semantic tokens and
publishes one error diagnostic with code
`colorful/invalid-classification`; it never publishes a valid-looking prefix.

Normal analysis accepts documents through 5 MiB (5,242,880 bytes). A larger
document bypasses parsing and classification, returns no semantic tokens, and
publishes one warning with code `colorful/document-too-large`. The supported
envelope is one open document through 5 MiB, a burst of four versioned edits,
and no more than four simultaneous full-token requests. A shipped editor theme
remains future work.

The custom `colorful/metrics` JSON-RPC request accepts `null` parameters and
returns the versioned `colorful.lsp.metrics/v1` counters used by the overload
harness: the analysis limit, active-document count, computations and accepted
results, pre-compute cancellations, stale and oversized results, analysis
failures, and maximum analysis queue delay. These metrics distinguish overload
and stale work from `colorful/invalid-classification`,
`colorful/analysis-failed`, and the stable `colorful/document-too-large` limit
diagnostic.

## Deterministic boundary corpus

The blocking Rust gate explicitly runs a 256-case property corpus from one
reviewed 32-byte seed. Generated valid-Unicode documents contain astral code
points, combining marks, zero-width characters, and all supported line-ending
forms. The corpus requires built-in parser/annotator output to cross
`ValidatedClassification`, successful IR projection to pass
`validate_document`, canonical JSON to round-trip byte-for-byte, and each
declarative malformed tree or IR mutation to fail with its selected typed code
and path.

For an equivalent generated finding, the corpus independently counts both
human-facing Unicode-scalar columns and LSP UTF-16 code units. It then requires
the CLI report and LSP diagnostic to identify the same finding start under
their documented 1-based and 0-based coordinate conventions, and requires the
LSP range end to map back to the selected byte-span end. Four separate parser,
annotator, IR-projection, and coordinate fuzz targets are available for manual
time-based investigation; CI never substitutes a timing budget for the seeded
correctness oracle.

## Performance

Measured, not asserted: `cargo bench -p colorful-cli` and
`cargo bench -p colorful-lsp` (release-profile `criterion` benchmarks,
`crates/colorful-cli/benches/colorize_bench.rs` and
`crates/colorful-lsp/benches/semantic_tokens_bench.rs`) time the CLI's
`colorize()` path and the LSP's `compute_semantic_tokens()` function itself,
over two fixtures: the committed 899-byte `editor-smoke-prose.txt` sample,
and a 45 KB corpus built by repeating it 50×.

`compute_semantic_tokens()` is a transport-free standalone helper; the
production server now calls `analyze_document()` after an open or debounced
edit and caches both output surfaces from that one parse/classification.
Therefore this benchmark measures only the semantic-token projection helper,
not the full `didChange` path, debounce/queue delay, lint analysis, diagnostic
projection, cache coordination, or JSON-RPC transport.

**2026-07-23, `rustc 1.96.0`, Apple M1 Pro, 16 GB RAM, macOS (Darwin 25.3.0),
release profile (`cargo bench`), median of 100 samples:**

| Path | 899 B (small) | 45 KB (medium) |
| --- | --- | --- |
| CLI `colorize()` | ~21 µs | ~1.04 ms |
| LSP `compute_semantic_tokens()` | ~25 µs | ~1.24 ms |

**Budget:** under 16 ms (one 60 Hz frame) for documents up to ~50 KB, on
comparable hardware — chosen as a product-relevant "feels instant" ceiling,
not a multiple of today's number; today's measurements sit roughly 13–15×
under it for both benchmarked functions. This budget is **not yet a CI
gate**: a single machine's first measurement isn't a stable baseline to
enforce against, and turning it into a hard failure before establishing one
would just make CI flaky on noisy hardware. Re-run the benchmarks and
update this table when the hot path changes meaningfully.

### Cross-stage comparison

The cross-stage release harness uses those same two corpora to separate parsing,
contextual annotation, mandatory classification validation, lint analysis,
guarded IR projection, canonical serialization, and fail-closed IR validation.
It measures nine timing samples per stage/corpus pair on the normal system
allocator, invokes a separate instrumented process for one allocation sample,
then emits a versioned JSON report. Allocation count includes allocator
allocation and reallocation calls; allocated bytes include fresh allocation
bytes plus positive net reallocation growth:

```bash
cargo run --locked --release -p colorful-cli \
  --example cross_stage_benchmark > /tmp/colorful-cross-stage.json
```

macOS and Linux supply automatic date, processor, architecture, operating
system, and memory probes. On another host, set
`COLORFUL_BENCHMARK_GENERATED_AT` (`YYYY-MM-DDTHH:MM:SSZ`),
`COLORFUL_BENCHMARK_PROCESSOR`, `COLORFUL_BENCHMARK_ARCHITECTURE`,
`COLORFUL_BENCHMARK_OPERATING_SYSTEM`, and
`COLORFUL_BENCHMARK_TOTAL_MEMORY_BYTES` before running the same command. Empty
or missing overrides are rejected instead of producing incomplete metadata.

Run it from a clean worktree so the report can bind itself to the exact source
commit. Review the temporary report before updating
[`cross-stage-baseline.json`](../../../crates/colorful-cli/benchmarks/cross-stage-baseline.json).

**2026-07-28, source `7067cb6da5eebf8f6fd79008cf9842c8da134f9d`,
`rustc 1.97.1`, Node 22.23.1, `stats_alloc 0.1.10`, Apple M1 Pro,
16 GiB RAM, macOS Darwin 25.3.0 arm64, release profile:**

| Stage | 899 B median | 899 B allocations | 45 KB median | 45 KB throughput | 45 KB allocations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Parsing | 5.3 µs | 43 / 17.8 KiB | 248 µs | 181.1 MB/s | 2,009 / 915.8 KiB |
| Contextual annotation | 15.0 µs | 136 / 12.7 KiB | 595 µs | 75.7 MB/s | 6,463 / 807.0 KiB |
| Classification validation | 28.2 µs | 753 / 75.0 KiB | 1.06 ms | 42.3 MB/s | 37,215 / 3.94 MiB |
| Lint analysis | 7.5 µs | 144 / 9.4 KiB | 294 µs | 152.9 MB/s | 7,059 / 485.6 KiB |
| Guarded IR projection | 84.0 µs | 1,063 / 75.3 KiB | 1.96 ms | 22.9 MB/s | 49,172 / 3.20 MiB |
| Canonical IR serialization | 170 µs | 2,342 / 330.7 KiB | 8.37 ms | 5.4 MB/s | 114,264 / 16.87 MiB |
| Fail-closed IR validation | 59.8 µs | 1,009 / 59.2 KiB | 1.77 ms | 25.4 MB/s | 48,414 / 2.60 MiB |
| Graft projection | 656 µs | unavailable | 7.63 ms | 5.9 MB/s | unavailable |

Guarded IR projection uses the public `from_validated_classification()` boundary,
so its number includes the mandatory successful-document validation
postcondition. The separate validation row measures `validate_document()` over
already prepared IR. Canonical serialization is the largest measured 45-KB
stage; this baseline makes that cost visible without prematurely prescribing an
optimization.

The reviewed regression policy calls for investigation when median latency
changes by more than 25% or allocation count/bytes by more than 10% on a
comparable host and toolchain. It is deliberately advisory: correctness CI
checks corpus hashes, measurement arithmetic, matrix completeness, and policy
metadata, but never reruns or fails on wall-clock timing. Throughput is
source-equivalent UTF-8 bytes per second for every row, so the stages remain
comparable even when the prepared IR is larger than its source. Semantic-token
generation remains owned by the COL-12a Criterion bench, incremental editing
and concurrency by the COL-16a LSP envelope, and Graft projection by the
complete fixed-corpus `project()` evidence in
`consumers/graft-projection.benchmark.mjs`; the matrix invokes that authority
rather than cloning it.

### Supported LSP envelope

The process-level workflow builds the real release server, then the harness
drives it at exact 100 KiB, 1 MiB, 5 MiB, and 10 MiB sizes. For each size it
measures open through diagnostics, cached semantic tokens, one single-character
replacement through diagnostics and tokens, then four rapid replacements
observed by four concurrent full-token requests. It records peak server RSS
through `/usr/bin/time`, queue delay and stale/cancellation counters through
`colorful/metrics`, corpus hashes, process status, and exact host/toolchain
identity.

```bash
mise x node@22.23.1 -- cargo build --locked --release \
  -p colorful-lsp --bin colorful-lsp
mise x node@22.23.1 -- cargo run --locked --release \
  -p colorful-lsp --example lsp_envelope \
  > /tmp/colorful-lsp-envelope.json
```

The reviewed SLO supports one document through 5 MiB with four simultaneous
full-token requests: open or one edit must reach latest diagnostics within
5 seconds, cached tokens within 2 seconds, and the rapid-edit/concurrent-request
burst within 8 seconds; queue delay must remain below 250 ms and server RSS
below 1,536 MiB. A 10 MiB document is deliberately outside the envelope: it
must return `colorful/document-too-large` and empty tokens within 1 second,
below 512 MiB RSS. The checked-in baseline is one reviewed run per scenario on
Darwin/aarch64, not a cross-platform variance study.

**2026-07-28, `rustc 1.97.1`, Node 22.23.1, Apple M1 Pro, 16 GiB RAM, macOS
26.3 arm64, release profile:**

| Size | Outcome | Open diagnostics | Edit diagnostics | Cached tokens | Four-request burst | Peak RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 100 KiB | analyzed | 5.6 ms | 58.6 ms | 0.7 ms | 59.2 ms | 9.5 MiB |
| 1 MiB | analyzed | 49.3 ms | 100.9 ms | 5.0 ms | 113.9 ms | 65.7 MiB |
| 5 MiB | analyzed | 266.9 ms | 288.7 ms | 25.6 ms | 354.0 ms | 331.1 MiB |
| 10 MiB | document too large | 20.8 ms | 59.6 ms | 0.1 ms | 79.5 ms | 111.6 MiB |

Every scenario met its predeclared SLO, returned process status zero, and
ended on diagnostic version 6 without regressing to an older publication. The
accepted sizes recorded three cancelled debounced generations, zero stale
results, zero stale publications, and approximately 2.5–6.3 ms maximum queue
delay. The exact machine-readable evidence, including all four response timings
and corpus SHA-256 values, is
[`lsp-envelope-baseline.json`](../../../crates/colorful-lsp/benchmarks/lsp-envelope-baseline.json).
The report contract is checked in deterministic CI, but the wall-clock
benchmark is not rerun or used as a noisy correctness gate.

**Known gaps:**

- The cross-stage baseline attributes allocations to the six synchronous Rust
  stage boundaries, while peak server RSS remains the process-level memory
  oracle for scheduling, caching, transport, and concurrent requests. Node does
  not expose an allocator-event oracle comparable to `stats_alloc`, so the
  JavaScript Graft authority explicitly reports allocation attribution as
  unavailable rather than substituting noisy heap deltas.
- The supported envelope covers one open document and four concurrent token
  requests on Darwin/Linux hosts with `/usr/bin/time`; it does not claim
  multi-document capacity, editor-adapter latency, or networked transport.

See the [test plan](test-plan.md) for the cases that pin this behavior.
