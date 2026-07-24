# Roadmap

The release train for `colorful-language`. It advances along **three axes**:

- **Depth** — how much meaning Colorful extracts from English: lexical
  highlighting → linting → part of speech → an **intermediate representation** →
  Controlled Natural English → capability-proven execution.
- **Reach** — what can consume it: CLI → LSP → agents (graft) → editors (jedit,
  VS Code, the wide net) → web.
- **Maturity** — how confidently people can depend on it: reproducible builds →
  fail-closed boundaries → responsive analysis → clean distribution → observed
  user value.

The depth axis has hard ordering. The reach axis floats — a surface can be built
as soon as the depth it needs exists. The maturity axis cuts across both: it
hardens what already exists and supplies evidence for the next expansion.
**Milestones** are phases and **epic issues** track them; the board is the
[Colorful Language — Roadmap project](https://github.com/users/flyingrobots/projects/17).
Maturity tracks are an execution order within and between those goalposts, not
replacement milestones.

Governing law of the deep end: *Colorful may describe anything, but it may
compile only what the target can prove.*

## Moonshot phases

| # | Depth | Reach | Milestone / epic | Status |
| --- | --- | --- | --- | --- |
| 0 | Closed-class lexical highlighting | CLI (ANSI) + LSP (semantic tokens) | [Goalpost 0](https://github.com/flyingrobots/colorful-language/milestone/1) | ✅ released v0.1.0 |
| 1 | **Surface IR** — `colorful.syntax/v1`, a Wesley-generated GraphQL contract (Rust + TS) | graft (agent reads), jedit | [IR Spine](https://github.com/flyingrobots/colorful-language/milestone/4) · [#11](https://github.com/flyingrobots/colorful-language/issues/11) | 🚧 core IR released v0.2.1; consumers open; projection/artifact-hardening slices shipped [#57](https://github.com/flyingrobots/colorful-language/issues/57), [#58](https://github.com/flyingrobots/colorful-language/issues/58), [#59](https://github.com/flyingrobots/colorful-language/issues/59), [#60](https://github.com/flyingrobots/colorful-language/issues/60), [#61](https://github.com/flyingrobots/colorful-language/issues/61), [#62](https://github.com/flyingrobots/colorful-language/issues/62), [#63](https://github.com/flyingrobots/colorful-language/issues/63), [#64](https://github.com/flyingrobots/colorful-language/issues/64); a v0.4.0 hardening pass (producer `PassIdentity`, a `colorful-projection` crate, structured path-aware validation errors closing [#69](https://github.com/flyingrobots/colorful-language/issues/69); README architecture accuracy closing [#72](https://github.com/flyingrobots/colorful-language/issues/72); a documented, tested UTF-8 file/stdin input contract closing [#75](https://github.com/flyingrobots/colorful-language/issues/75); a validated IR-witness TypeScript leg closing [#77](https://github.com/flyingrobots/colorful-language/issues/77); a committed IR invariant fixture corpus closing [#101](https://github.com/flyingrobots/colorful-language/issues/101); a Wesley-generated contract outputs drift check closing [#103](https://github.com/flyingrobots/colorful-language/issues/103)) carries breaking API changes — unreleased, see `CHANGELOG.md`'s Unreleased section |
| 2 | Prose linter (Analyzer: passive voice, run-ons, weak words) | LSP diagnostics + CLI warnings | [Goalpost 1](https://github.com/flyingrobots/colorful-language/milestone/2) · [#6](https://github.com/flyingrobots/colorful-language/issues/6) | ✅ released v0.2.1 |
| 3 | — | **VS Code extension** + Neovim / Helix / Zed / Emacs / JetBrains recipes | [Editor Reach](https://github.com/flyingrobots/colorful-language/milestone/5) · [#12](https://github.com/flyingrobots/colorful-language/issues/12) | 🚧 source integrations released v0.2.1; packaging open |
| 4 | Open-class POS disambiguation (noun/verb/adj/adv) + custom legend + theme | richer color in every surface | [Goalpost 2](https://github.com/flyingrobots/colorful-language/milestone/3) · [#7](https://github.com/flyingrobots/colorful-language/issues/7) | 🚧 core/default path released v0.3.0; shipped slices [#38](https://github.com/flyingrobots/colorful-language/issues/38), [#40](https://github.com/flyingrobots/colorful-language/issues/40), [#44](https://github.com/flyingrobots/colorful-language/issues/44), [#46](https://github.com/flyingrobots/colorful-language/issues/46), and Unicode CLI/LSP position parity [#125](https://github.com/flyingrobots/colorful-language/issues/125); theme/package polish open |
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

## Product maturity runway

The moonshot remains the destination. The maturity runway turns the current
prototype into a product sturdy enough to carry it. These tracks organize the
34 non-epic issues open at intake on 2026-07-24. Each issue has one primary home
below; GitHub remains authoritative for live issue state. Links in later
dependency and architecture tables are cross-references, not duplicate
ownership.

Track order expresses evidence dependencies, not a ban on parallel work. The
P0 boundary and LSP tracks may advance while repository guardrails land.

### Execution order

| Order | Outcome | Tracks and gate |
| --- | --- | --- |
| **Now — contain operational risk** | Stale LSP work cannot win; malformed producer or wire data cannot become trusted output; the checks used to prove both are reproducible. | Run the critical portions of M0, M1, and M2 together. Characterize first, then refactor behind stable public contracts. |
| **Next — make quality measurable** | Public binaries, semantic decisions, performance, coverage, fuzzing, and validator maintainability have executable evidence. | Complete M0–M2. A benchmark or test may inform a decision; noisy wall-clock measurements do not become correctness gates. |
| **Ship — make the product reachable** | A user can install a signed editor/server artifact on a clean machine and reach the first highlight through a version-compatible path. | M3, after the supported LSP envelope and packaged smoke-test oracles are credible. |
| **Validate — choose the product job** | Independent evidence identifies one primary user/job and tests whether the portable IR reduces consumer cost. | M4. Corpus work may start earlier, but behavioral discovery follows real distribution. |
| **Deepen — resume the cathedral** | New CNL, provenance, Edict, and Ouroboros surface area has an evidenced user and a dependable substrate. | Resume Phase 5 and beyond only after the deep-end evidence gate below. |

### M0 — Reproducible repository and executable evidence

**Reader job:** a maintainer can reproduce the build, trust the merge gate, and
observe public-contract regressions before they ship.

- **Public-contract evidence:** real CLI/LSP binary tests
  [#133](https://github.com/flyingrobots/colorful-language/issues/133),
  conservative coverage floors
  [#137](https://github.com/flyingrobots/colorful-language/issues/137), and
  public API doctests
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
- **Source and toolchain policy:** explicit unsafe-code policy
  [#146](https://github.com/flyingrobots/colorful-language/issues/146) and
  reviewed Rust, Node, and TypeScript evidence toolchains
  [#147](https://github.com/flyingrobots/colorful-language/issues/147).
- **Merge and dependency governance:** required green checks
  [#150](https://github.com/flyingrobots/colorful-language/issues/150), pinned
  actions and grouped updates
  [#151](https://github.com/flyingrobots/colorful-language/issues/151), and
  tested maintenance intake, advisory, license, and dependency review
  [#152](https://github.com/flyingrobots/colorful-language/issues/152).

**Exit signal:** the documented local gate and the protected-branch gate name
the same reproducible evidence; public binary transport and API examples are
covered; new code cannot silently lower the accepted baseline.

### M1 — Boundary integrity and portable contracts

**User job:** an adapter or independent consumer can reject malformed data
deterministically and use valid data without reverse-engineering Colorful.

- **Validator maintainability:** keep validation error metadata in one
  declarative definition
  [#80](https://github.com/flyingrobots/colorful-language/issues/80), make the
  complexity budget enforceable or explicitly retire it
  [#81](https://github.com/flyingrobots/colorful-language/issues/81), and use
  real mutation evidence where it pays for itself
  [#82](https://github.com/flyingrobots/colorful-language/issues/82).
- **Validated producer input:** enforce strict IR graph and token invariants
  [#126](https://github.com/flyingrobots/colorful-language/issues/126),
  validate adapter spans and trees
  [#142](https://github.com/flyingrobots/colorful-language/issues/142), and
  reject malformed classification input before projection
  [#144](https://github.com/flyingrobots/colorful-language/issues/144).
- **Adversarial evidence:** fuzz parser, projection, validation, and coordinate
  invariants
  [#134](https://github.com/flyingrobots/colorful-language/issues/134);
  generate Rust and JavaScript vocabulary validators from one authority
  [#145](https://github.com/flyingrobots/colorful-language/issues/145); and add
  process-level negative IR witness legs
  [#148](https://github.com/flyingrobots/colorful-language/issues/148).
- **Consumer honesty:** append the historical v0.2.0 Graft correction
  [#149](https://github.com/flyingrobots/colorful-language/issues/149) and prove
  independent consumer value and migration across two contract versions
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).

**Exit signal:** invalid spans, graphs, identities, hashes, versions, vocabulary,
and source relationships fail closed with stable categories; successful
projection always validates; an independent consumer demonstrates whether the
IR is cheaper and safer than CLI text or LSP tokens.

### M2 — Responsive analysis and trustworthy findings

**User job:** editing stays responsive inside a declared document envelope, and
CLI/LSP findings agree without hiding ambiguity.

- **LSP freshness and capacity:** versioned per-document state, cancellation,
  caching, debouncing, and limits
  [#121](https://github.com/flyingrobots/colorful-language/issues/121), plus the
  release-mode SLO and overload harness
  [#122](https://github.com/flyingrobots/colorful-language/issues/122).
- **Measured cost:** cross-stage parsing, annotation, lint, IR, semantic-token,
  incremental-edit, and Graft benchmarks
  [#135](https://github.com/flyingrobots/colorful-language/issues/135).
- **Finding and scanner precision:** evidence-based passive-voice decisions
  [#138](https://github.com/flyingrobots/colorful-language/issues/138),
  explicit quotation policy for weak words
  [#139](https://github.com/flyingrobots/colorful-language/issues/139), and
  parser/lexicon numeric-recognition parity
  [#143](https://github.com/flyingrobots/colorful-language/issues/143).
- **Optional comparison adapter:** prototype an external `Analyzer` without
  weakening the pure port or making an engine mandatory
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).

**Exit signal:** forced stale completions cannot publish; the supported
five-megabyte case meets its reviewed SLO; overload and invalid input are
distinguishable; findings remain deterministic and coordinate-identical across
CLI and LSP.

### M3 — Distribution and editor proof

**User job:** a user can install Colorful through a normal channel, verify what
was installed, and reach the first useful editor result.

- **Compatibility policy:** define adapter/server version ownership and drift
  checks
  [#141](https://github.com/flyingrobots/colorful-language/issues/141).
- **Package evidence:** add clean-install editor and scripted LSP transcript
  tests
  [#136](https://github.com/flyingrobots/colorful-language/issues/136), then
  publish signed VS Code, Open VSX, Zed, and platform server artifacts with
  rollback evidence
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
- **Operator installation:** package the CLI, and decide the server boundary,
  for Homebrew
  [#37](https://github.com/flyingrobots/colorful-language/issues/37).
- **Public surfaces and ownership:** set the homepage, useful Discussions
  posture, and deployment ownership only when maintainers and public
  destinations exist
  [#153](https://github.com/flyingrobots/colorful-language/issues/153).

**Exit signal:** public URLs, signed or checksummed artifacts, version
compatibility, clean-install smoke tests, rollback instructions, and measured
install-to-first-highlight time all exist before current-reference marketplace
claims appear.

### M4 — Market evidence and roadmap decisions

**User job:** the project chooses what to deepen from observed utility rather
than architectural momentum.

- Build a redistributable, held-out, human-oracled comparison corpus and measure
  Colorful against relevant prose tools
  [#155](https://github.com/flyingrobots/colorful-language/issues/155).
- Run the 15-user discovery study across live POS visualization, deterministic
  CI linting, and portable IR as separate propositions
  [#158](https://github.com/flyingrobots/colorful-language/issues/158).
- **Roadmap accountability (completed by this pass):** map architecture to
  current user jobs and executable consumers, and preserve the explicit
  freeze/resume decision
  [#159](https://github.com/flyingrobots/colorful-language/issues/159).

**Exit signal:** observed behavior supports one primary user/job, or roadmap
expansion pauses; the IR is retained, simplified compatibly, or deliberately
versioned according to the independent-consumer result.

## Architecture accountability

Architecture is an investment, not a proxy for product evidence. This table
keeps each major mechanism tied to a present job and executable consumer while
preserving the deeper destination.

| Mechanism | Current user job | Executable consumer or evidence | Cost and compatibility obligation | Disposition |
| --- | --- | --- | --- | --- |
| `Parser`, `Lexicon`, `Annotator`, `Analyzer` ports | Substitute deterministic analysis adapters without coupling I/O to the domain. | CLI, LSP, built-in parser/lexicon/annotator/linter, and public-port tests. | Medium API cost; keep the four seams stable and pure. | **Keep.** They justify current CLI/LSP behavior and the optional adapter experiment. |
| `colorful.syntax/v1` surface IR | Move structured analysis across a process/language boundary. | `colorful ir`, current Graft/jedit fixtures, and the IR witness; independent proof planned in #156. | High wire-compatibility cost; preserve v1 bytes unless a reviewed version change is worth it. | **Validate next.** Retain or simplify according to measured consumer cost. |
| `colorful.vocabulary/v1` | Give every surface one versioned role/key authority. | Current ANSI, LSP, Graft projection, and manifest hash checks; generated validators planned in #145. | High drift cost across Rust and JavaScript. | **Keep and generate.** One schema authority must drive both consumers. |
| `PassIdentity` and derivation trace seed | Identify which parser and annotator produced an artifact. | `colorful-projection`, IR validation, and witness fixtures. | Existing fields are a compatibility obligation; replayable provenance would add substantial contract and cross-system cost. | **Preserve; freeze expansion.** Do not add provenance layers before the deep-end gate. |
| Graft projection | Give agents a fail-closed structured prose projection. | `consumers/graft-projection.mjs`, parity fixtures, and process witnesses. | Boundary code must reject, never clamp or coerce, malformed artifacts. | **Harden and validate.** Use #145, #148, and #156 before expanding the contract. |
| `colorful-lsp` and editor adapters | Deliver live POS visualization and deterministic diagnostics while a user writes. | Current LSP binary, source VS Code/Zed adapters, and generic clients; packaged smoke tests planned in #136. | High operational cost around freshness, memory, packaging, and version drift. | **Invest now.** M2 and M3 are the shortest path to observed user value. |
| Contract English | Express unambiguous shape declarations that can lower to canonical GraphQL SDL. | No current product consumer; the future target is Wesley. | High grammar, compatibility, and proof burden. | **Preserve as Phase 5; freeze new surface area** until the deep-end gate passes. |
| Intent English | Express explicit effectful intent as an Edict surface AST. | No current product consumer; the future target is Edict. | High semantic and safety cost; depends on Contract English. | **Preserve as Phase 6; freeze new surface area** until Phase 5 has evidence. |
| Edict and echo integration | Verify capabilities, budgets, sealing, and replayable evidence outside Colorful. | No current Colorful product consumer; future Edict compiler and echo admission path. | Very high cross-repository authority and compatibility cost. | **Preserve as Phase 7; freeze integration work** until the earlier phases are justified. |
| Ouroboros and semantic closure | Prove that Colorful can express and preserve its own constitutional meaning. | No current executable consumer; future independent compiler/hash witnesses. | Extreme proof and maintenance cost. | **Keep as the horizon.** It remains the cathedral bell, not current product scope. |

## Deep-end evidence gate

The freeze on new provenance, CNL, and Edict surface area is a sequencing rule,
not a cancellation. Phase 5 may resume when all of the following evidence
exists:

1. **Boundary integrity:** #126, #142, #144, #145, and #148 prove that producer,
   wire, vocabulary, identity, range, and source failures are rejected.
2. **Live operability:** #121 and #122 prove freshness and the supported LSP
   envelope under forced stale completion and overload.
3. **Real distribution:** #136 and #154 prove clean installation, activation,
   version compatibility, useful output, and rollback from public artifacts.
4. **Independent consumer value:** #156 shows that the IR reduces downstream
   integration cost or improves correctness relative to CLI text and LSP
   tokens. If it does not, simplify before extending the contract.
5. **Observed product value:** #155 and #158 provide held-out comparative and
   behavioral evidence for a primary user/job. If they do not, pause expansion
   and improve or narrow the existing product.

Passing the gate permits the depth sequence to continue; it does not make later
phases automatic. A failed gate changes what gets hardened or simplified next.
It does not erase the moonshot from this roadmap.

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

The active maturity critical path is boundary integrity and LSP freshness,
supported by reproducible repository evidence. Distribution follows that
operational proof; independent product validation follows real distribution.
The CNL, Edict, provenance, Ouroboros, and semantic-closure phases remain in
place behind the explicit deep-end evidence gate.
