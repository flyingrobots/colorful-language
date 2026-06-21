# ADR-0002: Hexagonal architecture and the Parser/Tagger seam

- Status: Accepted
- Date: 2026-06-21

## Context

The project is meant to grow far past v0: a prose linter, open-class
disambiguation, an English-as-code interpreter, controlled natural language, and
an LLM semantic tier. Each of those should be an addition, not a rewrite.

## Decision

Adopt ports and adapters (hexagonal architecture). Two load-bearing ports live
in the pure `colorful-core` crate:

1. `Parser` — text to a structural tree (sentences, words, punctuation spans).
   It knows nothing about meaning.
2. `Tagger` — a word span to a part-of-speech class. This is the swappable port:
   a compile-time closed-class set today, a dictionary or ML model later.

The boundary between structure (`Parser`) and classification (`Tagger`) is the
central design commitment. The core stays free of I/O; parsing, lexicon lookup,
terminal output, and the LSP are adapters.

## Consequences

- Escalations land as "add or swap an adapter behind a port" — for example,
  replacing the lexicon Tagger with a WordNet- or ML-backed one without touching
  the parser or the server.
- Guiding principle: dumb structure, smart host. The parser finds spans; all
  intelligence (classification, linting, interpretation) lives host-side.
- New capabilities are added as ports, not as concrete dependencies threaded
  through the core.
