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

## Terminal output (`colorful` CLI)

`colorful <file>` (or stdin) renders each token with an ANSI color: function
words bold magenta (the "keywords"), proper nouns bold yellow, nouns blue, verbs
red, adjectives yellow, adverbs magenta, numbers cyan, quotes green, punctuation
dim; unlisted content words use the default foreground. Whitespace and gaps are
emitted verbatim, so stripping the escapes reproduces the input exactly.
`--no-color` and the `NO_COLOR` environment variable disable color and pass the
text through unchanged.

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

Incrementality is `v0`-simple: each request reparses the whole document. See
*Performance* below for what that costs in practice. A shipped editor theme
remains future work.

## Performance

Measured, not asserted: `cargo bench -p colorful-cli` and
`cargo bench -p colorful-lsp` (release-profile `criterion` benchmarks,
`crates/colorful-cli/benches/colorize_bench.rs` and
`crates/colorful-lsp/benches/semantic_tokens_bench.rs`) time the CLI's
`colorize()` path and the LSP's `compute_semantic_tokens()` function itself,
over two fixtures: the committed 899-byte `editor-smoke-prose.txt` sample,
and a 45 KB corpus built by repeating it 50×.

`compute_semantic_tokens()` is what answers one `textDocument/
semanticTokens/full` request — it is **not** the full `didChange` handler.
`did_change` (`crates/colorful-lsp/src/main.rs`) applies the edit to the
rope and calls `compute_diagnostics`, a separate reparse this benchmark does
not measure; `compute_semantic_tokens()` only runs when the editor
separately issues a semantic-tokens request, which is a second reparse of
the same `v0`-simple, whole-document kind. Both are real per-request costs
an editor pays around an edit, but they are two different requests, not one
combined "per-edit" number — `compute_diagnostics` has no benchmark yet,
recorded as an open gap below.

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

**Known gaps:**

- `compute_diagnostics` — what `did_change` actually calls — has no
  benchmark yet. Only `compute_semantic_tokens` (a separate request) is
  measured above.
- Memory is not yet benchmarked — no allocation or peak-RSS profiling
  exists today. Treat both as open gaps, not an implied "cheap" claim.

See the [test plan](test-plan.md) for the cases that pin this behavior.
