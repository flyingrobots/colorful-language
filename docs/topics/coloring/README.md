# Coloring

Coloring is the end-to-end path from text to colored output. It has three parts:
a shared classification service, a terminal renderer (CLI), and a language
server (LSP). The structural parser and the lexicon feed all of it.

## Classification (`colorful_core::LexicalAnnotator`)

The `Annotator` port produces the classified `Vec<Token>` for a parsed tree. The
`v0` `LexicalAnnotator::annotate(source, tree)` walks the tree in source order
and assigns each leaf a `PosClass`:

- **Words** are classified by the `Lexicon`. Then a proper-noun heuristic upgrades
  a capitalized `Content` word to `ProperNoun` *only* when it is not the first
  word of its sentence or line, and the line is not a title-case run (a
  sentence-initial capital, or a header, cannot be told from a common noun, so it
  stays `Content`).
- **Punctuation** is classified structurally: quotation marks become `Quote`, all
  other punctuation becomes `Punctuation`.

This is the single source of truth both front ends consume.

## Terminal output (`colorful` CLI)

`colorful <file>` (or stdin) renders each token with an ANSI color: function
words bold magenta (the "keywords"), proper nouns bold yellow, numbers cyan,
quotes green, punctuation dim; content words use the default foreground.
Whitespace and gaps are emitted verbatim, so stripping the escapes reproduces the
input exactly. `--no-color` and the `NO_COLOR` environment variable disable color
and pass the text through unchanged.

## Editor output (`colorful-lsp`)

The server keeps a `ropey` mirror of each open document, applies incremental
`didChange` edits (UTF-16 columns, clamped against malformed positions), and
answers `textDocument/semanticTokens/full` with delta-encoded tokens.

The `v0` legend maps `PosClass` onto **standard** semantic token types so
existing themes color prose with no extra configuration:

| `PosClass` | token type |
| --- | --- |
| `Function(_)` | `keyword` |
| `ProperNoun` | `class` |
| `Content` | `variable` |
| `Number` | `number` |
| `Quote` | `string` |
| `Punctuation` | *(unstyled)* |

Incrementality is `v0`-simple: each request reparses the whole document, which is
cheap for prose. A custom legend (noun/verb/adjective/adverb) and a shipped theme
arrive with open-class disambiguation (Goalpost 2).

See the [test plan](test-plan.md) for the cases that pin this behavior.
