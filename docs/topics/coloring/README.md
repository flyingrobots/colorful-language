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

The default path is a **skeleton** highlighter: it accentuates structure and
leaves ordinary content unstyled, so a paragraph is not flooded with color (the
way code highlighting works because color is scarce). The legend maps `PosClass`
onto semantic token types through the shared vocabulary manifest:

| `PosClass` | token type |
| --- | --- |
| `Function(_)` | `keyword` |
| `ProperNoun` | `class` |
| `Number` | `number` |
| `Quote` | `string` |
| `Content` | *(unstyled)* |
| `Open(Noun)` | `noun` |
| `Open(Verb)` | `verb` |
| `Open(Adjective)` | `adjective` |
| `Open(Adverb)` | `adverb` |
| `Punctuation` | *(unstyled)* |

The default CLI/LSP still use `ClosedClassLexicon`, so open-class rows appear
only when a caller supplies an annotator that emits `PosClass::Open`. This
matches the CLI, which also leaves undifferentiated content uncolored.

Incrementality is `v0`-simple: each request reparses the whole document, which is
cheap for prose. A richer default open-class annotator and a shipped theme remain
Goalpost 2 work.

See the [test plan](test-plan.md) for the cases that pin this behavior.
