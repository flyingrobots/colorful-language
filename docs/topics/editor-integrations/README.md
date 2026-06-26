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
- Neovim, Helix, Emacs, Sublime Text, and Kate use the recipes in
  [`editors/README.md`](../../../editors/README.md).

The source integrations build in CI. They are not yet published to editor
marketplaces or registries.

## Token and theme behavior

Highlighting uses LSP semantic tokens. The default skeleton highlighter uses
standard token types that existing themes usually understand:

| Colorful role | LSP token type |
| --- | --- |
| Structural keyword | `keyword` |
| Proper noun candidate | `class` |
| Literal number | `number` |
| Quoted text | `string` |

The vocabulary manifest also declares Colorful-owned open-class token types:
`noun`, `verb`, `adjective`, and `adverb`. Those token types are available to the
LSP legend when an annotator emits open-class decisions, but the default CLI and
LSP path still use the closed-class lexicon and do not emit them yet.

Themes that do not style the custom token types may need explicit user rules
until Colorful ships a theme package.

## Boundaries

Editor adapters must not duplicate parser, lexicon, annotator, lint, or IR logic.
They should call the language server and let `colorful-lsp` own behavior.

Marketplace publication, theme packages, and editor-specific settings UX are
separate delivery slices. They must not be documented as current behavior until
they exist in committed code and have evidence.

See the [test plan](test-plan.md) for the cases that pin this behavior.
