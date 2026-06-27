# Editor integrations

Colorful colors English prose by part of speech in your editor. Every
integration drives **one engine** — the `colorful-lsp` language server — so the
analysis is identical everywhere; each editor just needs a thin adapter pointing
its LSP client at the server for `plaintext`/`markdown` buffers.

Install the server once:

```bash
cargo install colorful-lsp
```

(or grab a release binary from the
[Releases](https://github.com/flyingrobots/colorful-language/releases) page and
put it on your `PATH`).

| Editor | Integration |
| --- | --- |
| **VS Code** / Cursor | the [`vscode`](vscode/) extension |
| **Zed** | the [`zed`](zed/) extension |
| **Neovim**, **Helix**, **Emacs**, **Sublime**, **Kate** | config recipes below |

For Zed, install the source extension from [`zed/`](zed/), make sure the buffer
language is **Plain Text** or **Markdown**, and enable Zed semantic tokens. The
Zed README includes the exact settings and binary-path override.

> Highlighting uses **LSP semantic tokens**. The default skeleton highlighter
> uses standard token types (`keyword`, `class`, `number`, `string`) for
> structure and Colorful-owned open-class types (`noun`, `verb`, `adjective`,
> `adverb`) for seeded content words. Unlisted content stays unstyled. Themes may
> need explicit rules for custom token types until Colorful ships a theme
> package.

## Neovim (0.8+)

Attach the server to text and Markdown buffers:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "text", "markdown" },
  callback = function()
    vim.lsp.start({
      name = "colorful",
      cmd = { "colorful-lsp" },
      root_dir = vim.fn.getcwd(),
    })
  end,
})
-- Ensure semantic tokens are on (default in 0.9+):
-- :lua vim.lsp.semantic_tokens.start(0, client_id)
```

## Helix (`languages.toml`)

```toml
[language-server.colorful]
command = "colorful-lsp"

[[language]]
name = "markdown"
language-servers = ["colorful"]

# Plain text isn't a built-in Helix language; define one:
[[language]]
name = "text"
scope = "text.plain"
file-types = ["txt"]
language-servers = ["colorful"]
```

## Emacs (Eglot)

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((text-mode markdown-mode) . ("colorful-lsp"))))
;; then run `M-x eglot` in a text or Markdown buffer
```

## Sublime Text (LSP package)

In the `LSP` package settings:

```json
{
  "clients": {
    "colorful": {
      "enabled": true,
      "command": ["colorful-lsp"],
      "selector": "text.plain | text.html.markdown"
    }
  }
}
```

## Kate

Add to **Settings → LSP Client → User Server Settings**:

```json
{
  "servers": {
    "text": {
      "command": ["colorful-lsp"],
      "highlightingModeRegex": "^(Normal|Markdown)$"
    }
  }
}
```

---

These recipes are starting points; adjust paths and language names to your setup.
The server is the same one the [VS Code](vscode/) and [Zed](zed/) extensions
drive — so if highlighting works in one editor, the engine is fine and any
difference is in that editor's LSP wiring.
