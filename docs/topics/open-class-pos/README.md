# Open-class POS

Open-class POS is the Goalpost 2 path for distinguishing ordinary content words
as nouns, verbs, adjectives, and adverbs. The current implementation establishes
the domain contract, a deterministic seed adapter, default surface wiring, and
IR/vocabulary support for carrying those distinctions. It does not yet perform
contextual disambiguation for ambiguous words.

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

`colorful_lexicon::SeedOpenClassLexicon` is the deterministic default adapter for
the shipped CLI, IR, and LSP surfaces. It wraps the closed-class behavior and
then checks a small representative seed table for noun, verb, adjective, and
adverb entries.

`ClosedClassLexicon` is still available and still leaves unknown content words as
`Content`. `SeedOpenClassLexicon` preserves that closed-class and number
precedence, and it also leaves unlisted content words as `Content`.

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
and graft classes. The default CLI, `colorful ir`, and LSP paths emit those roles
for seeded words by using `SeedOpenClassLexicon`. Later slices can replace or
extend that adapter with contextual disambiguation without changing the parser,
IR shape, LSP transport, or editor adapters.

See the [test plan](test-plan.md) for the cases that pin this behavior.
