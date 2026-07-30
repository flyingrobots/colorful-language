# Editor integrations test plan

Verification for editor adapters and the `colorful-lsp` surface.

## Requirements

- **EDIT-1** One `colorful-lsp` engine serves every editor integration.
- **EDIT-2** Semantic tokens use the shared vocabulary manifest and the LSP
  legend.
- **EDIT-3** Lint findings are published as LSP diagnostics.
- **EDIT-4** Source editor integrations compile in CI; the VS Code extension
  keeps TypeScript strict mode and dependency declaration checking enabled.
- **EDIT-5** Editor recipe docs stay honest about source installs,
  marketplace status, and theme caveats.
- **EDIT-6** Zed Plain Text highlighting requires semantic tokens and a
  resolvable `colorful-lsp` binary, with theme rules for Colorful-owned token
  types.
- **EDIT-7** VS Code Plain Text highlighting should work from the source
  extension without user semantic-token setup beyond a resolvable
  `colorful-lsp` binary, and startup failures must be inspectable.
- **EDIT-8** Packaged editor artifacts must pass a clean-install JSON-RPC and
  activation smoke test for Plain Text and Markdown, including theme fallback.
- **EDIT-9** Editor adapter and server version ownership must be explicit and
  enforced by a deterministic compatibility-drift check.
- **EDIT-10** Public editor releases must be signed, installable from real
  registry URLs, reversible, visually demonstrable without color-only evidence,
  and measured from installation to first highlight.
- **EDIT-11** The real `colorful-lsp` binary must expose a deterministic stdio
  JSON-RPC lifecycle independently of any editor adapter.
- **EDIT-12** The shared LSP server must publish only the newest document
  generation, reuse that generation's cached analysis for diagnostics and
  semantic tokens, and fail predictably beyond its documented size limit.
- **EDIT-13** The locked VS Code runtime dependency graph must exclude known
  high- and critical-severity advisory ranges, and the extension's declared
  VS Code floor must satisfy the language client's runtime requirement.
- **EDIT-14** A bounded seeded Unicode corpus must prove that the CLI human
  location and LSP UTF-16 range map to the same finding start, and that the LSP
  range maps the complete selected span, across astral code points, combining
  marks, zero-width characters, and mixed line endings.
- **EDIT-15** Markdown analysis must exclude reviewed non-prose syntax regions
  through one coordinate-preserving format adapter outside `colorful-core`,
  while Plain Text keeps the existing whole-document behavior.
- **EDIT-16** The VS Code extension's ambient Node declarations must not exceed
  the Node major provided by its minimum supported extension host, and
  dependency automation must preserve that compatibility boundary.

## Cases

- **EDIT-1a** — *Requirement:* EDIT-1. *Behavior:* the VS Code extension starts
  `colorful-lsp` over stdio instead of reimplementing analysis. *Oracle:*
  extension source review and TypeScript compile. *Evidence:*
  `editors/vscode/src/extension.ts`; `.github/workflows/ci.yml` editor job.
  *Status:* implemented.
- **EDIT-1b** — *Requirement:* EDIT-1. *Behavior:* the Zed extension delegates
  to `colorful-lsp`. *Oracle:* extension build succeeds for `wasm32-wasip1`.
  *Evidence:* `.github/workflows/ci.yml` editor job. *Status:* implemented.
- **EDIT-2a** — *Requirement:* EDIT-2. *Behavior:* semantic-token output follows
  the vocabulary-backed legend, including the open-class token types when the
  classifier emits them. *Oracle:* Rust assertions. *Evidence:*
  `crates/colorful-lsp/src/lib.rs`; `docs/topics/coloring/test-plan.md`.
  *Status:* implemented for the server surface.
- **EDIT-2b** — *Requirement:* EDIT-2. *Behavior:* for `"The cat is 3."`, only
  the opening and closing quotation marks get the `string` token type; each
  enclosed word keeps its own role (keyword, noun, keyword, number) exactly as
  the unquoted sentence does — the quoted span is never collapsed into one
  `string` token. *Oracle:* exact semantic-token vector equality, including
  delta encoding. *Evidence:* `crates/colorful-lsp/src/lib.rs`
  `tests::quote_marks_are_string_role_and_enclosed_words_keep_their_own_role`.
  *Status:* implemented.
