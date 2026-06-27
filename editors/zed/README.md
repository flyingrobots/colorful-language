# Colorful Language — Zed extension

Part-of-speech syntax highlighting for **English prose** in [Zed](https://zed.dev),
powered by the `colorful-lsp` language server. It registers `colorful-lsp` for
Markdown and Plain Text buffers.

## Requirements

The extension starts the `colorful-lsp` language server. Install it once:

```bash
cargo install colorful-lsp
```

If Zed cannot see your shell `PATH`, set the binary path explicitly in
`settings.json`:

```json
{
  "lsp": {
    "colorful-lsp": {
      "binary": {
        "path": "/Users/example/.cargo/bin/colorful-lsp"
      }
    }
  }
}
```

## Install

**As a dev extension (local):** in Zed, open the command palette →
**`zed: install dev extension`** → select this `editors/zed` directory. Zed
compiles the extension to WebAssembly and loads it.

**From the registry:** once published to the Zed extension registry, install it
by name from **Extensions**.

## Plain Text highlighting

The extension attaches to Zed's built-in **Markdown** and **Plain Text**
languages and sends LSP language IDs `markdown` and `plaintext`, respectively.
A `.txt` file should show **Plain Text** in Zed's language selector.

Colorful uses LSP semantic tokens for highlighting. Zed defaults semantic tokens
to `off`, so enable them globally:

```json
{
  "semantic_tokens": "combined"
}
```

Or enable them only for prose buffers:

```json
{
  "languages": {
    "Plain Text": {
      "semantic_tokens": "combined"
    },
    "Markdown": {
      "semantic_tokens": "combined"
    }
  }
}
```

Restart the language server, reload the extension, or reopen the buffer after
changing this setting.

If highlighting still does not appear:

1. Open Zed's log with **zed: open log** and look for `colorful-lsp`.
2. Reopen the `.txt` buffer and confirm the log gets a fresh
   `starting language server process` entry for `colorful-lsp`.
3. Confirm the buffer language is **Plain Text** or **Markdown**.
4. Confirm the configured `colorful-lsp` path exists and is executable.
5. Try `semantic_tokens: "full"` to rule out theme interaction with existing
   highlighting.

## How it works

A small Rust→WebAssembly extension (`zed_extension_api`) whose
`language_server_command` returns the configured `colorful-lsp` binary, or falls
back to resolving `colorful-lsp` from `PATH`. All analysis lives in the server,
shared with every other editor — see the
[editor recipes](../README.md).
