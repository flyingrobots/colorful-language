# Colorful Language — VS Code extension

Part-of-speech syntax highlighting for **English prose** in VS Code (and Cursor),
powered by the [`colorful-lsp`](https://crates.io/crates/colorful-lsp) language
server. Open a `.txt` or `.md` file and the grammar lights up — function words as
keywords, seeded nouns/verbs/adjectives/adverbs as open-class roles, proper
nouns, numbers, and quotes accentuated; unlisted content left clean.

## Requirements

Use VS Code 1.91 or newer. The extension's supported
`vscode-languageclient` release requires that editor floor.

The exact minimum, VS Code 1.91.0, uses Electron 29.4.0 and Node 20.9.0
according to the
[Electron release record](https://releases.electronjs.org/release/v29.4.0).
The extension therefore compiles against the `@types/node` 20 declaration
line. Raising that major requires a reviewed minimum-VS-Code and package-smoke
update in the same change.

The extension version is synchronized with the Colorful workspace release. For
extension `0.Y.Z`, use a stable `colorful-lsp` in
`>=0.Y.0 <0.(Y+1).0`; prereleases and a different minor line are unsupported.

The extension starts a separately installed `colorful-lsp` binary. For source
development, install the matching server from the same checkout:

```bash
cargo install --path crates/colorful-lsp --locked
```

For a registry-installed extension, install the same version of
[`colorful-lsp`](https://crates.io/crates/colorful-lsp) or use a native archive
from the matching tag on
[GitHub Releases](https://github.com/flyingrobots/colorful-language/releases).
Use an archive only when that exact target and version appear in the release
asset list; otherwise install the server with Cargo.

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

> [!WARNING]
> The full package smoke downloads and caches VS Code 1.91.0, builds release
> binaries, and writes or replaces evidence under `target/editor-smoke/`.

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
`target/editor-smoke/witness.json`, including an observational
installation-to-first-highlight duration and its host/toolchain identity. It
downloads and caches the tested VS Code build under the editor-local ignored
`.vscode-test/` directory.

## How it works

The extension is a thin LSP client: it spawns `colorful-lsp` over stdio and
registers it for `plaintext` and `markdown` documents. All the analysis lives in
the server, so the same engine powers every editor — see the
[editor recipes](https://github.com/flyingrobots/colorful-language/blob/main/editors/README.md)
for Neovim, Helix, Zed, Emacs, and Sublime.
