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
  *Tracking:* [#133](https://github.com/flyingrobots/colorful-language/issues/133).
  *Status:* planned.
- **EDIT-4a** — *Requirement:* EDIT-4. *Behavior:* source editor integrations
  compile on every PR; the VS Code `tsconfig.json` sets both `strict: true` and
  `skipLibCheck: false`, so incompatible dependency declarations cannot hide
  behind a workspace-wide suppression. *Oracle:* CI editor job exits zero.
  *Evidence:* `editors/vscode/tsconfig.json`; `npm --prefix editors/vscode run
  compile`; `.github/workflows/ci.yml`. *Status:* implemented.
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
- **EDIT-8a** — *Requirement:* EDIT-8. *Behavior:* clean installed VS Code/Open
  VSX and Zed packages activate for Plain Text and Markdown, expose a
  server-not-found failure, exchange a deterministic initialize/open/change/
  tokens/diagnostics/close/shutdown transcript, and render a readable fallback
  when the active theme has no Colorful-specific rules. *Oracle:* exact
  transcript and error-category equality plus headless activation and reviewed
  text-equivalent visual output. *Evidence type:* packaged clean-install smoke
  tests and scripted JSON-RPC fixture. *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  *Status:* planned.
- **EDIT-9a** — *Requirement:* EDIT-9. *Behavior:* the chosen synchronized or
  independent adapter version policy declares compatible `colorful-lsp`
  versions and detects unintended manifest/release-profile drift. *Oracle:*
  compatibility matrix and manifest versions equal the reviewed policy; a
  deliberate mismatch makes the drift check fail. *Evidence type:*
  deterministic manifest-policy test. *Tracking:*
  [#141](https://github.com/flyingrobots/colorful-language/issues/141).
  *Status:* planned.
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

- The editor-independent real-server transcript remains open in EDIT-11a.
- Packaged clean-install and transcript evidence remains open in EDIT-8a.
- Adapter/server compatibility policy and drift evidence remains open in
  EDIT-9a.
- Signed publication, rollback, visual/theme evidence, and measured
  install-to-first-highlight time remain open in EDIT-10a and EDIT-10b.
- A shipped theme remains a planned artifact. Theme fallback belongs in #136;
  create a separate topic and fixtures only when Colorful owns an actual theme
  package, not as an empty documentation surface.
