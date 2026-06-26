# Lexicon

The `Lexicon` port classifies a single word, in isolation, into a `PosClass`.
The core implementations are `colorful_lexicon::ClosedClassLexicon`, backed by a
compile-time perfect-hash set of closed-class function words, and
`SeedOpenClassLexicon`, which preserves closed-class precedence before checking a
small deterministic open-class seed table.

## Current behavior

For `ClosedClassLexicon`, `classify(word) -> PosClass`:

1. If the word is in the closed-class set (matched case-insensitively), return
   `Function(kind)` with its `FunctionKind`.
2. Otherwise, if the word is numeric — at least one digit and only digits or
   internal `.`/`,` separators — return `Number`.
3. Otherwise return `Content` (open-class, undifferentiated).

`SeedOpenClassLexicon` applies the same first two steps, then maps a small
representative set of unambiguous content words to
`PosClass::Open(OpenClassKind::Noun)`,
`PosClass::Open(OpenClassKind::Verb)`,
`PosClass::Open(OpenClassKind::Adjective)`, or
`PosClass::Open(OpenClassKind::Adverb)`. Unlisted content words still return
`Content`.

`ContextualOpenClassAnnotator` is not a lexicon. It is the default annotator
adapter that composes `SeedOpenClassLexicon` with local sentence context. It can
refine supported ambiguous `Content` words such as `book`, `record`, `lead`, and
`fast` into explicit open-class roles when the surrounding tokens make the role
deterministic.

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

## Known limitations

- **Single closed-class assignment.** Each closed-class word maps to exactly one
  `FunctionKind`. Genuinely ambiguous function words (`that` as determiner /
  pronoun / conjunction; `for` as preposition / conjunction) are assigned their
  most common role.
- **Semi-modals.** Words like `need`, `dare`, and `used` are tagged as
  auxiliaries; their content-verb uses are mis-tagged.

## Goalpost 2 adapters

The seed and contextual adapters are wired into the default CLI, LSP, and
`colorful ir` command path. They prove the port contract before the project
commits to a larger dictionary. The IR and vocabulary layers carry and project
those noun/verb/adjective/adverb distinctions across ANSI, LSP, and Graft
surfaces.

See the [test plan](test-plan.md) for the cases that pin this behavior.
