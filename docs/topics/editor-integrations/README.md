# Editor integrations

Editor integrations are the path from Colorful's analysis engine to editor UI.
They are intentionally thin: the `colorful-lsp` binary owns analysis, semantic
tokens, and diagnostics; editor adapters only start the language server and route
text or Markdown buffers to it.

## Current behavior

`colorful-lsp` speaks LSP over stdio. It keeps a document mirror, handles full
and incremental changes, emits semantic tokens, and publishes prose-lint
diagnostics. The same server backs every editor path.

The repository currently ships source integrations and recipes:

- VS Code and Cursor use the source extension in
  [`editors/vscode/`](../../../editors/vscode/).
- Zed uses the source extension in [`editors/zed/`](../../../editors/zed/).
  The extension registers `colorful-lsp` for Zed's built-in **Plain Text** and
  **Markdown** languages. Users must enable Zed semantic tokens
  (`"semantic_tokens": "full"` is clearest for prose), can set
  `lsp.colorful-lsp.binary.path` when Zed cannot see the shell `PATH`, and may
  need `global_lsp_settings.semantic_token_rules` for Colorful's custom
  open-class token types.
- Neovim, Helix, Emacs, Sublime Text, and Kate use the recipes in
  [`editors/README.md`](../../../editors/README.md).

The source integrations build in CI. They are not yet published to editor
marketplaces or registries.

## Token and theme behavior

Highlighting uses LSP semantic tokens. The default skeleton highlighter uses
standard token types that existing themes usually understand for structural
roles, plus Colorful-owned token types for deterministic open-class words:

| Colorful role | LSP token type |
| --- | --- |
| Structural keyword | `keyword` |
| Noun | `noun` |
| Verb | `verb` |
| Adjective | `adjective` |
| Adverb | `adverb` |
| Proper noun candidate | `class` |
| Literal number | `number` |
| Quoted text | `string` |

The default LSP path uses `ContextualOpenClassAnnotator`, so it emits `noun`,
`verb`, `adjective`, and `adverb` for the small deterministic seed table and the
supported contextual patterns. Unlisted content words remain unstyled.

Themes that do not style the custom token types need explicit user semantic
token rules until Colorful ships a theme package. The Zed source extension
README carries the current rule block that maps `noun`, `verb`, `adjective`,
and `adverb` onto visible starter colors.

## Boundaries

Editor adapters must not duplicate parser, lexicon, annotator, lint, or IR logic.
They should call the language server and let `colorful-lsp` own behavior.

Marketplace publication, theme packages, and editor-specific settings UX are
separate delivery slices. They must not be documented as current behavior until
they exist in committed code and have evidence.

See the [test plan](test-plan.md) for the cases that pin this behavior.
