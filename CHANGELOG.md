# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-06-27

### Added

- **Open-class POS contract.** `colorful-core` now has explicit
  `OpenClassKind::{Noun, Verb, Adjective, Adverb}` carried by
  `PosClass::Open`, plus a deterministic `SeedOpenClassLexicon` adapter in
  `colorful-lexicon`.
- **Contextual open-class annotator.** `colorful-lexicon` now ships
  `ContextualOpenClassAnnotator`, a deterministic `Annotator` adapter that
  disambiguates a small ambiguous set (`book`, `record`, `lead`, `fast`) from
  local sentence context while preserving the seed lexicon and existing surface
  contracts.
- **Open-class IR/vocabulary axes.** `colorful.syntax/v1` now carries optional
  `openClassKind` on `WORD` / `CONTENT` tokens, and the
  `colorful.vocabulary/v1` manifest maps noun, verb, adjective, and adverb axes
  to distinct ANSI, LSP, and graft projections.
- **Local source install.** `scripts/install-local.sh` installs or upgrades the
  local `colorful` CLI into `$HOME/.colorful-language/bin` with
  `cargo install --path ... --root ... --force`, giving Graft and jedit a stable
  development-time binary path.
- **CLI diagnostic JSON.** `colorful diagnose --json [FILE]` now emits a
  machine-readable troubleshooting report showing each token's text, byte range,
  class axes, visual role, ANSI projection, graft class, LSP token type, and LSP
  legend index.

### Changed

- **Breaking API.** `PosClass` is a public enum and now includes
  `PosClass::Open(OpenClassKind)`. Downstream crates that exhaustively match on
  `PosClass` must handle the new variant before adopting the `0.3.x` line.
- **Default open-class path.** The CLI colorizer, `colorful ir`, CLI lint, and
  `colorful-lsp` now use `ContextualOpenClassAnnotator` by default, so seeded and
  supported context-disambiguated noun, verb, adjective, and adverb words carry
  distinct ANSI colors, `openClassKind` values, and LSP semantic token types.
  Unlisted content words remain `Content`.
- **IR generator pin.** The committed Wesley-generated Rust and TypeScript DTOs
  are now recorded as emitted with `wesley 0.1.1`.

### Fixed

- **VS Code Plain Text highlighting.** The VS Code source extension now declares
  Colorful's `noun`, `verb`, `adjective`, and `adverb` semantic token types,
  enables semantic highlighting for Plain Text and Markdown, maps custom tokens
  to fallback TextMate scopes, and exposes a **Colorful Language** output channel
  for startup diagnostics.
- **Zed Plain Text activation.** The Zed source extension now honors
  `lsp.colorful-lsp.binary.path` before falling back to `PATH`, and its docs
  explain that Zed semantic tokens and custom semantic token rules must be
  enabled for Plain Text highlighting.
- **CLI version probe.** `colorful --version` and `colorful -V` now print the CLI
  package version, so Graft can enforce its `colorful >= 0.2.1` prose projection
  contract before shelling through `colorful ir -`.

## [0.2.1] - 2026-06-24

`v0.2.1` is the public recovery release for the failed `v0.2.0` tag workflow.
The `v0.2.0` tag published only `colorful-core`, `colorful-lexicon`, and
`colorful-parse` before `colorful-ir` failed package verification; no GitHub
Release was created for `v0.2.0`.

### Fixed

- **colorful-ir package contents.** `colorful-ir` now carries package-local copies
  of the GraphQL and vocabulary contract inputs it embeds with `include_str!`.
  The crate tarball can compile on its own, instead of depending on root-level
  workspace files that are not present during crates.io verification.
- **Release package witness.** CI and the tag-triggered `Release` workflow now
  run `scripts/package-witness.sh`, which packages all publishable crates,
  extracts the tarballs, and checks the extracted package workspace before any
  release publish can proceed.

## [0.2.0] - 2026-06-24

### Added

- **Prose linter (Goalpost 1).** A new `Analyzer` port in `colorful-core`
  (`Tree` + classified tokens → `Vec<Finding>`) and a `colorful-lint` crate that
  implements it as `ProseLinter` — a configurable, deterministic rule pack:
  `weak-word` (filler words), `run-on` (overlong sentences), `length-outlier`
  (sentences far past the document mean), and `passive-voice` (be-auxiliary +
  past participle). Surfaced two ways: `colorful lint [FILE]` prints
  compiler-style warnings and exits non-zero when any are found, and
  `colorful-lsp` publishes them as live diagnostics on open/change. See
  `docs/topics/linting/`.
- **Editor Reach (Phase 3).** A VS Code extension (`editors/vscode/`) and a Zed
  extension (`editors/zed/`, Rust→WASM) that drive `colorful-lsp`, plus
  copy-paste config recipes (`editors/README.md`) for Neovim, Helix, Emacs,
  Sublime, and Kate. One LSP engine, thin per-editor adapters. CI compiles both
  extensions.
