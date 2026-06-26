# Open-class POS

Open-class POS is the Goalpost 2 path for distinguishing ordinary content words
as nouns, verbs, adjectives, and adverbs. The current implementation establishes
the domain contract, an opt-in seed adapter, and IR/vocabulary support for
carrying those distinctions. It does not yet replace the default highlighter.

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

`colorful.syntax/v1` carries open-class decisions with an optional
`openClassKind` axis:

```text
tokenKind: WORD
lexicalClass: CONTENT
openClassKind: NOUN | VERB | ADJECTIVE | ADVERB
```

`PosClass::Content` still projects as `WORD` / `CONTENT` with
`openClassKind: null`. Closed-class words, proper-noun candidates, and non-word
tokens must not carry `openClassKind`; `colorful_ir::validate_document` rejects
those malformed combinations.

The vocabulary manifest maps the explicit open-class axis to distinct abstract
roles (`NOUN`, `VERB`, `ADJECTIVE`, `ADVERB`) and then to ANSI, LSP token types,
and graft classes. Default CLI/LSP execution does not emit those roles yet
because it still uses `ClosedClassLexicon`, but any caller that supplies an
annotator producing `PosClass::Open` can carry the distinction through the IR and
projection layers.

See the [test plan](test-plan.md) for the cases that pin this behavior.
