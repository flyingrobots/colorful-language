# Linting — Test Plan

Requirements:

- **LINT-1** The `Analyzer` port is independently implementable, and `Finding`
  carries a span, rule, severity, and message; each `Rule` has a stable, unique
  `code()`.
- **LINT-2** The `weak-word` rule flags filler `Content` lexemes as `Info` and
  leaves clean prose alone.
- **LINT-3** The `run-on` rule flags a sentence over the word threshold as a
  `Warning`, and only over the threshold.
- **LINT-4** The `length-outlier` rule flags a sentence far longer than the
  document mean, defers to `run-on` past the cap, and stays silent on a uniform
  document.
- **LINT-5** The `passive-voice` rule flags a `be`-auxiliary plus a past
  participle (including one intervening adverb) and not active voice.
- **LINT-6** Findings are returned in source order.
- **LINT-7** The CLI prints compiler-style `name:line:col: severity [code]:
  message` lines, exits non-zero on findings and zero on clean input, and tracks
  newlines in its line/column arithmetic.
- **LINT-8** The LSP maps findings to diagnostics carrying range, severity, rule
  code, and the `colorful` source, with UTF-16 columns.

## Cases

All cases are implemented.

- **LINT-1a** — *Requirement:* LINT-1. *Behavior:* an `Analyzer` can be written
  against the port alone. *Oracle:* finding count and span. *Evidence:*
  `colorful-core` `tests::analyzer_port_is_independently_implementable`.
  *Status:* implemented.
- **LINT-1b** — *Requirement:* LINT-1. *Behavior:* rule codes are stable and
  distinct. *Oracle:* exact code vector + uniqueness. *Evidence:* `colorful-core`
  `tests::rule_codes_are_stable_and_distinct`. *Status:* implemented.
- **LINT-1c** — *Requirement:* LINT-1. *Behavior:* a `Finding` carries span,
  rule, severity, message. *Oracle:* field equality. *Evidence:* `colorful-core`
  `tests::finding_carries_span_rule_severity_and_message`. *Status:* implemented.
- **LINT-2a** — *Requirement:* LINT-2. *Behavior:* filler words are flagged as
  `Info` in order. *Oracle:* lexeme vector + severity. *Evidence:* `colorful-lint`
  `tests::weak_words_are_flagged_as_info`. *Status:* implemented.
- **LINT-2b** — *Requirement:* LINT-2. *Behavior:* the message names the lexeme.
  *Oracle:* exact message. *Evidence:* `colorful-lint`
  `tests::weak_word_message_uses_the_lexeme`. *Status:* implemented.
- **LINT-2c** — *Requirement:* LINT-2. *Behavior:* clean prose has no findings.
  *Oracle:* empty findings. *Evidence:* `colorful-lint`
  `tests::clean_prose_has_no_findings`. *Status:* implemented.
- **LINT-3a** — *Requirement:* LINT-3. *Behavior:* a 41-word sentence is a
  `run-on` warning. *Oracle:* count, severity, message. *Evidence:* `colorful-lint`
  `tests::run_on_sentence_over_threshold_is_a_warning`. *Status:* implemented.
- **LINT-3b** — *Requirement:* LINT-3. *Behavior:* exactly 40 words is not a
  run-on. *Oracle:* no run-on finding. *Evidence:* `colorful-lint`
  `tests::exactly_forty_words_is_not_a_run_on`. *Status:* implemented.
- **LINT-4a** — *Requirement:* LINT-4. *Behavior:* a 30-word sentence among tiny
  ones is a length outlier. *Oracle:* count, severity, message prefix. *Evidence:*
  `colorful-lint` `tests::length_outlier_is_relative_to_the_document_mean`.
  *Status:* implemented.
- **LINT-4b** — *Requirement:* LINT-4. *Behavior:* a uniform document has no
  outliers. *Oracle:* no outlier finding. *Evidence:* `colorful-lint`
  `tests::a_uniform_document_has_no_length_outliers`. *Status:* implemented.
- **LINT-4c** — *Requirement:* LINT-4. *Behavior:* a run-on sentence is not also
  reported as a length outlier. *Oracle:* run-on present, outlier absent.
  *Evidence:* `colorful-lint` `tests::run_on_sentence_is_not_also_a_length_outlier`.
  *Status:* implemented.
- **LINT-5a** — *Requirement:* LINT-5. *Behavior:* `be` + participle is a passive
  candidate. *Oracle:* span + message. *Evidence:* `colorful-lint`
  `tests::passive_voice_regular_participle_is_flagged`. *Status:* implemented.
- **LINT-5b** — *Requirement:* LINT-5. *Behavior:* one adverb between aux and
  participle is allowed. *Oracle:* flagged span. *Evidence:* `colorful-lint`
  `tests::passive_voice_allows_one_adverb_between`. *Status:* implemented.
- **LINT-5c** — *Requirement:* LINT-5. *Behavior:* active voice is not flagged.
  *Oracle:* no passive finding. *Evidence:* `colorful-lint`
  `tests::active_voice_is_not_flagged_as_passive`. *Status:* implemented.
- **LINT-6a** — *Requirement:* LINT-6. *Behavior:* findings come back in source
  order. *Oracle:* sorted start offsets. *Evidence:* `colorful-lint`
  `tests::findings_are_returned_in_source_order`. *Status:* implemented.
- **LINT-7a** — *Requirement:* LINT-7. *Behavior:* findings print compiler-style
  and signal a non-zero exit. *Oracle:* exact report + failure flag. *Evidence:*
  `colorful-cli` `tests::lint_reports_findings_in_compiler_style_and_signals_failure`.
  *Status:* implemented.
- **LINT-7b** — *Requirement:* LINT-7. *Behavior:* clean prose prints nothing and
  signals success. *Oracle:* empty output + success flag. *Evidence:* `colorful-cli`
  `tests::lint_of_clean_prose_prints_nothing_and_signals_success`. *Status:*
  implemented.
- **LINT-7c** — *Requirement:* LINT-7. *Behavior:* line/column track newlines.
  *Oracle:* `(line, col)` equality. *Evidence:* `colorful-cli`
  `tests::lint_line_col_tracks_newlines`. *Status:* implemented.
- **LINT-8a** — *Requirement:* LINT-8. *Behavior:* a diagnostic carries range,
  severity, code, source. *Oracle:* field equality. *Evidence:* `colorful-lsp`
  `tests::diagnostic_carries_range_severity_code_and_source`. *Status:* implemented.
- **LINT-8b** — *Requirement:* LINT-8. *Behavior:* a run-on diagnostic is a
  warning. *Oracle:* severity. *Evidence:* `colorful-lsp`
  `tests::run_on_diagnostic_is_a_warning`. *Status:* implemented.
- **LINT-8c** — *Requirement:* LINT-8. *Behavior:* diagnostic ranges use UTF-16
  columns. *Oracle:* `Position` equality past a multibyte char. *Evidence:*
  `colorful-lsp` `tests::diagnostic_range_uses_utf16_columns`. *Status:*
  implemented.
- **LINT-8d** — *Requirement:* LINT-8. *Behavior:* clean prose yields no
  diagnostics. *Oracle:* empty diagnostics. *Evidence:* `colorful-lsp`
  `tests::clean_prose_yields_no_diagnostics`. *Status:* implemented.
