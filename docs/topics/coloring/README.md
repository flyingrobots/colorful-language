# Coloring

Coloring is the end-to-end path from text to colored output. It has three parts:
a shared classification service, a terminal renderer (CLI), and a language
server (LSP). The structural parser and the lexicon feed all of it.

## Classification (`ContextualOpenClassAnnotator`)

The `Annotator` port produces the classified `Vec<Token>` for a parsed tree. The
default `ContextualOpenClassAnnotator::annotate(source, tree)` walks the tree in
source order and assigns each leaf a `PosClass`:

- **Words** are first classified by `LexicalAnnotator<SeedOpenClassLexicon>`.
  The seed lexicon maps representative unambiguous content words to
  `Open(Noun)`, `Open(Verb)`, `Open(Adjective)`, or `Open(Adverb)`. The
  proper-noun heuristic then upgrades a capitalized `Content` or `Open(_)` word
  to `ProperNoun` *only* when it is not the first word of its sentence or line,
  and the line is not a title-case run. Sentence- or line-initial words keep the
  class returned by the seed lexicon. After that shared lexical pass, the
  contextual adapter refines only remaining `Content` tokens from a small
  ambiguous set such as `book` and `fast` when local context is strong.
- **Punctuation** is classified structurally: quotation marks become `Quote`, all
  other punctuation becomes `Punctuation`.

This is the single source of truth both front ends consume.

## Terminal output (`colorful` CLI)

`colorful <file>` (or stdin) renders each token with an ANSI color: function
words bold magenta (the "keywords"), proper nouns bold yellow, nouns blue, verbs
red, adjectives yellow, adverbs magenta, numbers cyan, quotes green, punctuation
dim; unlisted content words use the default foreground. Whitespace and gaps are
emitted verbatim, so stripping the escapes reproduces the input exactly.
`--no-color` and the `NO_COLOR` environment variable disable color and pass the
text through unchanged.

## Editor output (`colorful-lsp`)

The server keeps a `ropey` mirror of each open document, applies incremental
`didChange` edits (UTF-16 columns, clamped against malformed positions), and
answers `textDocument/semanticTokens/full` with delta-encoded tokens.

The default path is still a **skeleton** highlighter: it accentuates structure
and deterministic open-class decisions while leaving unlisted ordinary content
unstyled, so a paragraph is not flooded with color. The legend maps `PosClass`
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

The default CLI/LSP use `ContextualOpenClassAnnotator`, so open-class rows appear
for the small seed table and the supported contextual patterns. Unknown content
remains `Content` and is still unstyled.

Incrementality is `v0`-simple: each request reparses the whole document, which is
cheap for prose. A shipped editor theme remains future work.

See the [test plan](test-plan.md) for the cases that pin this behavior.
