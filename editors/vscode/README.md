# Colorful Language — VS Code extension

Part-of-speech syntax highlighting for **English prose** in VS Code (and Cursor),
powered by the [`colorful-lsp`](https://crates.io/crates/colorful-lsp) language
server. Open a `.txt` or `.md` file and the grammar lights up — function words as
keywords, seeded nouns/verbs/adjectives/adverbs as open-class roles, proper
nouns, numbers, and quotes accentuated; unlisted content left clean.

## Requirements

The extension drives the `colorful-lsp` binary; install it once:

```bash
cargo install colorful-lsp
```

(or download a release binary from the
[Releases](https://github.com/flyingrobots/colorful-language/releases) page and
put it on your `PATH`).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `colorful.enable` | `true` | Enable/disable prose highlighting. |
| `colorful.serverPath` | `colorful-lsp` | Path to the `colorful-lsp` binary (on `PATH` or absolute). |

The extension enables semantic highlighting for VS Code's built-in
`plaintext` and `markdown` languages, declares Colorful's custom semantic token
types (`noun`, `verb`, `adjective`, `adverb`), and maps them to TextMate scopes
so regular themes have a fallback. If a theme still renders them too subtly, add
theme-specific `editor.semanticTokenColorCustomizations`.

When startup fails, check **Output → Colorful Language**. The channel reports
the `colorful-lsp` command path and startup errors.

## Build from source

```bash
npm install
npm run compile
```

Open this `editors/vscode/` directory in VS Code and run
**Launch Colorful Language Extension**. That launch configuration compiles the
extension and opens an Extension Development Host with this source checkout
loaded. Attach configurations only connect a debugger to an already running
extension host; they do not launch this extension by themselves.

Package with `npx @vscode/vsce package`.

## How it works

The extension is a thin LSP client: it spawns `colorful-lsp` over stdio and
registers it for `plaintext` and `markdown` documents. All the analysis lives in
the server, so the same engine powers every editor — see the
[editor recipes](../README.md) for Neovim, Helix, Zed, Emacs, and Sublime.
