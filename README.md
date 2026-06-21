# colorful-language

> IDE-grade structural and part-of-speech coloring for **English prose** — a
> pure-Rust parser plus a Language Server, so your editor treats a paragraph
> the way it treats a function.

`colorful-language` points the kind of tooling we take for granted in code —
live syntax highlighting, structural navigation, lint-as-you-type — at natural
English. Open a `.txt`, an essay draft, or a design doc and watch the grammar
light up: function words as keywords, proper nouns as types, quotes as strings,
the skeleton of every sentence made visible.

<div align="center"><img width="739" height="817" alt="Screenshot 2026-06-21 at 12 20 52" src="https://github.com/user-attachments/assets/ed433423-aa53-4da1-98fc-148b26213fa1" /></div>

> **Status:** pre-release. Building toward **Goalpost 0 — "English lights up"**
> (closed-class + structural coloring via a CLI and an LSP). See
> [`ROADMAP.md`](ROADMAP.md).

## Why this is tractable (the one insight)

Most attempts to "parse English" reach for statistical or neural NLP because
they want *correct, deep* parses. We want something different and much cheaper:
**fast, local, error-tolerant, good-enough structure** — exactly the contract an
editor wants.

The wedge is that **English's closed-class words form a finite, enumerable
list** — articles, prepositions, conjunctions, pronouns, auxiliaries,
determiners. Roughly 150 words. Those behave *exactly* like programming-language
keywords: fixed lexemes, unambiguous, the skeleton of every sentence. So the
first version needs no machine learning at all — it lexes the keywords, marks
structure (sentences, quotes, numbers, proper-noun heuristics), and colors the
rest as undifferentiated "content." Telling a noun from a verb is a *later*
escalation, not a prerequisite.

## Architecture

A Rust [hexagon](https://en.wikipedia.org/wiki/Hexagonal_architecture_%28software%29).
The domain core is pure and tiny; everything that touches the outside world is
an adapter behind a port. The two load-bearing ports:

- **`Parser`** — text → a structural tree (sentences, clauses, word/punct
  spans). Knows nothing about meaning.
- **`Tagger`** — a word span → a part-of-speech class. The *swappable* one:
  a compile-time closed-class set today, a real lexicon or an ML model later,
  **without touching the parser or the server.**

The seam between *structure* and *classification* is the whole design — it is
what lets every future ambition (a prose linter, noun/verb disambiguation, an
"English-as-code" interpreter) arrive as "add an adapter behind a port" rather
than "rewrite the core."

Delivery is **LSP-first**: a single local language server emits
[semantic tokens](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_semanticTokens),
which lands coloring in nearly every modern editor (VS Code, Neovim, Helix, Zed,
Emacs, JetBrains) at once. A CLI renders the same classification as ANSI color in
your terminal for instant gratification with no editor setup.

The only TypeScript in this stack is the word "TypeScript."

## Workspace (planned)

| Crate | Job |
| --- | --- |
| `colorful-core` | Domain types + the `Parser` / `Tagger` port traits. Zero I/O. |
| `colorful-parse` | `Parser` adapter: a `logos` lexer + recursive descent over prose structure. |
| `colorful-lexicon` | `Tagger` adapter: the compile-time closed-class function-word set. |
| `colorful-cli` | Colorize a file to ANSI in the terminal. |
| `colorful-lsp` | A `ropey`-backed document mirror and a semantic-tokens server. |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: documentation is
part of the contract, current references describe only what is true on `main`,
and behavior is proven by deterministic, executable evidence.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

---

<div align="center"><h4>Made by <a href="https://github.com/flyingrobots">FLYING ROBOTS</a></h4></div>
