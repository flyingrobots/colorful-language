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
- **LINT-15** The public `Analyzer` port has a concise runnable example that
  reports a finding without duplicating the linting reference.

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
- **LINT-9a** — *Requirement:* LINT-9. *Behavior:* eight reviewed fixtures
  (`weak-word`, `run-on`, `length-outlier`, `passive-voice`,
  `quoted-weak-words`, `mixed-ordering`, `false-positives`,
  `crlf-line-endings`) each pin the
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
  UTF-8-character columns are reconciled. The fixtures contain no astral
  scalars; curly quote punctuation is one scalar and one UTF-16 code unit, so
  columns still coincide. *Oracle:* per-finding field equality, including
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
  reviewed result-state adjective constructions are not silently classified as
  passive voice. A finding requires a lexically classified `be` auxiliary, an
  eligible content/verb token in the reviewed participle table, and any
  entry-specific disambiguation evidence; result-state entries require a
  following lexically classified `by` phrase. *Oracle:* a reviewed development
  corpus reports exactly 4 true positives, 0 false positives, 11 true
  negatives, and 0 false negatives; CLI/LSP golden parity includes the named
  and temporal negatives;
  the finding message continues to say “candidate”; and documentation states
  that fixture precision is not a held-out product-quality estimate.
  *Evidence type:* deterministic TSV corpus, rule-table unit tests, CLI/LSP
  golden fixtures, and current reference. *Evidence:*
  `crates/colorful-lint/tests/fixtures/passive_voice.tsv`,
  `crates/colorful-lint/tests/passive_voice_precision.rs`,
  `crates/colorful-cli/fixtures/lint/{passive-voice,false-positives}.*`, and
  `docs/topics/linting/README.md`. *Tracking:*
  [#138](https://github.com/flyingrobots/colorful-language/issues/138).
  *Status:* implemented.
- **LINT-11b** — *Requirement:* LINT-11. *Behavior:* temporal `by` phrases do
  not satisfy the local agent-evidence requirement for ambiguous result-state
  participles. *Oracle:* `was closed by now` and `was broken by then` remain
  silent while reviewed agentive `by` phrases still produce their exact
  passive-voice candidates. *Evidence type:* deterministic reviewed corpus.
  *Tracking:*
  [#138](https://github.com/flyingrobots/colorful-language/issues/138).
  *Evidence:* `crates/colorful-lint/tests/fixtures/passive_voice.tsv` and
  `crates/colorful-lint/tests/passive_voice_precision.rs`. *Status:*
  implemented.
- **LINT-11c** — *Requirement:* LINT-11. *Behavior:* passive-voice analysis
  joins ordered sentence words to ordered classifications with one monotonic
  cursor rather than building a whole-document lookup index. *Oracle:* a
  punctuation-heavy classification stream advances through each token at most
  once while retaining exact passive findings. *Evidence type:* deterministic
  unit test. *Tracking:*
  [#138](https://github.com/flyingrobots/colorful-language/issues/138).
  *Evidence:*
  `colorful_lint::tests::classification_cursor_visits_ordered_tokens_once`.
  *Status:* implemented.
- **LINT-12a** — *Requirement:* LINT-12. *Behavior:* the chosen quotation policy
  always evaluates word tokens inside quotation marks; quote pairing does not
  suppress editorial findings. Balanced straight quotes, balanced curly quotes,
  nested curly quotes with embedded punctuation, apostrophes, and unbalanced
  straight/curly input all produce the same deterministic weak-word decisions.
  *Oracle:* an exact golden report names every quoted weak word, a direct unit
  test pins the policy, CLI and LSP return equal findings and spans through the
  shared fixture harness, and the current reference explains why quotation
  alone is not a suppression boundary. *Evidence type:* unit test, golden
  fixture, cross-surface integration test, and current reference. *Evidence:*
  `colorful-lint`
  `tests::weak_words_inside_quotes_are_intentionally_flagged`,
  `crates/colorful-cli/fixtures/lint/quoted-weak-words.{txt,golden}`,
  `crates/colorful-cli/tests/lint_golden_fixtures.rs`, and
  `docs/topics/linting/README.md`. *Tracking:*
  [#139](https://github.com/flyingrobots/colorful-language/issues/139).
  *Status:* implemented.
- **LINT-13a** — *Requirement:* LINT-13. *Behavior:* a Vale v3 process adapter
  lives in an outer crate that depends on `colorful-core`; neither
  `colorful-core` nor either production binary depends on the adapter. A
  successful process result becomes a document-bound, I/O-free analyzer
  snapshot behind the existing `Analyzer` port. *Oracle:* the workspace
  dependency graph has the required direction; default CLI/LSP analysis stays
  built-in and succeeds with no `vale` executable; and the prepared snapshot
  implements `Analyzer`. *Evidence type:* manifest-boundary test and analyzer
  contract test. *Evidence:*
  `colorful-vale`
  `workspace_boundary::adapter_dependency_direction_preserves_pure_core_and_default_binaries`
  and
  `vale_adapter::built_in_and_vale_findings_have_cli_lsp_parity_without_ir_drift`.
  *Tracking:*
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  *Status:* implemented.
- **LINT-13b** — *Requirement:* LINT-13. *Behavior:* explicit configuration and
  capability discovery admit supported Vale v3 JSON/stdin behavior, isolate
  ambient global configuration, and reject a missing configuration,
  unavailable executable, or incompatible major version before analysis.
  *Oracle:* exact typed error categories and exact spawned argument/environment
  witnesses from a deterministic mock process. *Evidence type:* process-level
  adapter test. *Evidence:* `colorful-vale`
  `vale_adapter::{discovery_is_explicit_versioned_and_ambient_config_free,
  discovery_rejects_missing_config_executable_and_major,
  permission_denied_executable_is_unavailable,
  analysis_uses_exact_isolated_stdin_contract,
  analysis_honors_the_explicit_document_extension}`,
  `config::tests::relative_paths_are_resolved_before_the_process_changes_directory`,
  and the checksum-verified official Vale 3.14.2 output retained at
  `crates/colorful-vale/tests/fixtures/vale-3.14.2-smoke.json` and admitted by
  `vale_adapter::pinned_real_vale_v3_smoke_shape_remains_admitted`. *Tracking:*
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  *Status:* implemented.
- **LINT-13c** — *Requirement:* LINT-13. *Behavior:* timeout, cancellation,
  non-zero process failure, oversized output, invalid UTF-8, malformed JSON,
  an unexpected JSON source key, and invalid Vale alert fields fail explicitly
  without fallback findings or a panic. *Oracle:* one exact typed error
  category per fault; a synchronized cancellation witness proves an
  already-started child is terminated.
  *Evidence type:* deterministic process and parser fault matrix. *Evidence:*
  `colorful-vale`
  `vale_adapter::{pre_cancelled_analysis_does_not_start_a_process,
  running_process_can_be_cancelled_after_start,
  timeout_and_process_failure_are_distinct,
  malformed_outputs_fail_closed_by_category}`. *Tracking:*
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  *Status:* implemented.
- **LINT-13d** — *Requirement:* LINT-13. *Behavior:* Vale alert line/column
  coordinates, severities, check identities, and messages normalize into
  Colorful `Finding`s with legal byte spans and a total deterministic order.
  The coordinate corpus includes ASCII, an astral scalar, a combining mark, and
  CRLF. *Oracle:* exact span, external rule code, severity, message, and order
  vectors; malformed, reversed, or out-of-range coordinates are rejected.
  *Evidence type:* normalization contract test. *Evidence:* `colorful-vale`
  `vale_adapter::{alerts_normalize_to_legal_ordered_colorful_findings,
  invalid_coordinate_matrix_is_rejected_without_panicking}`. *Tracking:*
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  *Status:* implemented.
- **LINT-13e** — *Requirement:* LINT-13. *Behavior:* the built-in
  `ProseLinter` and a prepared Vale analyzer each project the same ordered
  findings through CLI text and LSP diagnostics without turning external
  editorial rules into syntax classifications or canonical IR axes. *Oracle:*
  for each analyzer, exact code/severity/message/order equality and equivalent
  CLI scalar versus LSP UTF-16 ranges; semantic tokens and canonical IR remain
  unchanged when the analyzer changes. *Evidence type:* cross-surface
  integration test. *Evidence:* `colorful-vale`
  `vale_adapter::built_in_and_vale_findings_have_cli_lsp_parity_without_ir_drift`.
  *Tracking:*
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  *Status:* implemented.
- **LINT-13f** — *Requirement:* LINT-13. *Behavior:* cancelling or timing out a
  configured wrapper executable terminates every descendant in the spawned
  analyzer process group before output capture is joined. *Oracle:* a
  deterministic wrapper starts a long-lived worker with redirected output;
  timeout returns its exact typed category, and the recorded worker process no
  longer exists. *Evidence type:* process-tree regression test. *Tracking:*
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
- **LINT-15a** — *Requirement:* LINT-15. *Behavior:* a public `Analyzer`
  implementation returns an inspectable finding in a compiled rustdoc example.
  *Oracle:* `cargo test --doc --workspace` compiles and runs the example with
  exact rule, severity, and span assertions. *Evidence type:* public API
  doctest. *Evidence:* `colorful-core` `Analyzer` rustdoc and
  `scripts/check-public-api-doctests.mjs`. *Tracking:*
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  *Status:* implemented.

## Open verification gaps

- Product-level comparative evidence remains open in LINT-14a; built-in rule
  fixtures are not a substitute for the held-out oracle.
