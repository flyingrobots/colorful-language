# Roadmap

This is the release train. **Goalposts** are milestones (a coherent, shippable
increment); **slices** are the issues that make a goalpost real. The roadmap
describes intent and sequence — it does not describe unbuilt behavior as if it
already exists. Current behavior always lives in `docs/topics/` and the crate
READMEs.

GitHub milestones and issues are the source of truth for status; this file is
the human-readable map.

---

## Goalpost 0 — "English lights up" (v0.1.0)

**Outcome:** open a prose file and see it colored — closed-class words as
keywords, proper nouns, numbers, quotes, and undifferentiated content — both as
ANSI in the terminal (CLI) and as semantic tokens in any LSP-speaking editor. No
machine learning; pure lexing and shallow structure.

**Status:** ✅ released in **v0.1.0** (all five slices merged to `main`).

| Slice | Crate | What it delivers |
| --- | --- | --- |
| [Workspace + core ports](https://github.com/flyingrobots/colorful-language/issues/1) | `colorful-core` | Cargo workspace; domain types (`Span`, `PosClass`, `Node`, `Tree`); the `Parser`, `Lexicon`, and `Annotator` port traits. |
| [Closed-class lexicon](https://github.com/flyingrobots/colorful-language/issues/2) | `colorful-lexicon` | A compile-time perfect-hash set of closed-class function words and common contractions implementing `Lexicon`. |
| [Structural parser](https://github.com/flyingrobots/colorful-language/issues/3) | `colorful-parse` | A `logos` lexer + sentence segmenter producing sentence / word / punctuation structure, implementing `Parser`. |
| [Terminal colorizer](https://github.com/flyingrobots/colorful-language/issues/4) | `colorful-cli` | ANSI rendering over `core` + `parse` + `lexicon`; golden fixtures as the test oracle. |
| [Semantic-tokens server](https://github.com/flyingrobots/colorful-language/issues/5) | `colorful-lsp` | A `ropey` document mirror, incremental `didChange` handling, and a semantic-tokens response mapped onto standard token types. |

**Done when:** the CLI colors a sample document deterministically against golden
fixtures, and the LSP serves semantic tokens to at least one editor.

---

## Goalpost 1 — "Prose linter" (v0.2.0)

**Outcome:** an `Analyzer` port and a rule pack that flags structural prose
issues a shallow parse can already see — passive-voice candidates, run-on
sentences, sentence-length outliers, weak/filler words. Surfaced as LSP
diagnostics and CLI warnings.

Tracked in [#6](https://github.com/flyingrobots/colorful-language/issues/6).
Detailed slices are defined when the goalpost opens.

---

## Goalpost 2 — "Open-class disambiguation" (v0.3.0)

**Outcome:** content words stop being undifferentiated. A richer `Annotator`
(dictionary-backed, later optionally ML) distinguishes noun / verb / adjective /
adverb, behind the *same port*. Ships a custom semantic-token legend and a theme
so the distinctions are visible.

This is the goalpost that demonstrates the hexagon paying off: the parser and
the server do not change. Tracked in
[#7](https://github.com/flyingrobots/colorful-language/issues/7).

---

## Horizon (not yet scheduled)

These are directions, not commitments. They exist so the architecture stays
honest about where it is headed.

- **Offline structural highlighting.** A deliberately *shallow* tree-sitter
  grammar (closed-class + structure only) for editors that highlight natively
  with no server, layered *under* the LSP. Kept shallow so it never becomes a
  second source of truth.
- **English as code.** An `Interpreter` port over a *constrained* grammar —
  English sentences as an executable, rule-style language.
- **Controlled Natural Language.** A constrained, unambiguous English subset for
  specs, contracts, and requirements.
- **Semantic tier.** An LLM adapter behind a `Semantics` port for the deep
  parses where a CFG bottoms out.
