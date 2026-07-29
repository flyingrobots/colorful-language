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
Depth and reach **milestones** are phases, and **epic issues** track them; the
board is the
[Colorful Language — Roadmap project](https://github.com/users/flyingrobots/projects/17).
Cross-cutting maturity slices share one umbrella milestone, while M0–M4 remain
the execution order within and between the phase goalposts.

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
prototype into a product sturdy enough to carry it. These tracks organized the
34 non-epic issues open at intake on 2026-07-24 and now give every open
non-epic slice one machine-checkable primary disposition. Later idea and
maintenance issues remain part of the same model rather than relying on a
dated count. Issue
[#150](https://github.com/flyingrobots/colorful-language/issues/150) was
included in the intake snapshot because prerequisite
[PR #184](https://github.com/flyingrobots/colorful-language/pull/184) had not
yet merged. The follow-up advisory pass added the independently reviewable
Zed lockfile remediation
[#197](https://github.com/flyingrobots/colorful-language/issues/197).
Each open slice has one primary home below; delivered foundations remain
visible rather than disappearing from the story. GitHub remains authoritative
for live issue state. Links in later dependency and architecture tables are
cross-references, not duplicate ownership.

The
[Product Maturity — Evidence before expansion](https://github.com/flyingrobots/colorful-language/milestone/10)
milestone owns cross-cutting and parked slices that do not belong honestly to
one depth or reach phase. Phase-specific slices remain on their owning depth or
reach milestones. M0–M4 below preserve the dependency order inside the
umbrella; they are not competing GitHub milestones.

Track order expresses evidence dependencies, not a ban on parallel work. The
M0 repository-governance and M2 LSP-capacity tracks may advance together.

### Execution order

| Order | Outcome | Tracks and gate |
| --- | --- | --- |
| **Delivered — validate boundaries with fuzzing** | Property and fuzz evidence probes parser, projection, validation, and coordinate invariants after the bounded validator corpus proved its tests kill reviewed mutations. | #134 now builds on delivered #82 with a pinned seeded correctness corpus and four manual fuzz targets; measurement lanes remain advisory until their environments are stable. |
| **Delivered — prove independent-consumer value** | Mutation, fuzzing, and a standalone consumer exposed real boundary cost without expanding the cathedral. | #156 retains stable v1 under its reviewed correctness/cost rule; delivered #82 and #134 supply the mutation and fuzz baselines. |
| **Delivered — explicit wire generations** | The independent proof exposed two schema/vocabulary generations under one `colorful.syntax/v1` label. | #221 authors three exact identity generations, migration evidence, and fail-closed tuple selection. |
| **Delivered — decompose god-files without API drift** | IR and CLI contributors no longer cross unrelated responsibilities to change one validator or output adapter. | #223 preserves the public facades and assigns hashing, projection, path, validation, argument, color, diagnosis, and lint behavior one source owner each. |
| **Delivered — generate portable admission** | Consumers no longer hand-maintain structural wire validation after generation compatibility and module ownership became explicit. | #222 derives both JavaScript runtimes from generation SDLs, retains named semantic checks, and reports generated burden separately. |
| **Delivered — test analyzer substitution** | An optional external-analyzer adapter proves that the pure port can provide useful substitution without making an external engine mandatory. | #157 keeps Vale v3 process failures outside the pure port, proves built-in/external CLI/LSP parity, and leaves both production binaries Vale-free. |
| **Delivered — bound external-adapter failures** | A malformed optional-engine response cannot multiply or reproduce process-controlled content in an operator-visible error. | #235 caps and redacts every invalid-alert path before distribution work expands the reachable surface. |
| **Now — make the product reachable** | A user can install a signed editor/server artifact on a clean machine and reach the first highlight through a version-compatible path. | With #136's packaged smoke evidence, #141's adapter/server compatibility policy, and #241's Markdown non-prose boundary delivered, #154 is the next publication gate. |
| **Validate — choose the product job** | Independent evidence identifies one primary user/job and tests whether the portable IR reduces consumer cost. | M4. Corpus work may start earlier, but behavioral discovery follows real distribution. |
| **Deepen — resume the cathedral** | New CNL, provenance, Edict, and Ouroboros surface area has an evidenced user and a dependable substrate. | Resume Phase 5 and beyond only after the deep-end evidence gate below. |

### M0 — Reproducible repository and executable evidence

**Reader job:** a maintainer can reproduce the build, trust the merge gate, and
observe public-contract regressions before they ship.

- **Delivered foundation:** real CLI/LSP process tests
  ([#133](https://github.com/flyingrobots/colorful-language/issues/133));
  first-party unsafe-code policy with automatic standalone-workspace discovery
  ([#146](https://github.com/flyingrobots/colorful-language/issues/146),
  [#170](https://github.com/flyingrobots/colorful-language/issues/170)); and
  exact Rust, Node, and TypeScript evidence pins with separate advisory
  compatibility lanes
  ([#147](https://github.com/flyingrobots/colorful-language/issues/147)); and
  full-SHA action references plus weekly, rollback-separated dependency update
  groups
  ([#151](https://github.com/flyingrobots/colorful-language/issues/151)); the
  first all-workspace advisory scan and Zed lockfile remediation
  ([#197](https://github.com/flyingrobots/colorful-language/issues/197));
  tested maintenance intake, license/source policy, dependency review, CodeQL,
  and solo-safe ownership
  ([#152](https://github.com/flyingrobots/colorful-language/issues/152)); and
  executable roadmap-to-issue reconciliation
  ([#187](https://github.com/flyingrobots/colorful-language/issues/187)) with
  honestly typed malformed-fixture evidence
  ([#202](https://github.com/flyingrobots/colorful-language/issues/202)); and
  required green checks on the protected branch
  ([#150](https://github.com/flyingrobots/colorful-language/issues/150),
  delivered through
  [PR #184](https://github.com/flyingrobots/colorful-language/pull/184)).
  <!-- roadmap-primary: delivered #187 #202 -->
- **Delivered coverage evidence:** enforce conservative workspace and binary-
  transport floors plus uncovered-line ratchets
  [#137](https://github.com/flyingrobots/colorful-language/issues/137).
  <!-- roadmap-primary: delivered #137 -->
- **Delivered public-API evidence:** compile runnable examples for the public
  parser, annotator, analyzer, IR producer, and fallible vocabulary boundaries
  [#140](https://github.com/flyingrobots/colorful-language/issues/140).
  <!-- roadmap-primary: delivered #140 -->
- **Delivered workflow-security evidence:** complement `actionlint` with a pinned,
  deterministic analyzer that detects persisted checkout credentials and
  overbroad job permissions
  [#209](https://github.com/flyingrobots/colorful-language/issues/209) after
  the public-API gate.
  <!-- roadmap-primary: delivered #209 -->
- **Delivered evidence diagnostics:** convert missing public-API doctest policy
  inputs into one stable, path-addressed failure without suppressing unexpected
  programmer errors
  [#213](https://github.com/flyingrobots/colorful-language/issues/213) after
  the workflow-security gate.
  <!-- roadmap-primary: delivered #213 -->
- **Delivered structural decomposition:** split the IR and CLI god-files along
  existing responsibilities without changing public APIs, canonical bytes, or
  behavior
  [#223](https://github.com/flyingrobots/colorful-language/issues/223), between
  the wire-generation policy and generated portable admission.
  <!-- roadmap-primary: delivered #223 -->
- **Parked compatibility diagnostics:** decide how total compatibility wrappers
  expose classification failures without adding hidden stderr side effects to
  library calls
  [#224](https://github.com/flyingrobots/colorful-language/issues/224).
  <!-- roadmap-primary: parked #224 -->
- **Parked release provenance:** attach a reviewed SBOM and build-provenance
  attestation to release artifacts after the distribution and signing
  authorities are established
  [#227](https://github.com/flyingrobots/colorful-language/issues/227).
  <!-- roadmap-primary: parked #227 -->
- **Queued evidence hygiene:** derive the cross-stage allocation-profiler
  identity from the resolved dependency authority
  [#207](https://github.com/flyingrobots/colorful-language/issues/207) after
  the public-API and workflow-security gates.
  <!-- roadmap-primary: parked #207 -->
- **Parked coverage presentation:** render the existing coverage policy and
  report as one deterministic local and hosted delta summary
  [#210](https://github.com/flyingrobots/colorful-language/issues/210) without
  creating a second coverage gate.
  <!-- roadmap-primary: parked #210 -->
- **Parked public-rustdoc hygiene:** replace public API links to private lexicon
  tables with stable public-facing documentation before making rustdoc warnings
  a workspace gate
  [#230](https://github.com/flyingrobots/colorful-language/issues/230).
  <!-- roadmap-primary: parked #230 -->
- **Parked roadmap-accountability hygiene:** reject duplicate mechanism rows so
  one architecture decision cannot drift through two apparent authorities
  [#243](https://github.com/flyingrobots/colorful-language/issues/243).
  <!-- roadmap-primary: parked #243 -->
- **Delivered process-test determinism:** replace the Vale timeout fixture's
  scheduler race with an explicit test-only worker-ready seam while preserving
  production timeout and descendant-cleanup postconditions
  [#240](https://github.com/flyingrobots/colorful-language/issues/240).
  <!-- roadmap-primary: delivered #240 -->

**Exit signal:** the documented local gate and the protected-branch gate name
the same reproducible evidence; public binary transport and API examples are
covered; new code cannot silently lower the accepted baseline.

### M1 — Boundary integrity and portable contracts

**User job:** an adapter or independent consumer can reject malformed data
deterministically and use valid data without reverse-engineering Colorful.

- **Delivered foundation:** centralize validation error metadata, enforce the
  production validator complexity budget, and bound validator mutation evidence
  ([#80](https://github.com/flyingrobots/colorful-language/issues/80),
  [#81](https://github.com/flyingrobots/colorful-language/issues/81),
  [#82](https://github.com/flyingrobots/colorful-language/issues/82)); enforce
  strict graph, token, adapter, and classification boundaries
  ([#126](https://github.com/flyingrobots/colorful-language/issues/126),
  [#142](https://github.com/flyingrobots/colorful-language/issues/142),
  [#144](https://github.com/flyingrobots/colorful-language/issues/144)); prove
  Rust/JavaScript validator parity and generate vocabulary validators from one
  authority
  ([#83](https://github.com/flyingrobots/colorful-language/issues/83),
  [#145](https://github.com/flyingrobots/colorful-language/issues/145)); add
  process-level negative IR witnesses
  ([#148](https://github.com/flyingrobots/colorful-language/issues/148)); and
  preserve the historical v0.2.0 packet with its dated Graft correction
  ([#149](https://github.com/flyingrobots/colorful-language/issues/149)); and
  fuzz parser, projection, validation, and coordinate invariants with one
  pinned seeded correctness corpus plus manual time-based targets
  ([#134](https://github.com/flyingrobots/colorful-language/issues/134)).
  <!-- roadmap-primary: delivered #81 #82 #134 -->
- **Delivered consumer honesty:** a standalone zero-dependency Node consumer
  validates five wire identities, migrates real `v0.2.1` and `v0.3.0`
  `colorful.syntax/v1` generations, and renders the same role spans as ANSI and
  LSP. Its 249 authored IR lines are smaller than the alternatives' combined
  354 lines; 862 unique generated admission lines remain separately reported,
  so stable v1 is retained while additional contract surface stays frozen
  [#156](https://github.com/flyingrobots/colorful-language/issues/156).
  <!-- roadmap-primary: delivered #156 -->
- **Delivered wire-generation authority:** one canonical compatibility policy
  records the distinct `v0.2.1`, `v0.3.0`, and current workspace
  schema/vocabulary identities that all declare `colorful.syntax/v1`, selects
  by full tuple, and binds every transition to migration evidence
  [#221](https://github.com/flyingrobots/colorful-language/issues/221).
  <!-- roadmap-primary: delivered #221 -->
- **Delivered portable admission:** generate structural runtime validation from
  each compatibility-selected GraphQL SDL, preserving named semantic checks,
  stable refusal categories, and separate generated-burden accounting
  [#222](https://github.com/flyingrobots/colorful-language/issues/222).
  <!-- roadmap-primary: delivered #222 -->
- **Parked admission-evidence hygiene:** derive the portable-admission reviewed
  case count from executable evidence instead of repeating a synchronized
  literal in the burden ledger
  [#233](https://github.com/flyingrobots/colorful-language/issues/233), after
  the external-analyzer comparison on the active product-maturity path.
  <!-- roadmap-primary: parked #233 -->

**Exit signal:** invalid spans, graphs, identities, hashes, versions, vocabulary,
and source relationships fail closed with stable categories; successful
projection always validates; an independent consumer demonstrates whether the
IR is cheaper and safer than CLI text or LSP tokens.

### M2 — Responsive analysis and trustworthy findings

**User job:** editing stays responsive inside a declared document envelope, and
CLI/LSP findings agree without hiding ambiguity.

- **Delivered foundation:** versioned per-document state, cancellation,
  caching, debouncing, stale-result rejection, and document limits
  ([#121](https://github.com/flyingrobots/colorful-language/issues/121));
  a release-mode service envelope with versioned queue/stale/limit metrics,
  exact 100 KiB–10 MiB process evidence, and a passing 5 MiB SLO
  ([#122](https://github.com/flyingrobots/colorful-language/issues/122));
  fixed-corpus release evidence for parsing, annotation, classification
  validation, lint, guarded IR projection, serialization, IR validation, and
  the existing semantic-token, incremental-edit, and Graft authorities
  ([#135](https://github.com/flyingrobots/colorful-language/issues/135));
  Unicode and mixed-line-ending CLI/LSP coordinate parity
  ([#125](https://github.com/flyingrobots/colorful-language/issues/125)); and
  evidence-based passive-voice, quotation, and numeric-scanner decisions
  ([#138](https://github.com/flyingrobots/colorful-language/issues/138),
  [#139](https://github.com/flyingrobots/colorful-language/issues/139),
  [#143](https://github.com/flyingrobots/colorful-language/issues/143)).
  <!-- roadmap-primary: delivered #122 #135 -->
- **Delivered comparison adapter:** a non-publishable Vale v3 process boundary
  prepares a document-bound pure `Analyzer`, reports operational failures
  explicitly, preserves built-in/default independence, and proves CLI/LSP
  parity without syntax-token or canonical-IR interference
  [#157](https://github.com/flyingrobots/colorful-language/issues/157).
  <!-- roadmap-primary: delivered #157 -->
- **Delivered adapter error hardening:** cap and redact every malformed-alert
  diagnostic so process-controlled Vale fields cannot scale operator-visible
  errors with the configured stream limit
  [#235](https://github.com/flyingrobots/colorful-language/issues/235), before
  editor distribution expands the reachable surface.
  <!-- roadmap-primary: delivered #235 -->
- **Parked metrics export:** expose the existing versioned LSP counters through
  a bounded adapter only when an operator job needs Prometheus or CLI output;
  do not add a mandatory network listener
  [#226](https://github.com/flyingrobots/colorful-language/issues/226).
  <!-- roadmap-primary: parked #226 -->

**Exit signal:** forced stale completions cannot publish; the supported
five-megabyte case meets its reviewed SLO; overload and invalid input are
distinguishable; findings remain deterministic and coordinate-identical across
CLI and LSP.

### M3 — Distribution and editor proof

**User job:** a user can install Colorful through a normal channel, verify what
was installed, and reach the first useful editor result.

- **Delivered foundation:** restore strict VS Code declaration checking,
  rationalize compatible Rust dependencies, and keep the supported VS Code
  dependency graph outside known high-severity advisory ranges
  ([#123](https://github.com/flyingrobots/colorful-language/issues/123),
  [#124](https://github.com/flyingrobots/colorful-language/issues/124),
  [#185](https://github.com/flyingrobots/colorful-language/issues/185)).
- **Delivered compatibility policy:** synchronize adapter/server releases,
  derive same-pre-1.0-minor compatibility, and reject manifest or gate drift
  [#141](https://github.com/flyingrobots/colorful-language/issues/141).
  <!-- roadmap-primary: delivered #141 -->
- **Delivered package evidence:** one scripted LSP transcript now covers Plain
  Text and Markdown; a bundled VSIX clean-installs in pinned VS Code; the same
  bytes are the Open VSX input; and the isolated Zed registry source builds to
  Wasm
  [#136](https://github.com/flyingrobots/colorful-language/issues/136).
  <!-- roadmap-primary: delivered #136 -->
- **Delivered pre-publication Markdown correctness:** suppress diagnostics and
  semantic roles inside reviewed Markdown non-prose regions through one
  coordinate-preserving adapter shared by the CLI and LSP
  [#241](https://github.com/flyingrobots/colorful-language/issues/241).
  <!-- roadmap-primary: delivered #241 -->
- **Open publication:** publish signed VS Code, Open VSX, Zed, and platform
  server artifacts with rollback evidence
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  <!-- roadmap-primary: active #154 -->
- **Operator installation:** package the CLI, and decide the server boundary,
  for Homebrew
  [#37](https://github.com/flyingrobots/colorful-language/issues/37).
  <!-- roadmap-primary: active #37 -->
- **Public surfaces and ownership:** set the homepage, useful Discussions
  posture, and deployment ownership only when maintainers and public
  destinations exist
  [#153](https://github.com/flyingrobots/colorful-language/issues/153).
  <!-- roadmap-primary: active #153 -->
- **Parked theme accessibility tooling:** lint contrast and color-vision
  distinguishability only after the shipped theme format and visual oracle are
  stable
  [#225](https://github.com/flyingrobots/colorful-language/issues/225).
  <!-- roadmap-primary: parked #225 -->

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
  <!-- roadmap-primary: active #155 -->
- Run the 15-user discovery study across live POS visualization, deterministic
  CI linting, and portable IR as separate propositions
  [#158](https://github.com/flyingrobots/colorful-language/issues/158).
  <!-- roadmap-primary: active #158 -->
- **Roadmap accountability (completed by this pass):** map architecture to
  current user jobs and executable consumers, and preserve the explicit
  freeze/resume decision
  [#159](https://github.com/flyingrobots/colorful-language/issues/159).

**Exit signal:** observed behavior supports one primary user/job, or roadmap
expansion pauses; the IR is retained, simplified compatibly, or deliberately
versioned according to the independent-consumer result.

### Parked experiments — preserve options without stealing the critical path

**Reader job:** a contributor can find worthwhile product experiments without
mistaking an idea for a committed milestone or an already validated user need.

- Add deterministic project-local lexicon overlays behind the existing ports
  [#172](https://github.com/flyingrobots/colorful-language/issues/172).
- Explain token classifications through CLI and LSP hover using one accepted
  analysis snapshot
  [#173](https://github.com/flyingrobots/colorful-language/issues/173).
- Produce a privacy-safe editor and LSP support bundle
  [#174](https://github.com/flyingrobots/colorful-language/issues/174).
- Build a zero-install WASM playground from the pure analysis stack
  [#175](https://github.com/flyingrobots/colorful-language/issues/175).
- Emit deterministic SARIF for CI-native lint findings
  [#188](https://github.com/flyingrobots/colorful-language/issues/188).
  <!-- roadmap-primary: parked #172 #173 #174 #175 #188 -->

**Promotion rule:** move an experiment into M0–M4 only when a current user job,
dependency boundary, and executable proof justify its place. Parking preserves
the idea; it does not authorize new contract surface or displace the moonshot.

## Architecture accountability

Architecture is an investment, not a proxy for product evidence. This table
keeps each major mechanism tied to a present job and executable consumer while
preserving the deeper destination.

| Mechanism | Current user job | Executable consumer or evidence | Cost and compatibility obligation | Disposition |
| --- | --- | --- | --- | --- |
| `Parser`, `Lexicon`, `Annotator`, `Analyzer` ports | Substitute deterministic analysis adapters without coupling I/O to the domain. | CLI, LSP, built-in parser/lexicon/annotator/linter, and public-port tests. | Medium API cost; keep the four seams stable and pure. | **Keep.** They justify current CLI/LSP behavior and the optional adapter experiment. |
| `colorful.syntax/v1` surface IR | Move structured analysis across a process/language boundary. | `colorful ir`, Graft/jedit fixtures, the IR witness, and the standalone independent consumer (#156). | High wire-compatibility cost; the measured IR adapter is 249 authored lines versus 354 for ANSI and LSP combined, plus 862 unique generated admission lines reported separately. | **Retain stable v1; keep admission generated.** Five authenticated wire identities justify current bytes within the reviewed cost bound, not new fields. |
| `colorful.vocabulary/v1` | Give every surface one versioned role/key authority. | Current ANSI, LSP, Graft projection, manifest hash checks, and schema-generated validators (#145). | High drift cost across Rust and JavaScript. | **Keep generated.** One schema authority drives both consumers. |
| `PassIdentity` and derivation trace seed | Identify which parser and annotator produced an artifact. | `colorful-projection`, IR validation, and witness fixtures. | Existing fields are a compatibility obligation; replayable provenance would add substantial contract and cross-system cost. | **Preserve; freeze expansion.** Do not add provenance layers before the deep-end gate. |
| Graft projection | Give agents a fail-closed structured prose projection. | `consumers/graft-projection.mjs`, parity fixtures, process witnesses, and the independent-consumer comparison. | Boundary code must reject, never clamp or coerce, malformed artifacts. | **Boundary hardened; value supported.** #148 supplies negative witnesses and #156 supports stable v1 without authorizing expansion. |
| `colorful-lsp` and editor adapters | Deliver live POS visualization and deterministic diagnostics while a user writes. | Current LSP binary, source VS Code/Zed adapters, and generic clients; packaged smoke tests planned in #136. | High operational cost around freshness, memory, packaging, and version drift. | **Invest now.** M2 and M3 are the shortest path to observed user value. |
| Contract English | Express unambiguous shape declarations that can lower to canonical GraphQL SDL. | No current product consumer; the future target is Wesley. | High grammar, compatibility, and proof burden. | **Preserve as Phase 5; freeze new surface area** until the deep-end gate passes. |
| Intent English | Express explicit effectful intent as an Edict surface AST. | No current product consumer; the future target is Edict. | High semantic and safety cost; depends on Contract English. | **Preserve as Phase 6; freeze new surface area** until Phase 5 has evidence. |
| Edict and echo integration | Verify capabilities, budgets, sealing, and replayable evidence outside Colorful. | No current Colorful product consumer; future Edict compiler and echo admission path. | Very high cross-repository authority and compatibility cost. | **Preserve as Phase 7; freeze integration work** until the earlier phases are justified. |
| Ouroboros and semantic closure | Prove that Colorful can express and preserve its own constitutional meaning. | No current executable consumer; future independent compiler/hash witnesses. | Extreme proof and maintenance cost. | **Keep as the horizon.** It remains the cathedral bell, not current product scope. |

## Deep-end evidence gate

The freeze on new provenance, CNL, and Edict surface area is a sequencing rule,
not a cancellation. Phase 5 may resume when all of the following evidence
exists:

1. **Boundary integrity — satisfied:** #126, #142, #144, #145, and #148 prove
   that producer, wire, vocabulary, identity, range, and source failures are
   rejected.
2. **Live operability — satisfied:** #121 proves freshness under forced stale
   completion; #122 proves the supported LSP envelope, overload/refusal
   categories, peak RSS, queue delay, and zero stale publication.
3. **Real distribution — open:** #136 and #154 must prove clean installation,
   activation, version compatibility, useful output, and rollback from public
   artifacts.
4. **Independent consumer value — satisfied:** #156 proves a correctness
   advantage over CLI text and LSP tokens by authenticating five wire
   identities. After #222, its 249 authored lines are below the alternatives'
   combined 354 lines; 862 unique generated admission lines remain explicit
   compatibility cost. Stable v1 stays retained while expansion remains frozen.
5. **Observed product value — open:** #155 and #158 must provide held-out
   comparative and behavioral evidence for a primary user/job. If they do not,
   pause expansion and improve or narrow the existing product.

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

Boundary integrity, stale-result protection, required merge checks, dependency
governance, executable roadmap reconciliation, conservative coverage
ratcheting, runnable public-API examples, the measured LSP capacity envelope,
cross-stage performance/allocation evidence, seeded property/fuzz boundary
evidence, independent consumer value, and explicit wire-generation
compatibility
([#221](https://github.com/flyingrobots/colorful-language/issues/221)),
IR/CLI decomposition
([#223](https://github.com/flyingrobots/colorful-language/issues/223)), and
generated portable admission
([#222](https://github.com/flyingrobots/colorful-language/issues/222)), and the
optional Vale analyzer comparison
([#157](https://github.com/flyingrobots/colorful-language/issues/157)) are now
delivered foundations. The
independent proof retains stable v1 under its reviewed cost/correctness rule
([#156](https://github.com/flyingrobots/colorful-language/issues/156)). The
active maturity critical path has bounded and redacted optional Vale adapter
errors ([#235](https://github.com/flyingrobots/colorful-language/issues/235))
and synchronized editor/server compatibility
([#141](https://github.com/flyingrobots/colorful-language/issues/141)) and now
excludes reviewed Markdown non-prose regions without moving source coordinates
([#241](https://github.com/flyingrobots/colorful-language/issues/241)). It moves
next to public distribution. Independent product validation follows real
distribution. The CNL, Edict, provenance, Ouroboros, and semantic-closure phases
remain in place behind the explicit deep-end evidence gate.
