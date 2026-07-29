# Editor integrations

Editor integrations are the path from Colorful's analysis engine to editor UI.
They are intentionally thin: the `colorful-lsp` binary owns analysis, semantic
tokens, and diagnostics; editor adapters only start the language server and route
text or Markdown buffers to it.

## Current behavior

`colorful-lsp` speaks LSP over stdio. It keeps a document mirror, handles full
and incremental changes, emits semantic tokens, and publishes prose-lint
diagnostics. The same server backs every editor path.

Plain Text uses the complete document as prose. A buffer opened with LSP
language ID `markdown` instead passes through the shared
`colorful_parse::markdown` format adapter. Fenced and indented code blocks,
inline code, opening YAML/TOML front matter, link destinations, and HTML blocks
are replaced with coordinate-equivalent whitespace before the one parse,
classification, and lint pass. Link labels and ordinary Markdown text remain
prose. The replacement preserves byte offsets, line endings, and UTF-16
positions, so diagnostics and semantic tokens still point into the original
source. Incremental generations retain the format selected by `didOpen`;
unknown language IDs keep the historical whole-document behavior.

The repository currently ships source integrations and recipes:

- VS Code and Cursor use the source extension in
  [`editors/vscode/`](../../../editors/vscode/). The extension enables semantic
  highlighting for **Plain Text** and **Markdown**, declares Colorful-owned
  semantic token types, maps them to TextMate scopes for theme fallback, and
  exposes an **Output -> Colorful Language** channel for LSP startup evidence.
  Its supported language-client release requires VS Code 1.91 or newer.
- Zed uses the source extension in [`editors/zed/`](../../../editors/zed/).
  The extension registers `colorful-lsp` for Zed's built-in **Plain Text** and
  **Markdown** languages. Users must enable Zed semantic tokens
  (`"semantic_tokens": "full"` is clearest for prose), can set
  `lsp.colorful-lsp.binary.path` when Zed cannot see the shell `PATH`, and may
  need `global_lsp_settings.semantic_token_rules` for Colorful's custom
  open-class token types.
- Neovim, Helix, Emacs, Sublime Text, and Kate use the recipes in
  [`editors/README.md`](../../../editors/README.md).

The source integrations build in CI. The editor gate also builds one bundled
VSIX, installs those exact bytes into an isolated VS Code 1.91.0 profile, and
exercises Plain Text, Markdown, incremental diagnostics, theme-fallback
metadata, and a persisted `colorful/server-not-found` failure category. The
same VSIX digest is the future Open VSX input; CI does not manufacture a second
artifact. Zed's registry-source inventory is staged with its lockfile and
license, then compiled to Wasm from an isolated directory. Zed host activation
uses the exact manual oracle in the [test plan](test-plan.md) because Zed does
not expose a headless dev-extension install command.

These artifacts are test witnesses only. They are not yet published to editor
marketplaces or registries.

From the repository root, install the matching server from the same checkout:

```bash
cargo install --path crates/colorful-lsp --locked
```

Do not substitute an unreleased registry version. Public registry installation
guidance belongs with the publication evidence tracked by
[#154](https://github.com/flyingrobots/colorful-language/issues/154).

## Version compatibility

The Rust workspace, VS Code extension, and Zed extension use one synchronized
release version. For an adapter release `0.Y.Z`, the supported
`colorful-lsp` range is the stable same-minor line:

```text
>=0.Y.0 <0.(Y+1).0
```

Patch-level server updates are therefore compatible with adapters from the same
pre-1.0 minor release. A different minor is treated as potentially breaking.
Prerelease adapters and servers are unsupported until the release policy
defines their channel and ordering semantics.

The repo-local release profile lists all seven version sources. Pull-request
CI, release preparation, and tag publication run
`scripts/check-editor-version-policy.mjs`, which fails when a manifest,
lockfile, policy rule, or gate command drifts.

`npm --prefix editors/vscode run smoke:package` builds the matching release
server, packages and clean-installs the VSIX, exercises the installed extension,
stages and builds the Zed source package, and writes a machine-readable witness
to `target/editor-smoke/witness.json`. VS Code package tooling and the tested
editor version are exact and lockfile-backed.

A blocking 256-case property corpus checks the coordinate seam beneath every
adapter. Each generated finding crosses astral code points, combining marks,
zero-width characters, and mixed `LF`/`CRLF`/bare-`CR` input. The CLI's
1-based Unicode-scalar location and the LSP diagnostic's 0-based UTF-16 range
must resolve to the selected finding's same source line and start offset; the
LSP range end must resolve to that finding's byte-span end. A separate manual
`coordinates` fuzz target exercises the same public CLI/LSP entry points without
making time-dependent fuzzing part of the merge gate.

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
| Quotation mark | `string` |

Only the quotation marks themselves carry the `string` role. The words a
quote encloses are tokenized and classified like any other word and keep
their own role (`noun`, `keyword`, unstyled, etc.) — Colorful does not (yet)
analyze quote spans as a unit, so `"the bright fox"` styles the marks as
`string` and "the"/"bright"/"fox" independently, not the whole span as one
string.

The default LSP path uses `ContextualOpenClassAnnotator`, so it emits `noun`,
`verb`, `adjective`, and `adverb` for the small deterministic seed table and the
supported contextual patterns. Unlisted content words remain unstyled.

Themes that do not style the custom token types distinctly may still need
explicit user semantic token rules until Colorful ships a theme package. The
VS Code source extension declares fallback scopes for those token types. The Zed
source extension README carries the current rule block that maps `noun`, `verb`,
`adjective`, and `adverb` onto visible starter colors.

## Boundaries

Editor adapters must not duplicate parser, lexicon, annotator, lint, or IR logic.
They should call the language server and let `colorful-lsp` own behavior.

Marketplace publication, theme packages, and editor-specific settings UX are
separate delivery slices. They must not be documented as current behavior until
they exist in committed code and have evidence.

See the [test plan](test-plan.md) for the cases that pin this behavior.
