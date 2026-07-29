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
- **COL-10** The CLI emits a machine-readable diagnostic report that explains
  each token's class and presentation projection.
- **COL-11** File and stdin input must be valid UTF-8; a malformed file is
  rejected with a clear error identically across every single-document
  command, never silently lossy-converted.
- **COL-12** Release-mode latency for the CLI's `colorize()` path and the
  LSP's `compute_semantic_tokens()` function is measured (not asserted)
  against a small and a medium fixture, with hardware, toolchain, and date
  published alongside the numbers, and a stated (not yet CI-enforced)
  budget. `compute_semantic_tokens()` answers a `semanticTokens/full`
  request's token-computation problem without running the production
  `DocumentStore`. After `didOpen` or a debounced `didChange`, each accepted
  generation within the size limit runs `analyze_document()` once and caches
  both diagnostics and semantic tokens. An oversized generation bypasses
  parsing, classification, and linting while caching the stable limit
  diagnostic and empty tokens. Neither scheduled path is benchmarked here.
- **COL-13** Real `colorful-lsp` process tests cover the public JSON-RPC
  lifecycle, diagnostics, and semantic-token contract.
- **COL-14** Packaged editor evidence covers activation, incremental edits,
  diagnostics, semantic tokens, shutdown, and theme fallback.
- **COL-15** Versioned document state prevents stale analysis from publishing
  after a newer edit, reuses one cached parse/classification for diagnostics and
  semantic tokens, and exposes deterministic cancellation and document-limit
  evidence.
- **COL-16** A release-mode overload harness measures open, incremental edit,
  diagnostics publication, and semantic-token response at 100 KiB, 1 MiB,
  5 MiB, and 10 MiB, including queue delay, peak RSS, stale-result count, and
  time to the latest diagnostic. Wall-clock measurements are reviewed evidence,
  not a correctness-CI gate.
- **COL-17** Fixed-corpus release benchmarks measure every major analysis and
  projection stage without turning noisy wall-clock results into correctness
  gates.
- **COL-18** Bounded deterministic fuzz/property evidence covers arbitrary
  Unicode, malformed public structures, range legality, source round-trip, and
  CLI/LSP coordinate parity.
- **COL-19** Real `colorful` process tests cover stdin and file input, malformed
  UTF-8, operand rejection, exit statuses, `NO_COLOR`, and canonical IR output.
- **COL-20** Output from public `Parser` and `Annotator` ports crosses one pure,
  typed validation boundary before an LSP or IR adapter interprets its spans.
- **COL-21** The public `Annotator` port has a concise runnable example that
  classifies parsed structure without duplicating the coloring reference.
- **COL-22** The default CLI file path and LSP analyze the same reviewed
  Markdown prose regions; public string helpers and stdin retain historical
  Plain Text behavior because they carry no format metadata.

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
- **COL-22a** — *Requirement:* COL-22. *Behavior:* `colorful FILE.md` and
  `colorful FILE.markdown` style prose while leaving reviewed code, metadata,
  link-destination, and HTML regions byte-for-byte unchanged; a non-Markdown
  file and stdin still analyze the whole source. *Oracle:* exact ANSI presence
  in retained prose, exact excluded-region bytes, and unchanged Plain Text
  controls. *Evidence type:* real-binary and pure unit tests. *Tracking:*
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  *Evidence:* `colorful-cli` tests
  `binary_contract::markdown_file_colorization_excludes_non_prose_regions` and
  `cli::tests::file_format_detection_is_extension_bounded_and_case_insensitive`.
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
- **COL-10a** — *Requirement:* COL-10. *Behavior:* `colorful diagnose --json`
  reports each token's text, byte range, token axes, visual role, ANSI
  projection, graft class, LSP token type, and LSP legend index. *Oracle:* JSON
  field equality. *Evidence:* `colorful-cli`
  `tests::diagnose_json_reports_token_roles_and_lsp_types`. *Status:*
  implemented.
