# Lexicon — Test Plan

Requirements:

- **LEX-1** Each `FunctionKind` is recognized for representative words.
- **LEX-2** Lookup is case-insensitive.
- **LEX-3** Numeric tokens are classified as `Number`; words with letters are not.
- **LEX-4** Non-function, non-numeric words are `Content` (proper nouns are not
  decided here).
- **LEX-5** The closed-class set meets a minimum size.

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

## Known gaps

- No regression fixture yet asserting the full word list; the size floor and
  per-kind samples are the current guard. The duplicate-key check is enforced at
  compile time by `phf`.
