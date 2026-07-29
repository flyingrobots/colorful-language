# Lexicon — Test Plan

Requirements:

- **LEX-1** Each of the seven `FunctionKind` variants is recognized for a
  representative word.
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
  Each ambiguous word is a named rule (an ordered list of senses, each with its
  own evidence check) rather than a hand-matched dispatch over a separate
  senses-only table, so a sense can't be declared without the logic that
  makes it fire, and there is no catch-all branch that could silently
  swallow an unrecognized word into the wrong class.
- **LEX-11** Numeric recognition has one scanner contract shared with parsing:
  separators are singular and surrounded by numeric characters, and Unicode
  numeric behavior is explicit.
- **LEX-12** Public lexicon API documentation describes data-backed behavior
  without linking private implementation tables, and warning-denying rustdoc
  runs as a blocking CI and release-preparation gate.

## Cases

Implemented and planned cases are listed below. Implemented lexicon evidence
lives in `crates/colorful-lexicon/src/lib.rs`.

- **LEX-1a** — *Requirement:* LEX-1. *Behavior:* a representative word for
  each of all seven `FunctionKind` variants — `Article`, `Preposition`,
  `Conjunction`, `Pronoun`, `Auxiliary`, `Determiner`, `Negator` — classifies
  to exactly that kind. Table-driven over an exhaustive `match` with no
  catch-all arm, so an eighth variant added to `FunctionKind` without a
  matching case here is a compile error, not a silently-uncovered kind. This
  is distinct from LEX-7a below: LEX-1a proves one representative word per
  kind (breadth across all seven kinds); LEX-7a proves two specific negator
  words (depth on one kind's dedicated negation behavior). *Oracle:*
  equality of `PosClass`, per table entry. *Evidence:*
  `tests::classifies_each_function_kind`. *Status:* implemented.
- **LEX-2a** — *Requirement:* LEX-2. *Behavior:* `The`/`AND` classify as their
  function kinds. *Oracle:* equality of `PosClass`. *Evidence:*
  `tests::lookup_is_case_insensitive`. *Status:* implemented.
- **LEX-3a** — *Requirement:* LEX-3. *Behavior:* `150`, `3.14`, `1,000` are
  numbers; `covid19` and `.` are not. *Oracle:* equality of `PosClass`.
  *Evidence:* `tests::numbers_are_recognized`. *Status:* implemented.
- **LEX-3b** — *Requirement:* LEX-3. *Behavior:* non-ASCII Unicode digits
  (Arabic-Indic, full-width) classify as `Number`, matching the parser's
  `\p{N}` word-formation rule so the pipeline never disagrees with itself.
  *Oracle:* equality of `PosClass`. *Evidence:*
  `tests::unicode_numerals_are_numbers`. *Status:* implemented.
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
- **LEX-7a** — *Requirement:* LEX-7. *Behavior:* both `not` and `never`
  (not just one representative negator, as LEX-1a covers) are `Negator`.
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
- **LEX-10c** — *Requirement:* LEX-10. *Behavior:* a corpus of worked examples
  — one per sense of `book`/`record`/`lead`/`fast`, plus a case where no
  sense's evidence matches and a case for a word absent from the rule table
  entirely — resolves to the expected class (or `None`), citing the matched
  rule's own named evidence on failure rather than a rationale restated in
  the test. *Oracle:* per-case class equality against `contextual_kind`
  directly. *Evidence:*
  `tests::ambiguous_word_corpus_matches_expected_sense_with_rationale`.
  *Status:* implemented.
- **LEX-11a** — *Requirement:* LEX-11. *Behavior:* parser token formation and
  lexicon `is_number` agree for integers, decimals, grouping, Unicode numerics,
  mixed comma/period forms, repeated separators, and leading/trailing
  separators. Both consume `colorful_core::numeric_prefix_len`'s
  `N+([.,]N+)*` contract. *Oracle:* one TSV matrix pins exact parser leaf
  slices, the scanner's whole-token decision, and lexicon `PosClass` equality;
  malformed separator placement is never `Number`. *Evidence type:* shared
  pure scanner and cross-crate table-driven parity test. *Evidence:*
  `colorful_core::numeric_prefix_len`,
  `crates/colorful-parse/tests/fixtures/numeric_parity.tsv`, and
  `crates/colorful-parse/tests/numeric_parity.rs`
  (`parser_and_lexicon_share_the_numeric_matrix`). *Tracking:*
  [#143](https://github.com/flyingrobots/colorful-language/issues/143).
  *Status:* implemented.
- **LEX-11b** — *Requirement:* LEX-11. *Behavior:* the lexicon and parser
  recognize every Rust Unicode numeric scalar through one authoritative
  predicate even when Logos and the pinned compiler carry different Unicode
  table versions. The cross-crate oracle preserves parser node kinds and
  includes the Unicode 17 numerics missing from regex-syntax 0.8.11's Unicode
  16 tables. *Oracle:* exhaustive equality among parser `Word`, scanner
  whole-token acceptance, and lexicon `Number`, plus typed malformed-token
  fixtures. *Evidence type:* typed table-driven regression plus deterministic
  exhaustive Unicode property test. *Evidence:*
  `crates/colorful-parse/tests/fixtures/numeric_parity.tsv`;
  `crates/colorful-parse/tests/numeric_parity.rs`
  (`parser_and_lexicon_share_the_numeric_matrix` and
  `every_unicode_numeric_scalar_has_parser_lexicon_parity`). *Tracking:*
  [#143](https://github.com/flyingrobots/colorful-language/issues/143).
  *Status:* implemented.
- **LEX-12a** — *Requirement:* LEX-12. *Behavior:* exported lexicon adapters
  use stable public concepts rather than private table symbols in their
  rustdoc, and the package documentation builds with warnings denied in both
  hosted CI and the full local release-preparation gate. *Oracle:*
  `RUSTDOCFLAGS="-D warnings" cargo doc --locked -p colorful-lexicon
  --no-deps` exits zero; the public-API documentation policy rejects a missing,
  guarded, or non-blocking hosted command and a missing release-preparation
  command. *Evidence type:* warning-denying package documentation build plus
  deterministic policy tests. *Tracking:*
  [#230](https://github.com/flyingrobots/colorful-language/issues/230).
  *Evidence:* public rustdoc in `crates/colorful-lexicon/src/lib.rs`;
  `scripts/check-public-api-doctests.test.mjs`; the Rust job in
  `.github/workflows/ci.yml`; `scripts/release-prep.sh`. *Status:* implemented.

## Known gaps

- No regression fixture yet asserting the full word list; the size floor and
  per-kind samples are the current guard. The duplicate-key check is enforced at
  compile time by `phf`.
