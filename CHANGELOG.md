# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/flyingrobots/colorful-language/commits/main
