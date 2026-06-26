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
- **COL-6** Skeleton mode: unlisted content words and punctuation emit no
  semantic token; function words, seeded open-class words, proper nouns, numbers,
  and quotes do.
- **COL-7** An annotator that emits open-class POS tags projects noun, verb,
  adjective, and adverb tokens through the manifest-backed LSP legend.
- **COL-8** The default shipped surfaces include seed open-class decisions, so
  representative noun, verb, adjective, and adverb words are visible without
  custom caller wiring.
- **COL-9** The default shipped surfaces use contextual open-class
  disambiguation for the supported ambiguous set.

## Cases

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
- **COL-1e** — *Requirement:* COL-1. *Behavior:* a sentence-initial seed
  open-class word keeps its `Open(_)` class instead of being forced to
  `Content` or upgraded to `ProperNoun`. *Oracle:* class vector equality.
  *Evidence:* `colorful-core`
  `tests::sentence_initial_open_class_seed_keeps_open_class`. *Status:*
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

- **COL-6a** — *Requirement:* COL-6. *Behavior:* in `"The zebra is 3."` the
  unlisted content word `zebra` and the `.` emit no token; the deltas skip them.
  *Oracle:* `SemanticToken` vector equality. *Evidence:* `colorful-lsp`
  `tests::unlisted_content_and_punctuation_are_unstyled`. *Status:* implemented.
- **COL-7a** — *Requirement:* COL-7. *Behavior:* the seed open-class lexicon
  emits noun, verb, adjective, and adverb semantic tokens at the manifest
  legend tail. *Oracle:* `SemanticToken` vector equality. *Evidence:*
  `colorful-lsp` `tests::seed_open_class_tokens_use_manifest_legend_tail`.
  *Status:* implemented.
- **COL-8a** — *Requirement:* COL-8. *Behavior:* the default LSP path emits noun,
  verb, adjective, and adverb semantic tokens for seeded words. *Oracle:*
  `SemanticToken` vector equality. *Evidence:* `colorful-lsp`
  `tests::default_semantic_tokens_emit_seed_open_class_roles`. *Status:*
  implemented.
- **COL-8b** — *Requirement:* COL-8. *Behavior:* the default CLI path renders
  seeded noun, verb, adjective, and adverb words with their manifest ANSI
  projections. *Oracle:* exact ANSI string equality. *Evidence:* `colorful-cli`
  `tests::default_colorizer_emits_seed_open_class_roles`. *Status:* implemented.
- **COL-9a** — *Requirement:* COL-9. *Behavior:* the default CLI and IR paths
  surface context-disambiguated ambiguous open-class roles. *Oracle:* exact ANSI
  output and token-axis equality. *Evidence:* `colorful-cli`
  `tests::default_colorizer_emits_contextual_open_class_roles`,
  `tests::ir_uses_contextual_open_class_roles`. *Status:* implemented.
- **COL-9b** — *Requirement:* COL-9. *Behavior:* the default LSP semantic-token
  path surfaces context-disambiguated ambiguous open-class roles. *Oracle:*
  `SemanticToken` vector equality. *Evidence:* `colorful-lsp`
  `tests::default_semantic_tokens_emit_contextual_open_class_roles`. *Status:*
  implemented.

## Known gaps

- The end-to-end LSP handshake (`initialize` → `semanticTokens/full`) is verified
  manually; an automated integration harness is a future addition.
- The title-case proper-noun guard is heuristic: a short capitalized line with no
  lowercase content word (for example `I am Groot`) can be read as a title and
  suppress a genuine proper noun. Accepted in `v0` as the conservative direction.
