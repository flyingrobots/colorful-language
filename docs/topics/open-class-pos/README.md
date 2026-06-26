# Open-class POS

Open-class POS is the Goalpost 2 path for distinguishing ordinary content words
as nouns, verbs, adjectives, and adverbs. The current implementation establishes
the domain contract and an opt-in seed adapter; it does not yet replace the
default highlighter.

## Core contract

`colorful-core` represents open-class decisions as:

```rust
PosClass::Open(OpenClassKind::Noun)
PosClass::Open(OpenClassKind::Verb)
PosClass::Open(OpenClassKind::Adjective)
PosClass::Open(OpenClassKind::Adverb)
```

`PosClass::Content` remains meaningful: it is an open-class word whose specific
noun/verb/adjective/adverb role is unknown. `FunctionKind` remains separate for
closed-class words such as articles, prepositions, conjunctions, pronouns,
auxiliaries, determiners, and negators.

The `Parser` still produces only structure. The `Lexicon` may identify
unambiguous entries in isolation, but context-dependent choices belong behind
the `Annotator` port. That is where later slices can disambiguate words such as
`book`, `record`, or `lead` without changing the parser, CLI, LSP transport, or
editor adapters.

## Seed lexicon

`colorful_lexicon::SeedOpenClassLexicon` is an opt-in deterministic adapter. It
wraps the closed-class behavior and then checks a small representative seed
table for noun, verb, adjective, and adverb entries.

The default `ClosedClassLexicon` is unchanged and still leaves unknown content
words as `Content`. The CLI, LSP, and IR emission continue to use the closed
class path until a later Goalpost 2 slice deliberately switches or configures a
richer annotator.

## IR boundary

`colorful.syntax/v1` does not yet have explicit noun, verb, adjective, or adverb
axes. Until that contract changes, open-class domain tags project to
`tokenKind: WORD` and `lexicalClass: CONTENT`. That fallback is intentional: the
IR must not invent unsupported wire values or imply downstream consumers can see
distinctions the contract cannot carry.

See the [test plan](test-plan.md) for the cases that pin this behavior.
