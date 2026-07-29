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
  *Status:* planned.
- **EDIT-8b** — *Requirement:* EDIT-8. *Behavior:* one VSIX is built for both
  VS Code Marketplace and Open VSX, installed with the pinned minimum supported
  VS Code CLI into empty user-data and extensions directories, and exercised
  from a separate Extension Host smoke harness. The installed adapter activates
  for Plain Text and Markdown, starts the matching real `colorful-lsp`, exposes
  diagnostics before and after an incremental edit, and carries exact fallback
  TextMate scope mappings. A second isolated launch with a missing server path
  must leave the stable startup-failure category in persisted editor logs.
  *Oracle:* installed extension ID/version and packaged manifest equality,
  activation state, diagnostic ranges and counts, fallback-scope equality,
  missing-server log category, and zero Extension Host status. The Open VSX
  witness must consume the same VSIX path and digest rather than rebuilding it.
  *Evidence type:* VSIX inventory test and pinned headless VS Code clean-install
  smoke test. *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  *Status:* planned.
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
  *Status:* planned.
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
  Zed releases plus compatible platform server binaries publish at real URLs,
  install on a clean machine, and roll back to the previous compatible set.
  *Oracle:* registry/release URL resolution, integrity verification, activation,
  semantic-token/diagnostic output, and rollback result equality.
  *Evidence type:* signed release witness and clean-machine matrix. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Status:* planned.
- **EDIT-10b** — *Requirement:* EDIT-10. *Behavior:* publication evidence
  includes a text-equivalent visual demo, a reviewed theme/fallback result, and
  install-to-first-highlight timing without making the network-dependent timing
  a correctness gate. *Oracle:* the demo exposes the expected roles in text and
  pixels; the timing report names hardware, toolchain, package versions, and
  start/stop events. *Evidence type:* reviewed visual artifact and observational
  performance report. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Status:* planned.

## Open verification gaps

- Packaged clean-install and transcript evidence remains open in EDIT-8a,
  EDIT-8b, and EDIT-8c.
- Signed publication, rollback, visual/theme evidence, and measured
  install-to-first-highlight time remain open in EDIT-10a and EDIT-10b.
- A shipped theme remains a planned artifact. Theme fallback belongs in #136;
  create a separate topic and fixtures only when Colorful owns an actual theme
  package, not as an empty documentation surface.
