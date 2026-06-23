# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  source digests + provenance steps.

### Fixed

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

[Unreleased]: https://github.com/flyingrobots/colorful-language/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/flyingrobots/colorful-language/releases/tag/v0.1.0
