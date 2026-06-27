# Editor integrations test plan

Verification for editor adapters and the `colorful-lsp` surface.

## Requirements

- **EDIT-1** One `colorful-lsp` engine serves every editor integration.
- **EDIT-2** Semantic tokens use the shared vocabulary manifest and the LSP
  legend.
- **EDIT-3** Lint findings are published as LSP diagnostics.
- **EDIT-4** Source editor integrations compile in CI.
- **EDIT-5** Editor recipe docs stay honest about source installs,
  marketplace status, and theme caveats.
- **EDIT-6** Zed Plain Text highlighting requires semantic tokens and a
  resolvable `colorful-lsp` binary, with theme rules for Colorful-owned token
  types.
- **EDIT-7** VS Code Plain Text highlighting should work from the source
  extension without user semantic-token setup beyond a resolvable
  `colorful-lsp` binary, and startup failures must be inspectable.

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
- **EDIT-3a** — *Requirement:* EDIT-3. *Behavior:* lint findings become LSP
  diagnostics with ranges, severity, source, and rule code. *Oracle:* Rust
  assertions. *Evidence:* `crates/colorful-lsp/src/main.rs`;
  `docs/topics/linting/test-plan.md`. *Status:* implemented.
- **EDIT-4a** — *Requirement:* EDIT-4. *Behavior:* source editor integrations
  compile on every PR. *Oracle:* CI editor job exits zero. *Evidence:*
  `.github/workflows/ci.yml`. *Status:* implemented.
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

## Open verification gaps

- Marketplace package install smoke tests belong with the future marketplace
  publishing slice.
- A shipped theme package needs its own topic and fixtures once Colorful owns one.
