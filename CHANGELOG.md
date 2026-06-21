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
    `Parser` / `Tagger` ports, plus the `classify` service (proper-noun
    heuristic, structural quote/punctuation classification).
  - `colorful-lexicon` — a compile-time perfect-hash closed-class function-word
    set implementing `Tagger`.
  - `colorful-parse` — a `logos` lexer and recursive-descent `Parser` adapter;
    total (never panics) over arbitrary input.
  - `colorful-cli` — the `colorful` binary: ANSI prose coloring with `--no-color`
    / `NO_COLOR` passthrough.
  - `colorful-lsp` — the `colorful-lsp` binary: a `tower-lsp` server emitting
    delta-encoded semantic tokens with UTF-16 column handling and incremental
    `ropey`-backed edits.
  - Topic docs for parsing, lexicon, and coloring with executable test plans.

[Unreleased]: https://github.com/flyingrobots/colorful-language/commits/main
