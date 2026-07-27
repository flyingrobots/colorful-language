# Documentation Spine

This is the index for `colorful-language`'s documentation. It exists so a reader
can find the *current* truth about any concept in one hop.

The discipline behind these docs is described in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md): current references describe only what
is true on `main`, plans live in test plans and the roadmap, and behavior is
proven by deterministic executable evidence.

## Layout

| Path | Contains |
| --- | --- |
| [`DOCUMENTATION_STANDARDS.md`](DOCUMENTATION_STANDARDS.md) | The project-local documentation corpus standard: page types, examples, visuals, style, and enforcement. |
| `topics/<topic>/` | The living reference for a durable product concept (behavior, test plan, optional architecture and rationale). |
| `workflows/<workflow>/` | Contributor-facing operational contracts for repository workflows. |
| `design/` | Historical, proposal-era design documents. |
| `audits/` | Point-in-time engineering assessments (historical snapshots, not living references). |
| `goalposts/vX.Y.Z/` | Release packets and verification witnesses (delivery evidence). |
| [`RELEASING.md`](RELEASING.md) | The release lifecycle, profile adapter, gates, publication, verification, and retrospective runbook. |
| [`../ROADMAP.md`](../ROADMAP.md) | Preserved moonshot phases, current product-maturity tracks, issue ownership, execution order, and evidence gates. |

## Planning and maturity

The [roadmap](../ROADMAP.md) is the planning index. Its depth and reach phases
preserve the long-term destination; its M0–M4 maturity tracks and parked
experiment section give each open non-epic issue one primary execution home.
Linked GitHub issues remain authoritative for live state.

Topic `README.md` files below remain current truth only. Planned behavior belongs
in the topic's `test-plan.md`, the owning issue, and the roadmap until executable
evidence lands. A topic test plan should link the canonical issue for each open
gap, then define stable requirement and case IDs before implementation begins.
Every case must name its requirement, exact behavior, and explicit oracle, plus
its evidence type and status. Do not copy the complete backlog into every topic.

## Self-consistency checks

Executable tests that keep a current-truth doc synchronized with the code it
describes, rather than relying on a reviewer to notice drift by eye.

- **README architecture ports.** The top-level [`../README.md`](../README.md)
  "Architecture" section names `colorful-core`'s public port traits
  (`Parser`, `Lexicon`, `Annotator`, `Analyzer`). *Requirement:* the
  documented port bullets and the crate's actual `pub trait` set must match
  exactly, bidirectionally — a renamed, added, or removed port fails this
  test instead of the README silently drifting. *Oracle:* set equality
  between the parsed README bullet names and the `pub trait` names scanned
  from `colorful-core/src/lib.rs`. *Evidence:*
  `crates/colorful-core/tests/port_inventory.rs`
  `readme_architecture_names_every_public_port_trait`. *Status:*
  implemented.

## Design records

Proposal-era decisions, written before implementation. They explain *why* and do
not pose as the current reference.

- [ADR-0001](design/0001-scope-and-delivery.md) — scope and delivery model
  (no-ML v0, LSP-first).
- [ADR-0002](design/0002-hexagonal-ports.md) — hexagonal architecture and the
  `Parser`/`Lexicon`/`Annotator` seam.
- [ADR-0003](design/0003-pure-rust-parser.md) — a pure-Rust parser; tree-sitter
  declined for the core.

## Audits

Point-in-time engineering assessments, generated at a specific commit. Like
design records, they are historical snapshots, not living references — check
each page's own status note before trusting a specific finding.

- [documentation & README audit](audits/documentation-readme-audit-2026-06-28.md)
  — 2026-06-28 completeness check of the README against the codebase.
- [ready-to-ship assessment](audits/ready-to-ship-assessment-2026-06-28.md) —
  2026-06-28 exhaustive quality, risk, and production-readiness review.
- [two-phase assessment](audits/two-phase-assessment-2026-06-28.md) — 2026-06-28
  DX/IQ/strategic review.

## Topics

- [parsing](topics/parsing/README.md) — how prose is lexed and shaped into
  structure (the `Parser` port).
- [lexicon](topics/lexicon/README.md) — the closed-class word set and
  classification (the `Lexicon` port).
- [open-class POS](topics/open-class-pos/README.md) — the Goalpost 2 domain
  contract for noun, verb, adjective, and adverb tagging.
- [coloring](topics/coloring/README.md) — how classification becomes ANSI output
  and LSP semantic tokens.
- [linting](topics/linting/README.md) — the `Analyzer` port and the prose rule
  pack (CLI warnings + LSP diagnostics).
- [ir](topics/ir/README.md) — the intermediate representation
  (`colorful.syntax/v1`, a Wesley-generated contract) and the
  [compiler ladder](topics/ir/architecture.md).
- [downstream consumers](topics/downstream-consumers/README.md) — how Graft,
  jedit, and other tools consume `colorful.syntax/v1`.
- [editor integrations](topics/editor-integrations/README.md) — how
  `colorful-lsp` reaches VS Code, Zed, and generic LSP clients.
- [distribution](topics/distribution/README.md) — install paths, package
  boundaries, and release artifacts.

## Contributor workflows

- [evidence toolchains](workflows/evidence-toolchains/README.md) — current Rust,
  Node, and TypeScript evidence selection and its separation from MSRV.
- [release process](workflows/release-process/README.md) — the release runbook,
  profile adapter, automation boundary, publication, and witness discipline.
- [PR size reporting](workflows/pr-size-reporting/README.md) — informational line-count
  diff advisory signal and exclusions in CI.
- [merge gate](workflows/merge-gate/README.md) — protected-branch requirements,
  live ruleset drift evidence, and required-context recovery.
- [Rust source policy](workflows/rust-source-policy/README.md) — first-party
  unsafe-code declarations, Cargo-target inventory, and reviewed exceptions.

## Releases

- [v0.3.0](goalposts/v0.3.0/release.md) — deterministic open-class POS roles
  (noun/verb/adjective/adverb), contextual disambiguation, diagnostic JSON, and
  Plain Text editor activation fixes
  ([verification](goalposts/v0.3.0/verification.md)).
- [v0.2.1](goalposts/v0.2.1/release.md) — Goalpost 1, "prose linter", plus the
  surface IR, vocabulary manifest, source editor integrations, and release
  package recovery ([verification](goalposts/v0.2.1/verification.md)).
- [v0.2.0](goalposts/v0.2.0/release.md) — Goalpost 1, "prose linter", plus the
  surface IR, vocabulary manifest, and source editor integrations
  ([failed publish attempt](goalposts/v0.2.0/verification.md)).
- [v0.1.0](goalposts/v0.1.0/release.md) — Goalpost 0, "English lights up"
  ([verification](goalposts/v0.1.0/verification.md)).

See [`../ROADMAP.md`](../ROADMAP.md) for the release train and
[`../CHANGELOG.md`](../CHANGELOG.md) for the ledger.
