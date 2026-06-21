# ADR-0001: Scope and delivery model

- Status: Accepted
- Date: 2026-06-21

## Context

colorful-language brings IDE-grade tooling — live highlighting, structural
navigation, lint-as-you-type — to English prose instead of code. The naive path
(full statistical or neural NLP) optimizes for correct, deep parses. An editor
does not need that; it needs fast, local, error-tolerant, good-enough structure.

The enabling observation: English closed-class words (articles, prepositions,
conjunctions, pronouns, auxiliaries, determiners — roughly 150 words) form a
finite, enumerable set that behaves like programming-language keywords.

## Decision

1. The first version (Goalpost 0) classifies by lexing only: closed-class words
   as keywords; structural marks for sentences, quotes, and numbers; a
   capitalization heuristic for proper nouns; everything else as undifferentiated
   Content. No machine learning.
2. Telling open-class words apart (noun vs verb vs adjective vs adverb) is a
   later goalpost, not a prerequisite for v0.
3. Delivery is LSP-first: one local language server emitting semantic tokens,
   which reaches VS Code, Neovim, Helix, Zed, Emacs, and JetBrains at once. A
   CLI renders the same classification as ANSI for instant, editor-free output.

## Consequences

- v0 ships with zero ML and a tiny, auditable data set (the word list).
- The semantic-token legend starts on standard token types so existing themes
  color prose for free; a custom legend and theme arrive with open-class work.
- "Coloring" splits into a structural layer (cheap, always available) and a
  classification layer (the part that grows). See ADR-0002.
