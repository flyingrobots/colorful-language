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

## Build from source

```bash
npm install
npm run compile
```

Then press <kbd>F5</kbd> in VS Code to launch an Extension Development Host, or
package with `npx @vscode/vsce package`.

## How it works

The extension is a thin LSP client: it spawns `colorful-lsp` over stdio and
registers it for `plaintext` and `markdown` documents. All the analysis lives in
the server, so the same engine powers every editor — see the
[editor recipes](../README.md) for Neovim, Helix, Zed, Emacs, and Sublime.