- **COL-10b** — *Requirement:* COL-10. *Behavior:* the committed editor smoke
  fixture produces a stable diagnostic summary and includes every current
  presentation role. *Oracle:* exact summary and per-role count equality.
  *Evidence:* `crates/colorful-cli/fixtures/editor-smoke-prose.txt`;
  `colorful-cli` `tests::diagnose_json_covers_editor_smoke_fixture`. *Status:*
  implemented.
- **COL-12a** — *Requirement:* COL-12. *Behavior:* `colorize()` and
  `compute_semantic_tokens()` are timed over a 899-byte real fixture and a
  45 KB corpus (the same fixture repeated 50×) in release profile.
  *Oracle:* `criterion` benchmark output; no assertion beyond "the benchmark
  runs" — the published figures in `docs/topics/coloring/README.md`'s
  *Performance* section are read and updated by a human, not enforced by
  CI. *Evidence:* `crates/colorful-cli/benches/colorize_bench.rs`;
  `crates/colorful-lsp/benches/semantic_tokens_bench.rs`; `cargo bench -p
  colorful-cli`; `cargo bench -p colorful-lsp`. *Status:* implemented
  (measurement only — not yet a CI gate; see *Known gaps*).
- **COL-11a** — *Requirement:* COL-11. *Behavior:* a file containing invalid
  UTF-8 bytes is rejected by `colorful`, `ir`, `diagnose`, and `lint` alike,
  each exiting with `io::ErrorKind::InvalidData` and the message
  `stream did not contain valid UTF-8` -- never a silent lossy conversion.
  *Oracle:* exact error kind and message equality across all four commands.
  *Evidence:* `crates/colorful-cli/fixtures/invalid-utf8.bin`; `colorful-cli`
  `tests::invalid_utf8_file_is_rejected_across_every_command`. *Status:*
  implemented.