- **IR Spine (Phase 1).** `colorful.syntax/v1` — a Wesley-generated GraphQL
  contract emitted as canonical JSON by `colorful ir [FILE]`. New `colorful-ir`
  crate holds the generated Rust + TypeScript boundary DTOs (pinned wesley
  `0.0.5`) and the `from_classification` projection; `colorful-core` stays free of
  generated types. A cross-language round-trip witness (`scripts/ir-witness.sh`,
  CI-enforced) proves the IR survives `Rust → JSON → TypeScript → JSON → Rust`
  byte-for-byte. The contracts split `PosClass` into orthogonal
  `TokenKind`/`LexicalClass`/`FunctionKind` axes, use UTF-8 `ByteRange`, and carry
  source digests + a derivation trace seed (not yet replayable provenance).
- **Vocabulary manifest (`colorful.vocabulary/v1`).** Presentation now lives in
  one versioned manifest (`contracts/colorful/vocabulary.v1.json`): token axes →
  `VisualRole` → `{ANSI, LSP token type, graft class}`. Its hash **is** the IR's
  `vocabularyHash`, so the hash certifies presentation behavior, and the CLI
  (`sgr`), the language server (legend + token indices), and the graft reference
  consumer (`className`) all derive their colors from it instead of keeping
  private copies. The graft consumer rejects an artifact whose `vocabularyHash`
  does not match its manifest.

- **IR boundary validation.** `colorful_ir::validate_document(&DocumentAnalysis,
  Option<&[u8]>)` checks a received artifact against the `colorful.syntax/v1`
  contract — contract version, schema/vocabulary hashes, content hash and byte
  length against the supplied source, byte-range order/bounds/UTF-8 boundaries,
  token-axis legality, occurrence/node id uniqueness, and outline child
  references — collecting every failure rather than the first. The witness
  `recanon` leg now validates against the real source before re-emitting, so the
  round-trip rejects a malformed document instead of laundering it.

### Fixed

- **IR projection rejects oversized input instead of wrapping.**
  `colorful_ir::from_classification` now returns `Result<_, ProjectionError>`:
  every narrowing of a byte offset, source length, token index, or outline id to
  the contract's `i32` goes through `i32::try_from`, so a document past the
  ~2 GB wire range is refused rather than silently wrapped negative. `colorful
  ir` surfaces the error instead of emitting a corrupt artifact.
- **graft reference consumer coordinates.** `consumers/graft-projection.mjs`
  read the source as a JavaScript string and indexed it in UTF-16 code units
  while comparing against the IR's UTF-8 byte offsets, corrupting every token
  position after a non-ASCII character; it also recognized only `\n`. It now
  indexes the source as raw bytes, derives columns by decoding only the line
  prefix, recognizes the LSP line-ending set (`\n`, `\r\n`, `\r`), and verifies
  the source against the IR's `contentHash` before projecting. Pinned by
  `consumers/graft-projection.test.mjs` (CI-enforced).

## [0.1.0] - 2026-06-21

First public release — **Goalpost 0, "English lights up."**

### Added

- Project scaffold: Apache-2.0 license, community files, documentation spine,
  and the initial `ROADMAP.md` describing the release train toward Goalpost 0
  ("English lights up").
- Founding architecture decision records (ADR-0001..0003).
- **Goalpost 0 — "English lights up":** a cargo workspace delivering
  closed-class and structural part-of-speech coloring of English prose.
  - `colorful-core` — domain types (`Span`, `PosClass`, `Node`, `Tree`) and the
    `Parser`, `Lexicon`, and `Annotator` ports, plus `LexicalAnnotator` (the
    proper-noun heuristic with line-break and title-case guards, and structural
    quote/punctuation classification).
  - `colorful-lexicon` — a compile-time perfect-hash closed-class function-word
    set (including common contractions and negation) implementing `Lexicon`.
  - `colorful-parse` — a `logos` lexer and sentence segmenter implementing
    `Parser`; total (never panics) over arbitrary input, and it absorbs trailing
    closing quotes/brackets.
  - `colorful-cli` — the `colorful` binary: ANSI prose coloring with `--no-color`
    / `NO_COLOR` passthrough and `--` end-of-options.
  - `colorful-lsp` — the `colorful-lsp` binary: a `tower-lsp` server emitting
    skeleton semantic tokens with UTF-16 column handling (incl. CR/CRLF) and
    incremental `ropey`-backed edits clamped to line bounds.
  - Topic docs for parsing, lexicon, and coloring with executable test plans.
  - Hardened during a multi-reviewer pass before merge: the context-free `Tagger`
    port was split into `Lexicon` + `Annotator` so Goalpost 2's contextual
    disambiguation can slot in behind a port; an LSP cross-line edit-clamp bug was
    fixed; coloring moved to skeleton mode (content left unstyled); edits and
    semantic tokens were unified on the LSP line model; `is_number` accepts
    Unicode `\p{N}`; letter-initial alphanumeric words (`covid19`) stay whole.

[Unreleased]: https://github.com/flyingrobots/colorful-language/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/flyingrobots/colorful-language/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/flyingrobots/colorful-language/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/flyingrobots/colorful-language/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/flyingrobots/colorful-language/releases/tag/v0.1.0
