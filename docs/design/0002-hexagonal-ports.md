# ADR-0002: Hexagonal architecture and the Parser/Lexicon/Annotator seam

- Status: Accepted
- Date: 2026-06-21

## Context

The project is meant to grow far past v0: a prose linter, open-class
disambiguation, an English-as-code interpreter, controlled natural language, and
an LLM semantic tier. Each of those should be an addition, not a rewrite.

An earlier draft of this ADR proposed a single `Tagger` port that classified a
word *in isolation*. Review caught that this cannot deliver the promised
open-class disambiguation: telling `book`/`record`/`lead` apart as noun or verb
is a question of context, not of the word alone. The port was split before it
shipped.

## Decision

Adopt ports and adapters (hexagonal architecture). Three load-bearing ports live
in the pure `colorful-core` crate:

1. `Parser` — text to a structural tree (sentences, words, punctuation spans).
   It knows nothing about meaning.
2. `Lexicon` — a single word, **in isolation**, to a part-of-speech class. The
   context-free dictionary: a compile-time closed-class set today, a richer
   dictionary later.
3. `Annotator` — a parsed tree to a classified token stream, **with context**.
   The `v0` `LexicalAnnotator` composes a `Lexicon` with shallow heuristics; a
   future contextual or ML annotator replaces it behind this port.

The boundary between structure (`Parser`), context-free lookup (`Lexicon`), and
context-aware classification (`Annotator`) is the central design commitment. The
core stays free of I/O; parsing, lexicon lookup, terminal output, and the LSP are
adapters.

## Consequences

- Escalations land as "add or swap an adapter behind a port" — for example,
  replacing `LexicalAnnotator` with a WordNet- or ML-backed `Annotator` that
  distinguishes noun from verb, without touching the parser, the CLI, or the
  server.
- Determinism is a property of *which annotator is selected*: the deterministic
  `LexicalAnnotator` stays the default; any probabilistic annotator is opt-in, so
  the cheap reproducible path is never silently replaced.
- Guiding principle: dumb structure, smart host. The parser finds spans; all
  intelligence (classification, linting, interpretation) lives host-side.
- New capabilities are added as ports, not as concrete dependencies threaded
  through the core.