- **COL-19a** — *Requirement:* COL-19. *Behavior:* a workspace integration test
  starts the real `colorful` binary and exercises stdin, a committed file,
  invalid UTF-8, multiple operands, successful and finding-bearing exit
  statuses, `NO_COLOR`, and canonical IR output. *Oracle:* exact stdout,
  relevant stderr category, process status, and canonical-JSON byte equality.
  *Evidence type:* process-level integration test. *Evidence:*
  `colorful-cli` integration tests
  `binary_contract::stdin_file_no_color_and_canonical_ir_are_process_contracts`,
  `binary_contract::invalid_input_operands_and_lint_findings_have_stable_process_failures`,
  and `utf8_stdin::invalid_utf8_on_stdin_is_rejected_across_every_command`.
  *Tracking:*
  [#133](https://github.com/flyingrobots/colorful-language/issues/133).
  *Status:* implemented.
- **COL-13a** — *Requirement:* COL-13. *Behavior:* a workspace integration test
  starts the real `colorful-lsp` binary and exercises initialize, open, change,
  tokens, diagnostics, close, shutdown, and process failure. *Oracle:* exact
  JSON-RPC response/notification sequence, exit status, and final document
  version. *Evidence type:* process-level integration test. *Evidence:*
  `colorful-lsp` integration test
  `stdio_contract::real_server_completes_the_public_stdio_lifecycle`. *Tracking:*
  [#133](https://github.com/flyingrobots/colorful-language/issues/133).
  *Status:* implemented.
- **COL-14a** — *Requirement:* COL-14. *Behavior:* clean installed VS Code/Open
  VSX and Zed packages activate for Plain Text and Markdown, report a missing
  server, render semantic tokens and diagnostics, apply an incremental edit,
  shut down, and retain a readable fallback theme. *Oracle:* scripted transcript
  equality plus headless activation and visual/text-equivalent smoke oracles.
  *Evidence type:* packaged-editor integration test and reviewed visual
  artifact. *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  *Status:* planned.
- **COL-15a** — *Requirement:* COL-15. *Behavior:* a deterministic concurrency
  test forces an older computation to finish last while only the newest
  generation may publish diagnostics or tokens. *Oracle:* publication log
  contains only the latest generation; cancellation and stale-result counters
  match the forced schedule. *Evidence type:* deterministic async regression
  test. *Evidence:* `colorful-lsp` binary test
  `document_state::tests::older_computation_finishing_last_cannot_publish_or_replace_cache`
  and paused-time test
  `document_state::tests::rapid_edits_cancel_debounced_work_before_analysis`.
  *Tracking:*
  [#121](https://github.com/flyingrobots/colorful-language/issues/121).
  *Status:* implemented.
- **COL-15b** — *Requirement:* COL-15. *Behavior:* each accepted document
  generation is parsed and classified once, then the cached result supplies
  both its published diagnostics and its semantic-token response. *Oracle:* an
  instrumented analysis adapter records one invocation for the generation while
  both surfaces return the expected generation-keyed result. *Evidence type:*
  deterministic async regression test. *Evidence:* `colorful-lsp` tests
  `tests::one_analysis_parses_and_classifies_once_for_both_lsp_surfaces` and
  `document_state::tests::diagnostics_and_tokens_reuse_one_generation_analysis`.
  *Tracking:*
  [#121](https://github.com/flyingrobots/colorful-language/issues/121).
  *Status:* implemented.
- **COL-15c** — *Requirement:* COL-15. *Behavior:* documents through 5 MiB enter
  normal analysis, while a larger document bypasses the analyzer and yields
  empty semantic tokens plus one stable `colorful/document-too-large`
  diagnostic. *Oracle:* exact boundary, analyzer invocation count, diagnostic
  code, and empty-token equality. *Evidence type:* deterministic boundary test.
  *Evidence:* `colorful-lsp` binary test
  `document_state::tests::oversized_documents_bypass_analysis_with_stable_outputs`.
  *Tracking:*
  [#121](https://github.com/flyingrobots/colorful-language/issues/121).
  *Status:* implemented.
- **COL-16a** — *Requirement:* COL-16. *Behavior:* the real release-mode server
  runs one deterministic prose corpus at exactly 100 KiB, 1 MiB, 5 MiB, and
  10 MiB. Each scenario measures open-to-diagnostics, one cached
  semantic-token response, a single-character incremental change, and a burst
  of four further versioned single-character edits observed by four concurrent
  full-token requests. The supported envelope is one open document through
  5 MiB with no more than four simultaneous full-token requests. On the
  published reference host, accepted generations must publish latest
  diagnostics within 5 seconds of open or one edit, the overload burst must
  publish its latest diagnostics and answer all four requests within 8 seconds,
  cached tokens must answer within 2 seconds, maximum server-side analysis
  queue delay must stay below 250 ms, no stale generation may publish, and peak
  server RSS must stay below 1,536 MiB. A 10 MiB document is outside the
  supported envelope and must publish `colorful/document-too-large` with empty
  tokens within 1 second while staying below 512 MiB RSS. *Oracle:* a versioned
  JSON report records every duration, byte count, throughput, peak RSS, stable
  outcome category, cancellation/stale counters, corpus hash, hardware,
  operating system, profile, and exact Rust/Node toolchains; deterministic
  tests validate the report shape and supported-envelope verdict without
  rerunning its wall-clock measurements in CI. *Evidence type:* release
  benchmark, process metrics report, and deterministic report-contract test.
  *Evidence:* `colorful-lsp` example `lsp_envelope`,
  `crates/colorful-lsp/benchmarks/lsp-envelope-baseline.json`, and integration
  tests `stdio_contract::server_metrics_use_a_stable_versioned_contract` and
  `lsp_envelope_report::baseline_covers_the_reviewed_supported_envelope`.
  *Tracking:*
  [#122](https://github.com/flyingrobots/colorful-language/issues/122).
  *Status:* implemented.
- **COL-17a** — *Requirement:* COL-17. *Behavior:* one release-mode stage
  harness measures parsing, contextual annotation, lint analysis, IR
  projection, canonical serialization, and fail-closed IR validation
  independently over the committed 899-byte editor sample and 45-KB repeated
  corpus already used by COL-12a. Each stage consumes the prior stage's
  prepared output when setup is not part of the boundary being measured.
  *Oracle:* every stage and corpus pair reports elapsed time, input bytes,
  throughput, allocation count, and allocated bytes without failing on a
  wall-clock value. *Evidence type:* release benchmark harness and published
  baseline. *Evidence:* `colorful-cli` example `cross_stage_benchmark` and
  `crates/colorful-cli/benchmarks/cross-stage-baseline.json`. *Tracking:*
  [#135](https://github.com/flyingrobots/colorful-language/issues/135).
  *Status:* implemented.
- **COL-17b** — *Requirement:* COL-17. *Behavior:* the cross-stage benchmark
  baseline identifies its schema version, corpus hashes, benchmark date,
  hardware, operating system, Rust toolchain, profile, sample count, and exact
  source commit, and carries reviewed advisory latency and allocation
  tolerances; throughput remains deterministically derived from input bytes and
  latency. *Oracle:* deterministic tests reject missing, duplicated,
  stale-corpus, non-finite, or self-inconsistent measurements and assert that
  tolerance policy remains advisory rather than a correctness-CI timing gate.
  *Evidence type:* versioned JSON report and report-contract test.
  *Evidence:* `colorful-cli` integration test
  `cross_stage_benchmark_report::cross_stage_benchmark_report_is_complete_and_advisory`.
  *Tracking:*
  [#135](https://github.com/flyingrobots/colorful-language/issues/135).
  *Status:* implemented.
- **COL-17c** — *Requirement:* COL-17. *Behavior:* the benchmark matrix links
  semantic-token generation to COL-12a, incremental editing and concurrent LSP
  work to COL-16a, and Graft projection to CONSUMER-3d instead of reimplementing
  those authoritative harnesses. *Oracle:* a deterministic matrix-completeness
  test requires exactly one named authority for parsing, annotation, lint, IR
  projection, IR serialization, IR validation, semantic tokens, incremental
  edits, and Graft projection. *Evidence type:* benchmark-matrix manifest and
  contract test. *Evidence:* the `authorities` section of
  `crates/colorful-cli/benchmarks/cross-stage-baseline.json` and
  `cross_stage_benchmark_report::cross_stage_benchmark_report_is_complete_and_advisory`.
  *Tracking:*
  [#135](https://github.com/flyingrobots/colorful-language/issues/135).
  *Status:* implemented.
- **COL-17d** — *Requirement:* COL-17. *Behavior:* the mandatory borrowed
  classification-validation boundary runs separately over each fixed corpus
  after parsing and annotation, without charging repeated-input cloning to the
  validator. *Oracle:* the cross-stage report requires one latency, throughput,
  and allocation row for `classification-validation` per corpus. *Evidence
  type:* release benchmark stage and deterministic report-contract assertion.
  *Tracking:*
  [#135](https://github.com/flyingrobots/colorful-language/issues/135).
  *Evidence:* `cross_stage_support::Stage::ClassificationValidation`;
  `crates/colorful-cli/benchmarks/cross-stage-baseline.json`;
  `cross_stage_benchmark_report::cross_stage_benchmark_report_is_complete_and_advisory`.
  *Status:* implemented.
- **COL-17e** — *Requirement:* COL-17. *Behavior:* the cross-stage benchmark
  derives its allocation-counter name and version from exactly one resolved
  `stats_alloc` package reported by locked, offline Cargo metadata instead of a
  hand-maintained string. *Oracle:* malformed metadata and missing, duplicated,
  empty, or stale profiler identities fail closed; changing the resolved
  version without regenerating the committed report fails deterministically.
  The packaged report-contract test remains runnable against its generated
  lockfile, while timing/allocation report regeneration remains a clean
  workspace operation. *Evidence type:* pure metadata mutation tests, packaged
  integration contract, and release benchmark metadata. *Tracking:*
  [#207](https://github.com/flyingrobots/colorful-language/issues/207).
  *Evidence:* planned. *Status:* planned.
- **COL-18a** — *Requirement:* COL-18. *Behavior:* a bounded seeded corpus
  generates valid Unicode plus malformed public trees and IR mutations and
  exercises parser, annotator, projection, validation, and UTF-16 indexing.
  Every generated source includes at least one chosen character-boundary
  finding span so the CLI's 1-based scalar column and the LSP's 0-based UTF-16
  range can be compared with an independent oracle. *Oracle:* no panic; legal
  ordered ranges and source round-trip for accepted data; exact typed
  rejection for malformed data across all nine public `ClassificationError`
  variants; CLI/LSP line parity and their documented scalar-versus-UTF-16
  column relationship. *Evidence type:* seeded property tests, fuzz targets,
  and a 256-case deterministic CI corpus. *Evidence:*
  `crates/colorful-cli/tests/property_boundaries.rs`; all four targets under
  `fuzz/fuzz_targets/`; `scripts/check-property-fuzz-policy.mjs`; the explicit
  `property_boundaries` command in `.github/workflows/ci.yml`. *Tracking:*
  [#134](https://github.com/flyingrobots/colorful-language/issues/134).
  *Status:* implemented.
- **COL-20a** — *Requirement:* COL-20. *Behavior:* the pure core constructs a
  `ValidatedClassification` only when the tree has the documented shape; every
  tree and token span is ordered, in bounds, on a UTF-8 character boundary,
  and ordered without overlap among siblings; child ranges stay inside their
  sentence; and classified token spans correspond one-for-one with tree leaves.
  Validation runs in deterministic tree, token, then correspondence order and
  returns the first typed `ClassificationError` with an exact structural path.
  The LSP analysis entry points consume this aggregate and propagate the same
  typed error without producing partial diagnostics or semantic tokens.
  *Oracle:* one custom-port mutation per invariant returns the exact error
  variant and path; valid built-in ports retain their current output.
  *Evidence type:* core aggregate unit tests and LSP custom-port contract tests.
  *Evidence:* `colorful-core`
  `tests::validated_classification_{preserves_valid_built_in_shape,
  rejects_an_unexpected_root_kind,rejects_a_reversed_tree_span,
  rejects_an_out_of_bounds_tree_span,rejects_an_unsorted_tree_sibling,
  rejects_an_overlapping_tree_sibling,rejects_a_child_outside_its_sentence,
  rejects_a_mid_code_point_token_span,rejects_an_unsorted_token,
  rejects_an_overlapping_token,rejects_a_tree_token_count_mismatch,
  rejects_a_tree_token_span_mismatch}`; `colorful-lsp`
  `tests::analyze_document_propagates_a_custom_annotators_typed_span_error`;
  `colorful-cli` `tests::passthrough_when_color_disabled` and
  `tests::golden_colored_output`.
  *Tracking:*
  [#142](https://github.com/flyingrobots/colorful-language/issues/142).
  *Status:* implemented.
- **COL-21a** — *Requirement:* COL-21. *Behavior:* a public `Annotator`
  implementation classifies a parsed tree in a compiled rustdoc example.
  *Oracle:* `cargo test --doc --workspace` compiles and runs the example with an
  exact token-class assertion. *Evidence type:* public API doctest. *Evidence:*
  `colorful-core` `Annotator` rustdoc and
  `scripts/check-public-api-doctests.mjs`. *Tracking:*
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  *Status:* implemented.

## Known gaps

- Packaged-editor activation around the proven server handshake remains manual
  until COL-14a lands.
- The title-case proper-noun guard is heuristic: a short capitalized line with no
  lowercase content word (for example `I am Groot`) can be read as a title and
  suppress a genuine proper noun. Accepted in `v0` as the conservative direction.
- The COL-12 performance budget (16 ms up to ~50 KB) is documented but not
  CI-enforced: one machine's first measurement is not a stable baseline, and
  benchmark timing on shared CI runners is noisy enough that a hard gate
  today would fail on infrastructure variance, not real regressions. Wire it
  into CI once a run of stable baselines exists. The guarded canonical IR path
  used by `colorful ir` and `colorful diagnose --json` is outside COL-12's two
  measured functions, so COL-12's 16 ms budget does not apply to that combined
  command path. COL-17a measures guarded IR projection including the producer's
  mandatory validation postcondition and separately measures validation over
  prepared IR. COL-16a measures the production `analyze_document()` plus
  `DocumentStore` scheduling, queueing, caching, publication, JSON-RPC, and
  peak-RSS path. The standalone `compute_diagnostics()` helper is not
  benchmarked, but it is not the `didChange` handler.
