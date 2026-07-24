# Linting — Test Plan

Requirements:

- **LINT-1** The `Analyzer` port is independently implementable, and `Finding`
  carries a span, rule, severity, and message; each `Rule` has a stable, unique
  `code()`.
- **LINT-2** The `weak-word` rule flags filler content lexemes as `Info`,
  including undifferentiated `Content` and tagged `Open(_)` tokens, and leaves
  clean prose alone.
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
- **LINT-9** Reviewed golden input/output fixtures pin the exact CLI report for
  each rule, a false-positive near-miss per rule, mixed-rule ordering, and
  CRLF line endings; a harness compares the linter's actual output against
  each fixture's checked-in expected file and fails the build on any drift.
- **LINT-10** For the same input, the CLI's findings and the LSP's diagnostics
  never disagree: same rule codes in the same order, same severities, same
  messages, and equivalent positions after reconciling the CLI's
  Unicode-scalar columns with the LSP's UTF-16 columns across ASCII, astral and
  combining Unicode, and LF/CRLF/bare-CR line endings.
- **LINT-11** Passive-voice detection must distinguish evidenced participles
  from adjectival complements and keep uncertainty explicit.
- **LINT-12** Weak-word behavior inside straight and curly quotations must have
  one documented policy and deterministic balanced, nested, and unbalanced
  fixtures.
- **LINT-13** Optional external `Analyzer` adapters must preserve the pure port,
  deterministic finding order, built-in availability, and CLI/LSP parity.
- **LINT-14** Product-level lint quality must be measured against a pinned,
  held-out, human-oracled corpus rather than inferred from built-in fixtures.

## Cases

Implemented and planned cases are listed below.

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
- **LINT-2d** — *Requirement:* LINT-2. *Behavior:* weak-word matching still
  applies to open-class `Open(_)` content tokens. *Oracle:* finding count, rule,
  and message. *Evidence:* `colorful-lint`
  `tests::weak_words_still_apply_to_open_class_tokens`. *Status:* implemented.
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
- **LINT-9a** — *Requirement:* LINT-9. *Behavior:* seven reviewed fixtures
  (`weak-word`, `run-on`, `length-outlier`, `passive-voice`,
  `mixed-ordering`, `false-positives`, `crlf-line-endings`) each pin the
  exact `colorful lint`-style report for a real prose sample, including a
  false-positive near-miss per rule (an exactly-40-word active-voice
  sentence with no filler words), multi-rule source ordering, and a
  literal `\r\n`-encoded fixture. *Oracle:* exact string equality between
  the linter's live output and each fixture's checked-in `.golden` file.
  *Evidence:* `crates/colorful-cli/fixtures/lint/*.{txt,golden}`;
  `colorful-cli`
  `tests::golden_fixtures_match_the_reviewed_cli_report` (in
  `crates/colorful-cli/tests/lint_golden_fixtures.rs`). Verified to
  actually fail on drift by deliberately corrupting a golden file and
  confirming the test fails, then restoring it. *Status:* implemented.
- **LINT-10a** — *Requirement:* LINT-10. *Behavior:* for every LINT-9
  fixture, `colorful_lsp::compute_diagnostics` and `ProseLinter::analyze`
  report the same findings in the same order: equal rule codes,
  severities, and messages, and a *complete* range match — both the start
  and the end position, not just the start — once UTF-16 and
  UTF-8-character columns are reconciled (both are ASCII, so they
  coincide). *Oracle:* per-finding field equality, including
  `range.start` and `range.end` independently. *Evidence:* `colorful-cli`
  `tests::cli_and_lsp_agree_on_every_fixture_finding` (in
  `crates/colorful-cli/tests/lint_golden_fixtures.rs`). *Status:*
  implemented.
- **LINT-10b** — *Requirement:* LINT-10. *Behavior:* one source places
  findings after an astral scalar and a combining mark on lines separated by
  LF, CRLF, and bare CR; CLI and LSP agree on each finding's complete byte span
  and human line, while an independent oracle converts the span endpoints to
  the surface-specific scalar and UTF-16 columns. *Oracle:*
  rule/severity/message/span equality, 1-based CLI line equality, 0-based LSP
  line equality, and exact start/end column equality in each surface's
  encoding. *Evidence type:*
  integration test. *Evidence:* `colorful-cli`
  `tests::cli_and_lsp_positions_agree_across_unicode_and_mixed_line_endings`.
  *Status:* implemented.
- **LINT-11a** — *Requirement:* LINT-11. *Behavior:* `was red`, `is sacred`, and
  reviewed ambiguous adjective constructions are not silently classified as
  passive voice; participle findings require lexical class plus reviewed
  dictionary or rule evidence. *Oracle:* exact finding vectors for positive,
  negative, and ambiguous fixtures plus a published precision measurement
  before rule expansion. *Evidence type:* deterministic rule fixtures and
  reviewed evaluation report. *Tracking:*
  [#138](https://github.com/flyingrobots/colorful-language/issues/138).
  *Status:* planned.
- **LINT-12a** — *Requirement:* LINT-12. *Behavior:* the chosen quotation policy
  produces deterministic weak-word findings for balanced, nested, and
  unbalanced straight/curly quotes and is identical across CLI and LSP.
  *Oracle:* exact finding/diagnostic vectors and documented policy equality.
  *Evidence type:* unit fixtures and cross-surface integration test. *Tracking:*
  [#139](https://github.com/flyingrobots/colorful-language/issues/139).
  *Status:* planned.
- **LINT-13a** — *Requirement:* LINT-13. *Behavior:* a Harper or Vale adapter
  lives outside `colorful-core`, normalizes findings deterministically, leaves
  the built-in analyzer usable without network or external binaries, and emits
  identical CLI/LSP results. *Oracle:* exact ordered finding equality for
  built-in and external adapters plus stable unavailable-engine behavior.
  *Evidence type:* adapter contract and process-level parity tests. *Tracking:*
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  *Status:* planned.
- **LINT-14a** — *Requirement:* LINT-14. *Behavior:* pinned Colorful and
  comparison-tool versions run against blinded development and held-out English
  corpora spanning the documented prose categories. *Oracle:* preregistered
  human labels drive precision, recall, latency, memory, install-friction, and
  task-utility reports; held-out labels remain unavailable during tuning.
  *Evidence type:* redistributable corpus, blinded annotation packet, and
  reproducible evaluation harness. *Tracking:*
  [#155](https://github.com/flyingrobots/colorful-language/issues/155).
  *Status:* planned.

## Open verification gaps

- Passive-voice precision remains open in LINT-11a.
- Quotation policy remains open in LINT-12a.
- Optional external-analyzer parity remains open in LINT-13a.
- Product-level comparative evidence remains open in LINT-14a; built-in rule
  fixtures are not a substitute for the held-out oracle.
