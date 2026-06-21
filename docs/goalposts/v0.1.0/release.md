# colorful-language v0.1.0 — Release Packet

## Summary

`v0.1.0` is the first public release and completes **Goalpost 0, "English lights
up."** Open a prose file and the grammar lights up: closed-class words as
keywords, proper nouns, numbers, and quotes accentuated, ordinary content left
clean. It ships two ways — a terminal CLI (`colorful`) and a Language Server
(`colorful-lsp`) — over one deterministic classification pipeline. No machine
learning, no network: pure lexing and shallow structure, entirely local.

## Included scope

- A lock-step cargo workspace built as a hexagon, with three load-bearing ports
  in `colorful-core`: `Parser` (structure), `Lexicon` (context-free word
  lookup), and `Annotator` (context-aware classification).
- `colorful-lexicon` — a compile-time perfect-hash set of closed-class function
  words, common contractions (`don't`, `I'm`), and negation, implementing
  `Lexicon`.
- `colorful-parse` — a `logos` lexer and sentence segmenter implementing
  `Parser`; total over arbitrary input (never panics) and absorbs trailing
  closing quotes/brackets.
- `colorful-cli` — the `colorful` binary: ANSI prose coloring, `--no-color` /
  `NO_COLOR` passthrough, `--` end-of-options.
- `colorful-lsp` — the `colorful-lsp` binary: a `tower-lsp` server emitting
  skeleton semantic tokens with correct UTF-16 columns and incremental,
  line-clamped `ropey`-backed edits.
- Topic references and executable test plans for parsing, lexicon, and coloring;
  founding architecture decision records (ADR-0001..0003).

## Who it's for

- Writers and note-takers who want IDE-grade structural highlighting for prose
  in any LSP-speaking editor, or instant ANSI coloring in the terminal.
- Contributors building toward the roadmap: the `Parser`/`Lexicon`/`Annotator`
  seam means later goalposts (a prose linter, noun/verb disambiguation) arrive
  as new adapters, not rewrites.

## Version justification

`0.1.0` (not `0.0.1`) because this is the first coherent, externally meaningful
product increment — a complete goalpost delivering working CLI and LSM/LSP
surfaces — rather than a scaffold. Pre-1.0, the public API (the core ports) is
explicitly unstable and may change in a later minor.

## Explicit non-claims

- **Not contextual POS tagging.** `v0` is *closed-class lexical highlighting*
  plus a proper-noun heuristic. It does not tell a noun from a verb; ambiguous
  function words (`that`, `for`) are assigned a single most-common role.
- **The proper-noun heuristic is approximate.** A title-case line with no
  lowercase content word (e.g. `I am Groot`) can be read as a header and suppress
  a real proper noun. This is the deliberate conservative direction.
- **Published to crates.io** under flat names (`colorful-core`, `colorful-cli`,
  `colorful-lsp`, …) owned by `flyingrobots`. Pre-1.0, so the public API is
  unstable, but the crate versions are permanent (yank-only).
- **Incrementality is `v0`-simple.** Each `semanticTokens/full` reparses the
  whole document; per-paragraph reparse is a later performance slice.
- **No shipped editor extension or theme yet.** Coloring uses standard semantic
  token types so existing themes apply.

## Acceptance

- `cargo test --all --locked` passes (50 tests across the workspace), including
  golden ANSI output, delta-encoded semantic tokens with UTF-16 surrogate and
  chaotic-Unicode coverage, and a totality/no-panic property test.
- `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features
  -- -D warnings`, `markdownlint-cli2`, `actionlint`, and the whitespace gate
  pass.
- The end-to-end LSP handshake (`initialize` → `didOpen` →
  `semanticTokens/full`) returns the `[keyword, class, number, string]` legend
  and the expected token stream.
- Goalpost 0 milestone: issues #1–#5 closed.

See [`verification.md`](verification.md) for the release witness (commands,
SHAs, URLs).
