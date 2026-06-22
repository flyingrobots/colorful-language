# Colorful Language — Zed extension

Part-of-speech syntax highlighting for **English prose** in [Zed](https://zed.dev),
powered by the `colorful-lsp` language server. It registers `colorful-lsp` for
Markdown and Plain Text buffers.

## Requirements

```bash
cargo install colorful-lsp
```

(the extension resolves `colorful-lsp` from your `PATH`).

## Install

**As a dev extension (local):** in Zed, open the command palette →
**`zed: install dev extension`** → select this `editors/zed` directory. Zed
compiles the extension to WebAssembly and loads it.

**From the registry:** once published to the Zed extension registry, install it
by name from **Extensions**.

## How it works

A small Rust→WebAssembly extension (`zed_extension_api`) whose
`language_server_command` returns the `colorful-lsp` binary. All analysis lives in
the server, shared with every other editor — see the
[editor recipes](../README.md).
