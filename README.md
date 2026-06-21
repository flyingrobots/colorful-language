# colorful-language

> IDE-grade structural and part-of-speech coloring for **English prose** — a
> pure-Rust parser plus a Language Server, so your editor treats a paragraph
> the way it treats a function.

`colorful-language` points the kind of tooling we take for granted in code —
live syntax highlighting, structural navigation, lint-as-you-type — at natural
English. Open a `.txt`, an essay draft, or a design doc and watch the grammar
light up: function words as keywords, proper nouns as types, quotes as strings,
the skeleton of every sentence made visible.

> **Status:** pre-release. **Goalpost 0 — "English lights up"** is delivered
> (closed-class + structural coloring via a CLI and an LSP). See
> [`ROADMAP.md`](ROADMAP.md).

## Why this is tractable (the one insight)

Most attempts to "parse English" reach for statistical or neural NLP because
they want *correct, deep* parses. We want something different and much cheaper:
**fast, local, error-tolerant, good-enough structure** — exactly the contract an
editor wants.

The wedge is that **English's closed-class words form a finite, enumerable
list** — articles, prepositions, conjunctions, pronouns, auxiliaries,
determiners. A few hundred words. Those behave much like programming-language
keywords: a fixed, enumerable set forming the skeleton of every sentence. (They
are not perfectly unambiguous — `that` and `for` wear several hats — so `v0` is
honestly *closed-class lexical highlighting*, not contextual POS tagging.) So the
first version needs no machine learning at all — it lexes the keywords, marks
structure (sentences, quotes, numbers, proper-noun heuristics), and colors the
rest as undifferentiated "content." Telling a noun from a verb is a *later*
escalation, not a prerequisite.

## Architecture

A Rust [hexagon](https://en.wikipedia.org/wiki/Hexagonal_architecture_%28software%29).
The domain core is pure and tiny; everything that touches the outside world is
an adapter behind a port. The three load-bearing ports:

- **`Parser`** — text → a structural tree (sentences, word/punct spans). Knows
  nothing about meaning.
- **`Lexicon`** — a single word, *in isolation*, → a part-of-speech class. The
  context-free dictionary (a closed-class set today, a richer one later).
- **`Annotator`** — a parsed tree → a classified token stream, *with context*.
  The *swappable* one: today a `LexicalAnnotator` over the lexicon plus shallow
  heuristics; later a contextual or ML annotator that tells noun from verb,
  **without touching the parser or the server.**

The seam between *structure*, context-free *lookup*, and context-aware
*classification* is the whole design — it is what lets every future ambition (a
prose linter, noun/verb disambiguation, an "English-as-code" interpreter) arrive
as "add an adapter behind a port" rather than "rewrite the core."

Delivery is **LSP-first**: a single local language server emits
[semantic tokens](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_semanticTokens),
which lands coloring in nearly every modern editor (VS Code, Neovim, Helix, Zed,
Emacs, JetBrains) at once. A CLI renders the same classification as ANSI color in
your terminal for instant gratification with no editor setup.

The only TypeScript in this stack is the word "TypeScript."

## Workspace

| Crate | Job |
| --- | --- |
| `colorful-core` | Domain types + the `Parser` / `Lexicon` / `Annotator` port traits. Zero I/O. |
| `colorful-parse` | `Parser` adapter: a `logos` lexer + sentence segmenter over prose structure. |
| `colorful-lexicon` | `Lexicon` adapter: the compile-time closed-class function-word set. |
| `colorful-cli` | Colorize a file to ANSI in the terminal. |
| `colorful-lsp` | A `ropey`-backed document mirror and a semantic-tokens server. |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: documentation is
part of the contract, current references describe only what is true on `main`,
and behavior is proven by deterministic, executable evidence.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
