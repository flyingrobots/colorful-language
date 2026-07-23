# Roadmap

The release train for `colorful-language`. It advances along **two axes**:

- **Depth** — how much meaning Colorful extracts from English: lexical
  highlighting → linting → part of speech → an **intermediate representation** →
  Controlled Natural English → capability-proven execution.
- **Reach** — what can consume it: CLI → LSP → agents (graft) → editors (jedit,
  VS Code, the wide net) → web.

The depth axis has hard ordering. The reach axis floats — a surface can be built
as soon as the depth it needs exists. **Milestones** are phases and **epic
issues** track them; the board is the
[Colorful Language — Roadmap project](https://github.com/users/flyingrobots/projects/17).

Governing law of the deep end: *Colorful may describe anything, but it may
compile only what the target can prove.*

## Phases

| # | Depth | Reach | Milestone / epic | Status |
| --- | --- | --- | --- | --- |
| 0 | Closed-class lexical highlighting | CLI (ANSI) + LSP (semantic tokens) | [Goalpost 0](https://github.com/flyingrobots/colorful-language/milestone/1) | ✅ released v0.1.0 |
| 1 | **Surface IR** — `colorful.syntax/v1`, a Wesley-generated GraphQL contract (Rust + TS) | graft (agent reads), jedit | [IR Spine](https://github.com/flyingrobots/colorful-language/milestone/4) · [#11](https://github.com/flyingrobots/colorful-language/issues/11) | 🚧 core IR released v0.2.1; consumers open; projection/artifact-hardening slices shipped [#57](https://github.com/flyingrobots/colorful-language/issues/57), [#58](https://github.com/flyingrobots/colorful-language/issues/58), [#59](https://github.com/flyingrobots/colorful-language/issues/59), [#60](https://github.com/flyingrobots/colorful-language/issues/60), [#61](https://github.com/flyingrobots/colorful-language/issues/61), [#62](https://github.com/flyingrobots/colorful-language/issues/62), [#63](https://github.com/flyingrobots/colorful-language/issues/63), [#64](https://github.com/flyingrobots/colorful-language/issues/64); a v0.4.0 hardening pass (producer `PassIdentity`, a `colorful-projection` crate, structured path-aware validation errors closing [#69](https://github.com/flyingrobots/colorful-language/issues/69); a validated IR-witness TypeScript leg closing [#77](https://github.com/flyingrobots/colorful-language/issues/77)) carries breaking API changes — unreleased, see `CHANGELOG.md`'s Unreleased section |
| 2 | Prose linter (Analyzer: passive voice, run-ons, weak words) | LSP diagnostics + CLI warnings | [Goalpost 1](https://github.com/flyingrobots/colorful-language/milestone/2) · [#6](https://github.com/flyingrobots/colorful-language/issues/6) | ✅ released v0.2.1 |
| 3 | — | **VS Code extension** + Neovim / Helix / Zed / Emacs / JetBrains recipes | [Editor Reach](https://github.com/flyingrobots/colorful-language/milestone/5) · [#12](https://github.com/flyingrobots/colorful-language/issues/12) | 🚧 source integrations released v0.2.1; packaging open |
| 4 | Open-class POS disambiguation (noun/verb/adj/adv) + custom legend + theme | richer color in every surface | [Goalpost 2](https://github.com/flyingrobots/colorful-language/milestone/3) · [#7](https://github.com/flyingrobots/colorful-language/issues/7) | 🚧 core/default path released v0.3.0; shipped slices [#38](https://github.com/flyingrobots/colorful-language/issues/38), [#40](https://github.com/flyingrobots/colorful-language/issues/40), [#44](https://github.com/flyingrobots/colorful-language/issues/44), [#46](https://github.com/flyingrobots/colorful-language/issues/46); theme/package polish open |
| 5 | Contract English (CNL → canonical GraphQL SDL → Wesley) | first honest English → Wesley proof | [Contract English](https://github.com/flyingrobots/colorful-language/milestone/6) · [#13](https://github.com/flyingrobots/colorful-language/issues/13) | horizon |
| 6 | Intent English (CNL → Edict surface AST) | — | [Intent English](https://github.com/flyingrobots/colorful-language/milestone/7) · [#14](https://github.com/flyingrobots/colorful-language/issues/14) | horizon |
| 7 | Proof-carrying compilation → Edict Core IR → sealed bundle + echo provenance | nutrition labels; counterfactual "what would this sentence do?" | [Edict](https://github.com/flyingrobots/colorful-language/milestone/8) · [#15](https://github.com/flyingrobots/colorful-language/issues/15) | horizon |
| 8 | Ouroboros — Colorful's own contract written in English, compiled through Colorful to the same Wesley hash | — | [Ouroboros](https://github.com/flyingrobots/colorful-language/milestone/9) · [#16](https://github.com/flyingrobots/colorful-language/issues/16) | the moon |
| 9 | Semantic closure — Colorful's constitutional contract authored entirely in Colorful; independent compilers lower both the historical bootstrap spec and the Colorful spec to one Wesley semantic identity | — | — | the bell |
| ∞ | LLM elaboration tier (freeform English → CNL); other targets (SQL, UI trees, test plans, build graphs) | English → anything provable | — | beyond |

Phase 9 is stronger than Phase 8. Ouroboros proves Colorful can compile itself.
Semantic closure proves Colorful can *mean* itself: its constitutional contract
is authored entirely in Colorful, and independent compilers lower both the
historical bootstrap specification and the Colorful specification to the same
Wesley semantic identity. The bell rings not because the language compiles
itself, but because it can faithfully express the laws of its own meaning
without changing that meaning.

## Where VS Code falls

Three milestones at three distances — the basic one is essentially adjacent to
now, the deep one is near the top of the cathedral:

1. **Highlighting** (Phase 3, the minimal extension) — spawns the
   **already-shipped** `colorful-lsp` for plaintext/markdown. Zero dependency on
   the IR/CNL tower; pullable forward to "this week" anytime.
2. **Prose tool** — also surfaces the linter (Phase 2) as diagnostics and the IR
   (Phase 1) as an outline / structured navigation.
3. **English-as-code IDE** — live CNL squiggles and autocomplete that keep authors
   on the controlled-English "paved road," with inline Edict nutrition labels
   (Phases 5–7).

## The ecosystem (the deep end)

The moonshot threads five flyingrobots systems, each owning exactly one layer:

- **Colorful** owns what the source text *means* (surface + semantic IR).
- **Wesley** owns domain-empty schema/compiler facts (GraphQL → L1 → Rust/TS).
- **Edict** owns executable semantics, verification, and sealing.
- **echo** owns hosted admission and witnessed, replayable evidence.
- **continuum** owns the *proven* shared contract boundary.

The deep-end vision is English that can become more than text without becoming
magic. Controlled English may eventually compile into contracts, schemas, or
executable intent, but only when the target can prove what the sentence means.
Freeform language must not secretly execute; it can only feed a checked,
bounded, proof-carrying structure.

## Now

Phase 0 is released in v0.1.0, Goalpost 1 ships in v0.2.1, and v0.3.0 ships the
core/default Goalpost 2 open-class POS path: explicit noun, verb, adjective, and
adverb roles in the domain model, IR, vocabulary manifest, CLI, LSP, and source
editor adapters. The Goalpost 2 epic remains open for theme visibility and
packaging polish. An unreleased v0.4.0 hardening pass under Phase 1 carries
breaking API changes — producer `PassIdentity`, the `colorful-projection`
crate, and structured, path-aware `ValidationError`s — each recorded in
`CHANGELOG.md`'s Unreleased section pending release. See
[`CHANGELOG.md`](CHANGELOG.md), the
[v0.1.0 release packet](docs/goalposts/v0.1.0/release.md), the
[v0.2.1 release packet](docs/goalposts/v0.2.1/release.md), and the
[v0.3.0 release packet](docs/goalposts/v0.3.0/release.md).
