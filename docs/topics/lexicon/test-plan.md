# Lexicon — Test Plan

Requirements:

- **LEX-1** Each `FunctionKind` is recognized for representative words.
- **LEX-2** Lookup is case-insensitive.
- **LEX-3** Numeric tokens are classified as `Number`; words with letters are not.
- **LEX-4** Non-function, non-numeric words are `Content` (proper nouns are not
  decided here).
- **LEX-5** The closed-class set meets a minimum size.
- **LEX-6** Common contractions classify as function words; a typographic
  apostrophe matches a straight one.
- **LEX-7** Negators (`not`, `never`) classify as `Negator`.
- **LEX-8** A numeric token must start and end with a digit.
- **LEX-9** The open-class seed lexicon tags representative noun, verb,
  adjective, and adverb words while preserving closed-class and number precedence.
- **LEX-10** The contextual open-class annotator refines a small ambiguous word
  set using local sentence context while preserving existing lexical behavior.

## Cases

All cases are implemented. Evidence lives in `colorful-lexicon` unit tests
(`crates/colorful-lexicon/src/lib.rs`).

- **LEX-1a** — *Requirement:* LEX-1. *Behavior:* a representative word for each of
  the six kinds classifies correctly. *Oracle:* equality of `PosClass`.
  *Evidence:* `tests::classifies_each_function_kind`. *Status:* implemented.
- **LEX-2a** — *Requirement:* LEX-2. *Behavior:* `The`/`AND` classify as their
  function kinds. *Oracle:* equality of `PosClass`. *Evidence:*
  `tests::lookup_is_case_insensitive`. *Status:* implemented.
- **LEX-3a** — *Requirement:* LEX-3. *Behavior:* `150`, `3.14`, `1,000` are
  numbers; `covid19` and `.` are not. *Oracle:* equality of `PosClass`.
  *Evidence:* `tests::numbers_are_recognized`. *Status:* implemented.
- **LEX-4a** — *Requirement:* LEX-4. *Behavior:* `cat`, `running`, and `Paris`
  are `Content`. *Oracle:* equality of `PosClass`. *Evidence:*
  `tests::content_words_are_undifferentiated`. *Status:* implemented.
- **LEX-5a** — *Requirement:* LEX-5. *Behavior:* the set has at least 150 words.
  *Oracle:* `word_count()` lower bound. *Evidence:*
  `tests::set_is_nonempty_and_reasonably_sized`. *Status:* implemented.
- **LEX-6a** — *Requirement:* LEX-6. *Behavior:* negative and pronoun+aux
  contractions classify; curly apostrophe matches. *Oracle:* equality of
  `PosClass`. *Evidence:* `tests::contractions_are_classified`,
  `tests::curly_apostrophe_contractions_match`. *Status:* implemented.
- **LEX-7a** — *Requirement:* LEX-7. *Behavior:* `not`/`never` are `Negator`.
  *Oracle:* equality of `PosClass`. *Evidence:* `tests::negation_is_its_own_kind`.
  *Status:* implemented.
- **LEX-8a** — *Requirement:* LEX-8. *Behavior:* `3.`, `.5`, `3..` are not
  numbers. *Oracle:* equality of `PosClass`. *Evidence:*
  `tests::malformed_numbers_are_not_numbers`. *Status:* implemented.
- **LEX-9a** — *Requirement:* LEX-9. *Behavior:* `SeedOpenClassLexicon` tags
  representative content words as noun, verb, adjective, and adverb. *Oracle:*
  equality of `PosClass::Open` values. *Evidence:*
  `tests::seed_open_class_lexicon_tags_representative_content_words`. *Status:*
  implemented.
- **LEX-9b** — *Requirement:* LEX-9. *Behavior:* `SeedOpenClassLexicon` keeps
  function-word and number precedence before checking the seed table. *Oracle:*
  equality of `PosClass`. *Evidence:*
  `tests::seed_open_class_lexicon_preserves_closed_class_and_number_precedence`.
  *Status:* implemented.
- **LEX-10a** — *Requirement:* LEX-10. *Behavior:* `ContextualOpenClassAnnotator`
  classifies supported ambiguous words from local context. *Oracle:* class vector
  equality. *Evidence:*
  `tests::contextual_annotator_disambiguates_ambiguous_open_class_words`,
  `tests::contextual_annotator_covers_record_and_lead_roles`. *Status:*
  implemented.
- **LEX-10b** — *Requirement:* LEX-10. *Behavior:* contextual classification
  preserves function-word, number, seed-open-class, punctuation, and
  unlisted-content behavior. *Oracle:* class vector equality. *Evidence:*
  `tests::contextual_annotator_preserves_existing_precedence`. *Status:*
  implemented.

## Known gaps

- No regression fixture yet asserting the full word list; the size floor and
  per-kind samples are the current guard. The duplicate-key check is enforced at
  compile time by `phf`.
