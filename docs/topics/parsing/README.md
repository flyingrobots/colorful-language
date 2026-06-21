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
  and hyphens (`don't`, `well-being`). Numbers (`150`, `3.14`, `1,000`) are also
  emitted as word nodes; the lexicon decides they are numeric.
- **Sentences.** A run of `.`/`!`/`?` ends a sentence (the terminator is the
  sentence's last child). Text with no terminator flushes as a single trailing
  sentence. A closing quote or bracket sitting *immediately* after the terminator
  is absorbed into the sentence (`"Hi."`), while one separated by a space starts
  the next sentence (an opening quote).
- **Quotes and punctuation.** Quotation marks and other punctuation become
  `Punct` nodes.
- **Whitespace.** ASCII and common Unicode spaces (NBSP, thin space, ideographic
  space, …) separate tokens and are skipped, not emitted as nodes.
- **Totality.** Parsing never panics. Any character the lexer cannot otherwise
  classify (an emoji, a stray symbol) becomes a `Punct` node, so no input is
  rejected and no bytes are dropped.

## Invariants

- Leaf spans are non-empty, in bounds, on `char` boundaries, and strictly
  ordered with no overlaps.
- Whitespace is not represented by nodes; it is the gap between spans.

## Known limitations (v0)

- Structure is shallow: no clause nesting, no parenthetical grouping.
- In debug builds, `logos` recurses once per character, so a single token tens
  of thousands of characters long can exhaust a small stack. Release builds
  (the shipped binaries) lower the lexer to a loop and are unaffected.

See the [test plan](test-plan.md) for the cases that pin this behavior.