- **EDIT-3a** — *Requirement:* EDIT-3. *Behavior:* lint findings become LSP
  diagnostics with ranges, severity, source, and rule code. *Oracle:* Rust
  assertions. *Evidence:* `crates/colorful-lsp/src/main.rs`;
  `docs/topics/linting/test-plan.md`. *Status:* implemented.
- **EDIT-11a** — *Requirement:* EDIT-11. *Behavior:* a workspace integration
  test starts the real `colorful-lsp` process and exchanges initialize,
  initialized, open, diagnostics, incremental change, semantic tokens, close,
  shutdown, and exit messages over stdio. *Oracle:* JSON-RPC IDs, capabilities,
  diagnostic document versions, semantic-token data, empty close diagnostics,
  and final process status. *Evidence type:* process-level integration test.
  *Evidence:* `crates/colorful-lsp/tests/stdio_contract.rs`
  `real_server_completes_the_public_stdio_lifecycle`. *Tracking:*
  [#133](https://github.com/flyingrobots/colorful-language/issues/133).
  *Status:* implemented.
- **EDIT-12a** — *Requirement:* EDIT-12. *Behavior:* rapid incremental edits
  cancel pending work; if already-running old work finishes after the current
  generation, it cannot publish or replace the current diagnostics or semantic
  tokens. *Oracle:* a forced completion schedule publishes only the newest
  generation and exposes exact cancellation/stale counters. *Evidence type:*
  deterministic async regression test. *Evidence:* `colorful-lsp` binary test
  `document_state::tests::older_computation_finishing_last_cannot_publish_or_replace_cache`
  and paused-time test
  `document_state::tests::rapid_edits_cancel_debounced_work_before_analysis`.
  *Tracking:*
  [#121](https://github.com/flyingrobots/colorful-language/issues/121).
  *Status:* implemented.
- **EDIT-12b** — *Requirement:* EDIT-12. *Behavior:* diagnostics and semantic
  tokens consume one generation-keyed cached analysis, and inputs above the
  documented 5 MiB limit return a stable overload diagnostic rather than
  entering analysis. *Oracle:* exact analysis invocation count, cache
  generation, boundary behavior, diagnostic code, and semantic-token result.
  *Evidence type:* deterministic state and boundary tests. *Evidence:*
  `colorful-lsp` tests
  `tests::one_analysis_parses_and_classifies_once_for_both_lsp_surfaces`,
  `document_state::tests::diagnostics_and_tokens_reuse_one_generation_analysis`,
  and
  `document_state::tests::oversized_documents_bypass_analysis_with_stable_outputs`.
  *Tracking:*
  [#121](https://github.com/flyingrobots/colorful-language/issues/121).
  *Status:* implemented.
- **EDIT-4a** — *Requirement:* EDIT-4. *Behavior:* source editor integrations
  compile on every PR; the VS Code `tsconfig.json` sets both `strict: true` and
  `skipLibCheck: false`, so incompatible dependency declarations cannot hide
  behind a workspace-wide suppression. *Oracle:* CI editor job exits zero.
  *Evidence:* `editors/vscode/tsconfig.json`; `npm --prefix editors/vscode run
  compile`; `.github/workflows/ci.yml`. *Status:* implemented.
- **EDIT-13a** — *Requirement:* EDIT-13. *Behavior:* the VS Code extension uses
  a stable `vscode-languageclient` release outside the vulnerable
  `brace-expansion <=5.0.7` dependency chain, and its declared editor floor
  satisfies the client's declared VS Code engine. *Oracle:* deterministic
  lockfile-policy mutations reject the vulnerable client and leaf versions or
  an incompatible editor floor; a pinned-Node `npm audit --audit-level=high`
  exits zero. *Evidence type:* lockfile policy self-test, editor compile, and
  network-backed advisory audit. *Evidence:*
  `scripts/check-vscode-dependency-policy.mjs`,
  `scripts/check-vscode-dependency-policy.test.mjs`,
  `editors/vscode/package.json`, `editors/vscode/package-lock.json`, and the
  editor CI job. *Tracking:*
  [#185](https://github.com/flyingrobots/colorful-language/issues/185).
  *Status:* implemented.
- **EDIT-16a** — *Requirement:* EDIT-16. *Behavior:* one reviewed runtime policy
  binds the extension's minimum VS Code release and host Node line to the
  `@types/node` manifest range, locked major, exact package-smoke download, and
  Dependabot update policy. Supported Node 20 declaration updates remain
  admissible, while a Node 21-or-newer proposal equivalent to Dependabot PR
  #195 fails with a stable policy category before it can enter the shipping
  graph. TypeScript keeps `strict: true` and `skipLibCheck: false`. *Oracle:*
  deterministic mutations of each policy input reject drift, the supported
  fixture passes, TypeScript compiles, and the isolated VS Code 1.91.0 package
  smoke retains its existing host boundary. *Evidence type:* dependency-policy
  self-test, editor compile, and package-smoke policy test. *Tracking:*
  [#267](https://github.com/flyingrobots/colorful-language/issues/267).
  *Evidence:* `editors/vscode/runtime-policy.json`;
  `scripts/check-vscode-dependency-policy.mjs`;
  `scripts/check-vscode-dependency-policy.test.mjs` tests `rejects Node 26
  declarations for the VS Code 1.91 host`, `rejects a locked Node declaration
  major outside the host line`, `rejects a runtime policy that drifts from the
  extension floor`, `rejects Dependabot policy without the Node declaration
  major guard`, `rejects weakened TypeScript declaration checking`, and
  `rejects current editor documentation that drifts from host policy`, plus
  `rejects a documented Node declaration major outside the host line`;
  `scripts/check-editor-package-smoke.test.mjs`; and
  `editors/vscode/smoke/run-packaged-smoke.mjs`. *Status:* implemented.
- **EDIT-14a** — *Requirement:* EDIT-14. *Behavior:* a generated valid-Unicode
  prefix and selected source span are emitted once as a CLI finding and once as
  an LSP diagnostic. The corpus is bounded to 256 cases under one checked-in
  seed and guarantees astral, combining, zero-width, `LF`, `CR`, and `CRLF`
  coverage. *Oracle:* the CLI start location and LSP range start resolve to the
  same zero-based line and selected byte offset; CLI columns equal Unicode
  scalar counts plus one, while both LSP range endpoints equal their UTF-16
  code-unit counts. *Evidence type:* cross-surface seeded property test and
  coordinate fuzz target. *Evidence:*
  `crates/colorful-cli/tests/property_boundaries.rs`
  `seeded_property_boundaries_hold_for_each_generated_case` and
  `fuzz/fuzz_targets/coordinates.rs`. *Tracking:*
  [#134](https://github.com/flyingrobots/colorful-language/issues/134).
  *Status:* implemented.
- **EDIT-5a** — *Requirement:* EDIT-5. *Behavior:* recipe docs state that
  marketplace packages are not published and that custom open-class token types
  may need theme rules. *Oracle:* documentation review. *Evidence:*
  `README.md`; `editors/README.md`; `docs/topics/editor-integrations/README.md`.
  *Status:* implemented.
- **EDIT-6a** — *Requirement:* EDIT-6. *Behavior:* the Zed source extension can
  use `lsp.colorful-lsp.binary.path` when present and otherwise falls back to
  resolving `colorful-lsp` from `PATH`; it maps Zed **Plain Text** to LSP
  language ID `plaintext`; the Zed README documents
  `"semantic_tokens": "full"` for **Plain Text** and **Markdown** buffers plus
  `global_lsp_settings.semantic_token_rules` for Colorful-owned `noun`, `verb`,
  `adjective`, and `adverb` token types.
  *Oracle:* extension build succeeds and documentation states these conditions.
  *Evidence:* `editors/zed/extension.toml`; `editors/zed/src/lib.rs`;
  `editors/zed/README.md`; `cargo build --manifest-path editors/zed/Cargo.toml --target wasm32-wasip1`;
  `markdownlint-cli2 "docs/topics/**/*.md" "editors/zed/README.md"`.
  *Status:* implemented.
- **EDIT-7a** — *Requirement:* EDIT-7. *Behavior:* the VS Code source extension
  declares the Colorful-owned open-class semantic token types, enables semantic
  highlighting for **Plain Text** and **Markdown**, maps custom token types to
  fallback TextMate scopes, and exposes a **Colorful Language** output channel
  with the selected `colorful-lsp` command and startup failures. *Oracle:*
  TypeScript compile and source review. *Evidence:* `editors/vscode/package.json`;
  `editors/vscode/src/extension.ts`; `editors/vscode/README.md`;
  `npm --prefix editors/vscode run compile`. *Status:* implemented.
- **EDIT-8a** — *Requirement:* EDIT-8. *Behavior:* one checked-in JSON-RPC
  transcript drives the real `colorful-lsp` binary through initialize,
  initialized, open, diagnostics, semantic tokens, one incremental change,
  changed diagnostics and tokens, close, shutdown, and exit for both
  `plaintext` and `markdown`. *Oracle:* exact response IDs, language IDs,
  diagnostic versions and contents, semantic-token result IDs and non-empty
  five-scalar records, empty close diagnostics, and zero process status.
  *Evidence type:* process-level integration test backed by a JSON fixture.
  *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  *Evidence:*
  `crates/colorful-lsp/tests/fixtures/editor_lifecycle_transcript.json`;
  `crates/colorful-lsp/tests/stdio_contract.rs`
  `real_server_completes_the_public_stdio_lifecycle`. *Status:* implemented.
- **EDIT-8b** — *Requirement:* EDIT-8. *Behavior:* one VSIX is built for both
  VS Code Marketplace and Open VSX, installed with the pinned minimum supported
  VS Code CLI into empty user-data and extensions directories, and exercised
  from a separate Extension Host smoke harness. The installed adapter activates
  for Plain Text and Markdown, starts the matching real `colorful-lsp`, exposes
  semantic tokens and diagnostics before and after an incremental edit, and
  carries exact fallback TextMate scope mappings. A second isolated launch with
  a missing server path must leave the stable startup-failure category in
  persisted editor logs.
  *Oracle:* installed extension ID/version and packaged manifest equality,
  activation state, diagnostic ranges and counts, fallback-scope equality,
  missing-server log category, and zero Extension Host status. The Open VSX
  witness must consume the same VSIX path and digest rather than rebuilding it.
  *Evidence type:* VSIX inventory test and pinned headless VS Code clean-install
  smoke test. *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  *Evidence:* `editors/vscode/smoke/run-packaged-smoke.mjs`;
  `editors/vscode/smoke/suite/index.cjs`;
  `scripts/check-editor-package-smoke.test.mjs`;
  `npm --prefix editors/vscode run smoke:package`; `.github/workflows/ci.yml`.
  *Status:* implemented.
- **EDIT-8c** — *Requirement:* EDIT-8. *Behavior:* the Zed registry-source
  package is staged into an empty directory, preserves its manifest identity,
  language IDs, source, lockfile, and accepted license, and compiles there to
  `wasm32-wasip1`. The adapter exposes the stable missing-server guidance.
  Because Zed provides only the interactive **Install Dev Extension** action,
  actual clean-profile activation and fallback rendering follow an exact manual
  oracle for Plain Text and Markdown. *Oracle:* exact staged inventory and
  manifest fields, successful isolated Wasm build, source error-category
  equality, and a reviewed text-equivalent manual result covering activation,
  diagnostics, semantic tokens, incremental edits, shutdown, and readable
  fallback roles. *Evidence type:* isolated registry-source package smoke test
  plus documented manual host oracle. *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  *Evidence:* `scripts/stage-zed-extension.mjs`;
  `editors/fixtures/editor-smoke.txt`;
  `editors/fixtures/editor-smoke.md`;
  `editors/fixtures/theme-fallback.txt`;
  `editors/fixtures/theme-fallback.md`;
  `npm --prefix editors/vscode run smoke:package`; the manual oracle below.
  *Status:* planned; the automated package and Wasm legs pass, but the manual
  host result has not been recorded.
- **EDIT-9a** — *Requirement:* EDIT-9. *Behavior:* the chosen synchronized or
  independent adapter version policy declares compatible `colorful-lsp`
  versions and detects unintended manifest drift. The synchronized policy
  requires the Cargo workspace, VS Code manifest and lockfile root, Zed
  extension manifest, and standalone Zed crate and lockfile entry to carry one
  stable release version. For `0.Y.Z`, the compatible server range is
  `>=0.Y.0 <0.(Y+1).0`. *Oracle:* every version source equals the workspace
  version; a deliberate source mismatch, prerelease, or next-minor server
  version makes the deterministic policy check fail. *Evidence type:*
  manifest-policy checker and mutation tests. *Tracking:*
  [#141](https://github.com/flyingrobots/colorful-language/issues/141).
  *Evidence:* `scripts/check-editor-version-policy.test.mjs`
  `the synchronized policy derives the same pre-1.0 minor range`,
  `same-minor stable servers are compatible and breaking minors are not`,
  `source editor install guidance selects the synchronized checkout`,
  `rejects disagreement between both npm lockfile version fields`,
  `derives a future synchronized minor without a policy-code edit`,
  `treats the workspace manifest as the synchronized version authority`, the
  per-source drift and prerelease mutation cases, and
  `the checked-in repository satisfies the policy`.
  *Status:* implemented.
- **EDIT-9b** — *Requirement:* EDIT-9. *Behavior:* the release profile lists
  every synchronized editor version source, records the same-minor
  `colorful-lsp` compatibility rule and unsupported-prerelease policy, and
  wires the deterministic check into pull-request CI, release preparation, and
  tag publication. *Oracle:* policy mutations reject a missing version source,
  a different strategy or compatibility rule, and a missing gate command.
  *Evidence type:* release-profile and workflow mutation tests. *Tracking:*
  [#141](https://github.com/flyingrobots/colorful-language/issues/141).
  *Evidence:* `.continuum/release.yml`;
  `scripts/check-editor-version-policy.test.mjs`
  `rejects compatibility and prerelease policy drift`,
  `rejects missing, duplicated, unexpected, or reordered version sources`,
  `accepts version-source mappings with reordered fields`,
  `parses release policy independently of YAML layout`,
  `rejects missing policy wiring in every release gate`, and
  `requires policy dependencies before the checker in every release gate`;
  `.github/workflows/ci.yml`; `.github/workflows/release.yml`;
  `scripts/release-prep.sh`. *Status:* implemented.
- **EDIT-10a** — *Requirement:* EDIT-10. *Behavior:* signed VS Code/Open VSX and
  Zed releases plus compatible Linux x86-64, Apple Silicon, and Windows x86-64
  server binaries publish at real URLs, install on a clean machine, and roll
  back to the previous compatible set. One smoke-tested VSIX supplies both
  VS Code registries; each binary archive and the VSIX carry a SHA-256 identity
  and GitHub/Sigstore provenance. *Oracle:* registry/release URL resolution,
  provenance and checksum verification, activation, semantic-token/diagnostic
  output, and rollback result equality.
  *Evidence type:* signed release witness and clean-machine matrix. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Status:* planned.
- **EDIT-10b** — *Requirement:* EDIT-10. *Behavior:* publication evidence
  includes a text-equivalent visual demo and install-to-first-highlight timing
  without making host-dependent timing a correctness gate. *Oracle:* the demo
  exposes the expected roles in text and pixels with at least 4.5:1 custom-role
  contrast; the timing witness names hardware, toolchain, package versions,
  start/stop events, and no correctness threshold. *Evidence type:* accessible
  visual artifact and observational package witness. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Evidence:*
  `docs/topics/editor-integrations/assets/semantic-role-demo.svg`;
  `docs/topics/editor-integrations/README.md`;
  `editors/vscode/smoke/timing-witness.mjs`;
  `editors/vscode/smoke/run-packaged-smoke.mjs`;
  `scripts/check-editor-package-smoke.test.mjs`
  `installation timing is ordered observational evidence` and
  `the visual demo has a text-equivalent accessible role mapping`. *Status:*
  implemented.
- **EDIT-10c** — *Requirement:* EDIT-10. *Behavior:* the public release witness
  records a reviewed theme/fallback result and the observational
  install-to-first-highlight measurement from a clean installation of the
  published bytes, including the exact public URLs and environment. *Oracle:*
  the public VSIX digest equals the smoke witness; expected roles and
  diagnostics appear; timing event order and environment are complete.
  *Evidence type:* public registry metadata, clean-machine visual review, and
  release witness. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Intended evidence:* the version-specific
  `docs/goalposts/vX.Y.Z/release.md` and
  `docs/goalposts/vX.Y.Z/verification.md` release packet after public
  publication.
  *Status:* planned.
- **EDIT-15a** — *Requirement:* EDIT-15. *Behavior:* a Markdown document with
  one prose weak word and the same sentence inside a fenced code block emits
  exactly one `weak-word` diagnostic at the prose span; the fenced sentence
  emits no prose semantic roles, and a role after the fence retains its exact
  source coordinate. *Oracle:* exact diagnostic count/code/range and decoded
  semantic-token ranges. *Evidence type:* deterministic Rust unit and real-LSP
  transcript tests plus the packaged Markdown fixture. *Tracking:*
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  *Evidence:* `colorful-lsp` test
  `tests::markdown_analysis_excludes_fenced_code_from_both_lsp_surfaces`;
  `crates/colorful-lsp/tests/fixtures/editor_lifecycle_transcript.json`;
  `crates/colorful-lsp/tests/stdio_contract.rs`
  `real_server_completes_the_public_stdio_lifecycle`;
  `editors/fixtures/editor-smoke.md`; packaged VS Code smoke. *Status:*
  implemented.
- **EDIT-15b** — *Requirement:* EDIT-15. *Behavior:* inline code, indented code
  blocks, opening YAML/TOML front matter, link destinations, and HTML blocks are
  non-prose; link labels and ordinary text remain prose. Unterminated inline
  code and front-matter delimiters remain prose rather than suppressing the
  remainder of the document. *Oracle:* an adversarial table asserts every
  excluded byte range, every retained prose range, and byte/UTF-16 coordinate
  equality after ASCII, combining-mark, BMP, and astral content. *Evidence
  type:* pure format-adapter unit tests. *Tracking:*
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  *Evidence:* `colorful-parse` Markdown tests
  `fenced_code_is_masked_while_surrounding_prose_is_unchanged`,
  `reviewed_markdown_regions_have_explicit_suppression_decisions`,
  `link_labels_remain_prose_while_destinations_are_suppressed`,
  `nested_and_reference_link_destinations_are_suppressed`,
  `duplicate_reference_definitions_are_all_suppressed`,
  `quoted_link_titles_do_not_confuse_destination_boundaries`,
  `destination_masking_follows_commonmark_admission`,
  `inline_html_markup_is_suppressed_but_its_text_remains_prose`,
  `unterminated_constructs_do_not_hide_the_rest_of_the_document`, and
  `masking_preserves_byte_and_utf16_coordinates_after_unicode`, and
  `masking_preserves_coordinates_across_scalar_widths_and_line_endings`.
  *Status:* implemented.
- **EDIT-15c** — *Requirement:* EDIT-15. *Behavior:* LSP `languageId:
  "markdown"` and CLI `.md`/`.markdown` lint and ANSI file inputs use the same
  format adapter; stdin, public string colorization helpers, and non-Markdown
  files remain Plain Text unless a future explicit format option is introduced.
  *Oracle:* the same source produces the same finding byte span and human/LSP
  line under both diagnostic surfaces, while the default CLI styles prose but
  leaves excluded source bytes unchanged. A `.txt` control still analyzes
  code-looking text. *Evidence type:* cross-surface process and unit fixtures.
  *Tracking:*
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  *Evidence:* `colorful-cli` tests
  `cli::tests::markdown_lint_matches_lsp_prose_regions_while_plain_text_stays_whole_document`,
  `cli::tests::file_format_detection_is_extension_bounded_and_case_insensitive`,
  and
  `binary_contract::markdown_file_colorization_excludes_non_prose_regions`;
  `crates/colorful-lsp/tests/fixtures/editor_lifecycle_transcript.json`;
  `crates/colorful-lsp/tests/stdio_contract.rs`
  `real_server_completes_the_public_stdio_lifecycle`. *Status:* implemented.
- **EDIT-15d** — *Requirement:* EDIT-15. *Behavior:* the server stores the
  `didOpen` language identifier with the document generation and preserves that
  format across incremental edits, stale-result rejection, cached diagnostics,
  and cached semantic-token responses. *Oracle:* forced generation tests prove
  one accepted Markdown analysis per generation and unchanged Plain Text
  behavior. *Evidence type:* deterministic document-state tests. *Tracking:*
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  *Evidence:* `colorful-lsp` binary test
  `document_state::tests::incremental_generations_preserve_the_opened_document_format`
  plus the existing stale-completion, cache-reuse, debounce, and limit tests.
  *Status:* implemented.
- **EDIT-15e** — *Requirement:* EDIT-15. *Behavior:* block exclusions separate
  the prose contexts on either side, and a source view with incompatible byte,
  line, or UTF-16 coordinates fails closed before semantic-token or diagnostic
  projection. *Oracle:* a passive-voice candidate cannot bridge a fenced block;
  an incompatible synthetic view emits no tokens and one stable
  `colorful/invalid-source-view` diagnostic. *Evidence type:* deterministic LSP
  unit tests. *Tracking:*
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  *Evidence:* `colorful-lsp` tests
  `tests::markdown_blocks_separate_surrounding_prose_contexts` and
  `tests::incompatible_analysis_coordinates_fail_closed_before_projection`.
  *Status:* implemented.

## Zed clean-profile manual oracle

Zed exposes an interactive **Install Dev Extension** action but no supported
headless install command. The portable gate therefore stages the exact
registry-source inventory in `target/editor-smoke/zed-source`, validates its
identity and accepted license, and builds its Wasm in isolation. Use this
manual oracle for the remaining editor-host surface.

> [!WARNING]
> The package smoke downloads and caches VS Code 1.91.0, compiles release
> binaries, and replaces any existing ignored evidence under
> `target/editor-smoke/`.

From the repository root:

```bash
npm --prefix editors/vscode ci
npm --prefix editors/vscode run smoke:package
profile_dir="$(mktemp -d)"
zed_bin="$(command -v zed)"
PATH=/usr/bin:/bin "$zed_bin" --user-data-dir "$profile_dir" editors/fixtures
```

In that clean Zed profile:

1. Run **zed: install dev extension** and select
   `target/editor-smoke/zed-source`.
2. Set `lsp.colorful-lsp.binary.path` to the absolute
   `target/release/colorful-lsp` path.
3. Enable `"semantic_tokens": "full"` and copy the reviewed
   `global_lsp_settings.semantic_token_rules` block from
   `editors/zed/README.md`.
4. Open `editor-smoke.txt` and `editor-smoke.md`. Both must select **Plain
   Text** or **Markdown**, respectively, and show exactly one `weak-word`
   diagnostic over `really`, UTF-16 characters 11 through 17.
5. Replace `really` with `plain`. The diagnostic must disappear without
   reopening the buffer.
6. Open `theme-fallback.txt` and `theme-fallback.md`. The text-equivalent
   fallback result is: `The` as `keyword`, `cat` as `noun`, `writes` as `verb`,
   `careful` as `adjective`, `prose` unstyled, and `quickly` as `adverb`.
7. Remove `lsp.colorful-lsp.binary.path` and restart the language server.
   Because the clean host started without the Cargo binary directory on
   `PATH`, Zed's log must contain `[colorful/server-not-found]`.
8. Close the clean-profile window. No `colorful-lsp` process started from
   `target/release/colorful-lsp` may remain.

Record pass/fail, operating system, Zed version, and observed role names. A
screenshot may supplement that record, but it does not replace the
text-equivalent result in step 6.

## Open verification gaps

- Zed host activation remains the documented manual oracle in EDIT-8c until Zed
  exposes a supported headless dev-extension installation surface.
- Signed publication, rollback, visual/theme evidence, and measured
  install-to-first-highlight time remain open in EDIT-10a and EDIT-10b.
- A shipped theme remains a planned artifact. Theme fallback belongs in #136;
  create a separate topic and fixtures only when Colorful owns an actual theme
  package, not as an empty documentation surface.
