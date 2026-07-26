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
- **PAR-7** Numeric token formation agrees with the lexicon for valid and
  malformed separator placement across ASCII and Unicode numerics.
- **PAR-8** A bounded deterministic fuzz/property corpus covers arbitrary valid
  Unicode, range legality, and source round-trip without profile-dependent
  stack assumptions.

## Cases

Implemented and planned cases are listed below. Implemented parser evidence
lives in `crates/colorful-parse/src/lib.rs`.

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
- **PAR-1e** — *Requirement:* PAR-1. *Behavior:* a letter-initial word keeps
  its internal digits as one word (`covid19`, `H2O`), while a digit-initial
  token is still a number (`3.5`). *Oracle:* structural equality. *Evidence:*
  `tests::alphanumeric_words_stay_together`. *Status:* implemented.
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
- **PAR-4b** — *Requirement:* PAR-4. *Behavior:* adversarial inputs (empty,
  emoji, mixed punctuation, combining marks, zero-width joiners) do not panic
  and yield non-empty, in-bounds, ordered, char-boundary spans. *Giant-token
  strategy:* `logos` only lowers to a loop under optimizations; a debug build
  recurses once per character, so a pathologically long single token (the
  fixture uses a 10,000-character word) can exhaust a default thread's stack
  before the assertions ever run — an unrelated environment limit, not a
  parser bug. The property runs on a dedicated thread with an explicit 16 MiB
  stack so the giant-token case gets a fair, deterministic run in debug
  builds too, instead of being skipped or flaking. *Oracle:* span invariant
  assertions (non-empty, in-bounds, ordered, on char boundaries) plus no
  panic. *Evidence:* `tests::parsing_is_total_and_spans_are_well_formed`
  (spawns `tests::check_total_and_well_formed` on the large-stack thread).
  *Status:* implemented.
- **PAR-5a** — *Requirement:* PAR-5. *Behavior:* `"Hi." Go.` keeps the closing
  quote in sentence 1; `Hi. "Go."` starts sentence 2 at the opening quote.
  *Oracle:* structural equality. *Evidence:*
  `tests::sentence_absorbs_trailing_closing_quote`,
  `tests::opening_quote_after_terminator_starts_new_sentence`. *Status:*
  implemented.
- **PAR-6a** — *Requirement:* PAR-6. *Behavior:* a thin space (U+2009) separates
  two words and is skipped. *Oracle:* structural equality. *Evidence:*
  `tests::unicode_spaces_are_skipped`. *Status:* implemented.
- **PAR-7a** — *Requirement:* PAR-7. *Behavior:* one shared table covers
  integers, decimals, grouping, Unicode numerics, mixed comma/period forms,
  repeated separators, and leading/trailing separators. Both adapters use the
  pure `colorful_core::numeric_prefix_len` scanner implementing
  `N+([.,]N+)*`, where `N` is a Unicode numeric character. *Oracle:* one TSV
  matrix pins exact parser leaf slices, the shared scanner's whole-token
  decision, and lexicon class equality; malformed forms split at the invalid
  separator and classify as content when presented whole. *Evidence type:*
  shared pure scanner and cross-crate table-driven parity test. *Planned
  evidence:* `colorful_core::numeric_prefix_len`,
  `crates/colorful-lexicon/tests/fixtures/numeric_parity.tsv`, and
  `crates/colorful-lexicon/tests/numeric_parity.rs`. *Tracking:*
  [#143](https://github.com/flyingrobots/colorful-language/issues/143).
  *Status:* planned.
- **PAR-8a** — *Requirement:* PAR-8. *Behavior:* a bounded seeded corpus drives
  arbitrary valid Unicode and known parser regressions through parsing and
  source reconstruction in normal CI. *Oracle:* no panic; every accepted span
  is non-empty, ordered, in bounds, and on a character boundary; concatenated
  spans/gaps reproduce the source. *Evidence type:* property test, fuzz target,
  and deterministic regression corpus. *Tracking:*
  [#134](https://github.com/flyingrobots/colorful-language/issues/134).
  *Status:* planned.

## Known gaps

- No fixtures yet for deeply nested punctuation or clause boundaries; deferred
  until structure deepens beyond `v0`.
- Parser/lexicon numeric parity remains open in PAR-7a.
- Bounded deterministic fuzz/property evidence remains open in PAR-8a.
