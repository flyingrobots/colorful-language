# Colorful Language — VS Code extension

Part-of-speech syntax highlighting for **English prose** in VS Code (and Cursor),
powered by the [`colorful-lsp`](https://crates.io/crates/colorful-lsp) language
server. Open a `.txt` or `.md` file and the grammar lights up — function words as
keywords, seeded nouns/verbs/adjectives/adverbs as open-class roles, proper
nouns, numbers, and quotes accentuated; unlisted content left clean.

## Requirements

Use VS Code 1.91 or newer. The extension's supported
`vscode-languageclient` release requires that editor floor.

The extension version is synchronized with the Colorful workspace release. For
extension `0.Y.Z`, use a stable `colorful-lsp` in
`>=0.Y.0 <0.(Y+1).0`; prereleases and a different minor line are unsupported.

This source extension drives the `colorful-lsp` binary. From the repository
root, install the matching server from the same checkout:

```bash
cargo install --path crates/colorful-lsp --locked
```

Compatible public server binaries are not yet published. Track
[#154](https://github.com/flyingrobots/colorful-language/issues/154) for the
first synchronized editor release.

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
the `colorful-lsp` command path and a stable failure category:
`colorful/server-not-found` for a missing executable or
`colorful/server-start-failed` for another startup failure.

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

Build the bundled VSIX with the lockfile-pinned packaging tool:

```bash
npm run package:vsix
```

Run the full package witness from the repository root:

```bash
npm --prefix editors/vscode run smoke:package
```

That command builds the matching release server, installs the VSIX into an
isolated VS Code 1.91.0 profile, exercises Plain Text and Markdown plus a
missing-server profile, stages the Zed source package, and writes
`target/editor-smoke/witness.json`. It downloads and caches the tested VS Code
build under `editors/vscode/.vscode-test/`.

## How it works

The extension is a thin LSP client: it spawns `colorful-lsp` over stdio and
registers it for `plaintext` and `markdown` documents. All the analysis lives in
the server, so the same engine powers every editor — see the
[editor recipes](https://github.com/flyingrobots/colorful-language/blob/main/editors/README.md)
for Neovim, Helix, Zed, Emacs, and Sublime.
