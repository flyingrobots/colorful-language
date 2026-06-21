# Coloring — Test Plan

Requirements:

- **COL-1** Classification assigns function/content/number classes and applies the
  mid-sentence proper-noun heuristic.
- **COL-2** Punctuation and quotes are classified structurally.
- **COL-3** The CLI renders exact ANSI per class and preserves gaps; `--no-color`
  / `NO_COLOR` is an exact passthrough.
- **COL-4** The LSP emits correct delta-encoded semantic tokens with UTF-16
  columns.
- **COL-5** The LSP applies incremental and full document edits without panicking,
  including UTF-16 surrogate and out-of-range positions.

## Cases

All cases are implemented.

- **COL-1a** — *Requirement:* COL-1. *Behavior:* function/content/number assigned
  in order. *Oracle:* class vector equality. *Evidence:* `colorful-core`
  `tests::classifies_function_content_and_number`. *Status:* implemented.
- **COL-1b** — *Requirement:* COL-1. *Behavior:* proper-noun heuristic upgrades
  only mid-sentence capitals. *Oracle:* class vector equality. *Evidence:*
  `colorful-core` `tests::proper_noun_heuristic_upgrades_only_mid_sentence_capitals`.
  *Status:* implemented.
- **COL-1c** — *Requirement:* COL-1. *Behavior:* a line break resets the
  sentence-initial guard, so a line-initial capital is not upgraded. *Oracle:*
  class vector equality. *Evidence:* `colorful-core`
  `tests::line_break_resets_sentence_initial_guard`. *Status:* implemented.
- **COL-1d** — *Requirement:* COL-1. *Behavior:* a title-case header line
  suppresses proper-noun upgrades. *Oracle:* class vector equality. *Evidence:*
  `colorful-core` `tests::title_case_line_suppresses_proper_nouns`. *Status:*
  implemented.
- **COL-2a** — *Requirement:* COL-2. *Behavior:* quotes and punctuation classified
  structurally. *Oracle:* class vector equality. *Evidence:* `colorful-core`
  `tests::punctuation_and_quotes_classified_structurally`. *Status:* implemented.
- **COL-3a** — *Requirement:* COL-3. *Behavior:* golden ANSI output for a mixed
  sentence and a proper-noun sentence. *Oracle:* exact string equality.
  *Evidence:* `colorful-cli` `tests::golden_colored_output`,
  `tests::golden_proper_noun_output`. *Status:* implemented.
- **COL-3b** — *Requirement:* COL-3. *Behavior:* stripping escapes reproduces the
  source; color disabled is an exact passthrough. *Oracle:* string equality.
  *Evidence:* `colorful-cli` `tests::gaps_and_newlines_are_preserved_exactly`,
  `tests::passthrough_when_color_disabled`, `tests::decide_color_honors_flag_and_env`.
  *Status:* implemented.
- **COL-4a** — *Requirement:* COL-4. *Behavior:* single-line and multi-line tokens
  are delta-encoded; columns count UTF-16 code units. *Oracle:* `SemanticToken`
  vector equality. *Evidence:* `colorful-lsp`
  `tests::single_line_tokens_are_delta_encoded`,
  `tests::newlines_advance_the_line_delta`,
  `tests::columns_count_utf16_code_units_not_bytes`. *Status:* implemented.
- **COL-5a** — *Requirement:* COL-5. *Behavior:* full replace, incremental edit,
  UTF-16 surrogate columns, and clamped out-of-range edits. *Oracle:* resulting
  rope string equality, no panic. *Evidence:* `colorful-lsp`
  `tests::apply_change_full_replace`, `tests::apply_change_incremental_edit`,
  `tests::apply_change_handles_utf16_surrogate_columns`,
  `tests::apply_change_clamps_out_of_range_positions`. *Status:* implemented.

## Known gaps

- The end-to-end LSP handshake (`initialize` → `semanticTokens/full`) is verified
  manually; an automated integration harness is a future addition.
