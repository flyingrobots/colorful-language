# Parsing — Test Plan

Requirements:

- **PAR-1** Words, numbers, contractions, and hyphenated words tokenize as single
  word nodes.
- **PAR-2** Sentence-ending punctuation splits sentences; unterminated text is one
  sentence.
- **PAR-3** Quotes and punctuation are punctuation nodes.
- **PAR-4** Parsing is total and produces well-formed spans for any input.
- **PAR-5** An adjacent trailing closer is absorbed into the sentence; a spaced
  opening quote starts the next sentence.
- **PAR-6** Common Unicode spaces separate tokens and are skipped.

## Cases

All cases are implemented. Evidence lives in `colorful-parse` unit tests
(`crates/colorful-parse/src/lib.rs`).

- **PAR-1a** — *Requirement:* PAR-1. *Behavior:* `"The cat sat."` yields three
  words and a terminator with exact spans. *Oracle:* structural equality of the
  sentence vector. *Evidence:* `tests::single_sentence_words_and_terminator`.
  *Status:* implemented.
- **PAR-1b** — *Requirement:* PAR-1. *Behavior:* contractions and hyphenated
  words stay one word. *Oracle:* structural equality. *Evidence:*
  `tests::contractions_and_hyphens_stay_one_word`. *Status:* implemented.
- **PAR-1c** — *Requirement:* PAR-1. *Behavior:* numbers are word nodes. *Oracle:*
  structural equality. *Evidence:* `tests::numbers_are_word_nodes`. *Status:*
  implemented.
- **PAR-1d** — *Requirement:* PAR-1. *Behavior:* non-ASCII letters join a word.
  *Oracle:* structural equality (`café` is one 5-byte word). *Evidence:*
  `tests::non_ascii_letters_join_words`. *Status:* implemented.
- **PAR-2a** — *Requirement:* PAR-2. *Behavior:* terminators split sentences.
  *Oracle:* structural equality (two sentences). *Evidence:*
  `tests::splits_on_sentence_terminators`. *Status:* implemented.
- **PAR-2b** — *Requirement:* PAR-2. *Behavior:* unterminated text is one
  sentence. *Oracle:* structural equality. *Evidence:*
  `tests::unterminated_text_is_one_sentence`. *Status:* implemented.
- **PAR-3a** — *Requirement:* PAR-3. *Behavior:* quotes are separate punctuation.
  *Oracle:* structural equality. *Evidence:*
  `tests::quotes_are_separate_punctuation`. *Status:* implemented.
- **PAR-4a** — *Requirement:* PAR-4. *Behavior:* empty/whitespace input is an
  empty document. *Oracle:* empty sentence vector. *Evidence:*
  `tests::empty_input_is_empty_document`. *Status:* implemented.
- **PAR-4b** — *Requirement:* PAR-4. *Behavior:* adversarial inputs (emoji, long
  tokens, mixed punctuation) do not panic and yield non-empty, in-bounds,
  ordered, char-boundary spans. *Oracle:* span invariant assertions. *Evidence:*
  `tests::parsing_is_total_and_spans_are_well_formed`. *Status:* implemented.
- **PAR-5a** — *Requirement:* PAR-5. *Behavior:* `"Hi." Go.` keeps the closing
  quote in sentence 1; `Hi. "Go."` starts sentence 2 at the opening quote.
  *Oracle:* structural equality. *Evidence:*
  `tests::sentence_absorbs_trailing_closing_quote`,
  `tests::opening_quote_after_terminator_starts_new_sentence`. *Status:*
  implemented.
- **PAR-6a** — *Requirement:* PAR-6. *Behavior:* a thin space (U+2009) separates
  two words and is skipped. *Oracle:* structural equality. *Evidence:*
  `tests::unicode_spaces_are_skipped`. *Status:* implemented.

## Known gaps

- No fixtures yet for deeply nested punctuation or clause boundaries; deferred
  until structure deepens beyond `v0`.
