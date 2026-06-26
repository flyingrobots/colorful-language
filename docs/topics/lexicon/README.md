# Lexicon

The `Lexicon` port classifies a single word, in isolation, into a `PosClass`.
The implementation is `colorful_lexicon::ClosedClassLexicon`, backed by a
compile-time perfect-hash set of closed-class function words.

## Current behavior

`classify(word) -> PosClass`:

1. If the word is in the closed-class set (matched case-insensitively), return
   `Function(kind)` with its `FunctionKind`.
2. Otherwise, if the word is numeric — at least one digit and only digits or
   internal `.`/`,` separators — return `Number`.
3. Otherwise return `Content` (open-class, undifferentiated in `v0`).

The set holds the finite closed-class vocabulary across the `FunctionKind`s:
`Article`, `Preposition`, `Conjunction`, `Pronoun`, `Auxiliary`, `Determiner`,
and `Negator`, plus common contractions. `ClosedClassLexicon::word_count()` is
the authoritative current size.

## Design notes

- **Closed class as keywords.** Function words are a fixed, enumerable list, so
  they are stored like language keywords — no machine learning. See
  `docs/design/0001`.
- **Proper nouns are not decided here.** Detecting a proper noun needs sentence
  context (is the word capitalized *and* not sentence-initial?), so it is applied
  by `colorful_core::LexicalAnnotator`, not by the lexicon. See the
  [coloring](../coloring/README.md) topic.

## Known limitations (v0)

- **Single assignment.** Each word maps to exactly one `FunctionKind`. Genuinely
  ambiguous words (`that` as determiner / pronoun / conjunction; `for` as
  preposition / conjunction) are assigned their most common role. Disambiguation
  is a later goalpost.
- **Semi-modals.** Words like `need`, `dare`, and `used` are tagged as
  auxiliaries; their content-verb uses are mis-tagged.

## Goalpost 2 seed adapter

`SeedOpenClassLexicon` is an opt-in adapter for the first open-class POS slice.
It preserves `ClosedClassLexicon` precedence, then classifies a small
representative seed set as `PosClass::Open(OpenClassKind::Noun)`,
`PosClass::Open(OpenClassKind::Verb)`,
`PosClass::Open(OpenClassKind::Adjective)`, or
`PosClass::Open(OpenClassKind::Adverb)`.

The seed adapter is not wired into the default CLI, LSP, or `colorful ir` command
path. It exists to prove the port contract before the project commits to a larger
dictionary or contextual disambiguator. When a caller does opt into an annotator
that emits `PosClass::Open`, the IR and vocabulary layers can now carry and
project those noun/verb/adjective/adverb distinctions.

See the [test plan](test-plan.md) for the cases that pin this behavior.
