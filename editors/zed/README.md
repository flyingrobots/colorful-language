# Colorful Language — Zed extension

Part-of-speech syntax highlighting for **English prose** in [Zed](https://zed.dev),
powered by the `colorful-lsp` language server. It registers `colorful-lsp` for
Markdown and Plain Text buffers.

## Requirements

The extension version is synchronized with the Colorful workspace release. For
extension `0.Y.Z`, use a stable `colorful-lsp` in
`>=0.Y.0 <0.(Y+1).0`; prereleases and a different minor line are unsupported.

This source extension starts the `colorful-lsp` language server. From the
repository root, install the matching server from the same checkout:

```bash
cargo install --path crates/colorful-lsp --locked
```

Compatible public server binaries are not yet published. Track
[#154](https://github.com/flyingrobots/colorful-language/issues/154) for the
first synchronized editor release.

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

If no binary path is configured and `PATH` does not resolve the server, the
extension reports the stable failure category `[colorful/server-not-found]`.
Zed itself owns launch errors for an explicitly configured path, so confirm that
an override exists and is executable before relying on it.

## Install

**As a dev extension (local):** in Zed, open the command palette →
**`zed: install dev extension`** → select this `editors/zed` directory. Zed
compiles the extension to WebAssembly and loads it.

**From the registry:** once published to the Zed extension registry, install it
by name from **Extensions**.

The repository's portable package smoke stages the exact Zed registry-source
inventory, copies the repository license, and builds that isolated source to
Wasm. Zed does not expose a headless dev-extension install command, so the
[editor integration test plan](https://github.com/flyingrobots/colorful-language/blob/main/docs/topics/editor-integrations/test-plan.md)
contains the clean-profile manual host oracle.

## Plain Text highlighting

The extension attaches to Zed's built-in **Markdown** and **Plain Text**
languages and sends LSP language IDs `markdown` and `plaintext`, respectively.
A `.txt` file should show **Plain Text** in Zed's language selector.

Colorful uses LSP semantic tokens for highlighting. Zed defaults semantic tokens
to `off`, so enable them globally. `full` is the clearest mode for prose because
Plain Text has no useful syntax layer to merge with:

```json
{
  "semantic_tokens": "full"
}
```

Or enable them only for prose buffers:

```json
{
  "languages": {
    "Plain Text": {
      "semantic_tokens": "full"
    },
    "Markdown": {
      "semantic_tokens": "full"
    }
  }
}
```

Most Zed themes do not style Colorful's custom open-class token types by
default. Add semantic token rules that map Colorful roles onto visible starter
colors:

```json
{
  "global_lsp_settings": {
    "semantic_token_rules": [
      {
        "token_type": "keyword",
        "style": ["syntax.keyword"]
      },
      {
        "token_type": "class",
        "style": ["syntax.type"]
      },
      {
        "token_type": "number",
        "style": ["syntax.number"]
      },
      {
        "token_type": "string",
        "style": ["syntax.string"]
      },
      {
        "token_type": "noun",
        "foreground_color": "#fc9867"
      },
      {
        "token_type": "verb",
        "foreground_color": "#a9dc76"
      },
      {
        "token_type": "adjective",
        "foreground_color": "#ab9df2"
      },
      {
        "token_type": "adverb",
        "foreground_color": "#ffd866"
      }
    ]
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
5. Reinstall the dev extension if Zed's extension index still shows stale
   metadata after a manifest change.

## How it works

A small Rust→WebAssembly extension (`zed_extension_api`) whose
`language_server_command` returns the configured `colorful-lsp` binary, or falls
back to resolving `colorful-lsp` from `PATH`. All analysis lives in the server,
shared with every other editor — see the
[editor recipes](https://github.com/flyingrobots/colorful-language/blob/main/editors/README.md).
