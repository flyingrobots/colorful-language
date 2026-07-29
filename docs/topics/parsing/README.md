# Parsing

The `Parser` port turns source text into shallow prose structure. The
implementation is `colorful_parse::ProseParser` (a `logos` lexer plus a sentence
segmenter — not a deep recursive-descent grammar). It produces *structure only*
and makes no part-of-speech decisions — that is the
[lexicon](../lexicon/README.md)'s job.

## Current behavior

`parse(text) -> Tree` returns a `Node::Document` of `Node::Sentence`s. Each
sentence holds `Node::Word` and `Node::Punct` children, and every node carries a
`Span` of byte offsets into the source.

- **Words.** A word is a run of Unicode letters, allowing internal apostrophes
  and hyphens (`don't`, `well-being`), and — once the word starts with a
  letter — internal digits too (`covid19`, `H2O` are each one word). A token
  that starts with a digit is a number instead (`3.5`), never a word. Numbers
  are also emitted as word nodes; the lexicon decides they are numeric.
  Parser and lexicon share the allocation-free grammar `N+([.,]N+)*`, where
  `N` is any Unicode numeric character. This accepts `150`, `3.14`, `1,000`,
  `1.234,56`, and Unicode numerics such as `٣.١٤`. Every separator must have
  numeric characters on both sides: `1..2` becomes `1`, `..`, `2`, while `.5`
  becomes `.`, `5`. The shared scanner—not the Unicode tables compiled into
  the lexer—decides whether a numeric token starts.
- **Sentences.** A run of `.`/`!`/`?` ends a sentence (the terminator is the
  sentence's last child). Text with no terminator flushes as a single trailing
  sentence. A closing quote or bracket sitting *immediately* after the terminator
  is absorbed into the sentence (`"Hi."`), while one separated by a space starts
  the next sentence (an opening quote).
- **Quotes and punctuation.** Quotation marks and other punctuation become
  `Punct` nodes.
- **Whitespace.** ASCII and common Unicode spaces (NBSP, thin space, ideographic
  space, …) separate tokens and are skipped, not emitted as nodes.
- **Totality (release builds).** Parsing never panics or crashes on any input
  — including pathologically long single tokens. Any character the lexer
  cannot otherwise classify (an emoji, a stray symbol) becomes a `Punct` node,
  so no input is rejected and no bytes are dropped. In a **debug** build, an
  extremely long single token can instead exhaust the thread's stack (see
  *Known limitations* below); the shipped release binaries do not have this
  limitation, so this is the guarantee that actually holds for them.

## Markdown prose view

`colorful_parse::markdown::mask_non_prose` is a format adapter, not a second
prose grammar. It uses CommonMark structure to replace fenced and indented code
blocks, inline code, opening YAML/TOML front matter, HTML blocks, inline HTML
markup, link destinations, and full or collapsed reference identifiers with a
coordinate-equivalent mask before the existing `ProseParser` runs. Duplicate
reference definitions and destinations with quoted titles follow the same
parser-admitted boundary. Link labels, shortcut-reference labels, and ordinary
Markdown text remain analyzable. An unmatched inline-code or front-matter
opener does not suppress the rest of the document.

Every replacement preserves the original byte length, `LF`/`CRLF`/bare-`CR`
line endings, and UTF-16 length before retained prose. ASCII, two-byte BMP,
three-byte BMP, and astral scalars each receive a representation with the same
byte and UTF-16 width. Inline exclusions become whitespace. Block exclusions
retain one unstyled sentence separator so findings and contextual
classification cannot cross code, metadata, HTML, or reference-definition
blocks. This lets CLI findings and LSP diagnostics or semantic tokens project
their spans directly onto the unmodified source. The LSP verifies coordinate
compatibility again before projection and emits
`colorful/invalid-source-view` instead of projecting an incompatible view.
Plain prose returns as a borrowed string without allocation.

The Markdown module and its `pulldown-cmark` dependency are behind
`colorful-parse`'s opt-in `markdown` feature. The CLI and LSP adapters enable
that feature explicitly; consumers using only `ProseParser` do not pull the
Markdown dependency into their default graph.

## Invariants

- Leaf spans are non-empty, in bounds, on `char` boundaries, and strictly
  ordered with no overlaps.
- Whitespace is not represented by nodes; it is the gap between spans.

One blocking property corpus drives 256 cases from a reviewed 32-byte seed.
Every generated source combines arbitrary valid Unicode with an astral scalar,
a combining sequence, a zero-width character, and `LF`, `CRLF`, and bare `CR`
line endings. The corpus validates the built-in parser and annotator, then
requires every gap to contain only the parser's explicitly skipped whitespace
before reconstructing the exact source from the ordered leaf spans and gaps.
Time-based parser and annotator fuzz targets use the same public boundaries but
remain manual evidence rather than a machine-dependent correctness gate.

## Known limitations (v0)

- Structure is shallow: no clause nesting, no parenthetical grouping.
- **Debug-build stack limit on a single giant token.** `logos` only lowers its
  lexer to a loop under optimizations; in an unoptimized (debug) build it
  recurses once per character instead, so one token tens of thousands of
  characters long can exhaust the thread's default stack and abort the
  process — not a catchable panic, a hard crash. Release builds (what ships)
  use the loop form and have no such limit. The test suite exercises a
  10,000-character single token from a dedicated thread with a 16 MiB stack
  specifically to give this case a fair, non-flaky run even in debug mode
  (see the test plan's giant-token strategy).

See the [test plan](test-plan.md) for the cases that pin this behavior.
