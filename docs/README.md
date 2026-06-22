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
| `topics/<topic>/` | The living reference for a durable concept (behavior, test plan, optional architecture and rationale). |
| `design/` | Historical, proposal-era design documents. |
| `goalposts/vX.Y.Z/` | Release packets and verification witnesses (delivery evidence). |
| [`RELEASING.md`](RELEASING.md) | The release runbook and pre-tag sign-off checklist. |

## Design records

Proposal-era decisions, written before implementation. They explain *why* and do
not pose as the current reference.

- [ADR-0001](design/0001-scope-and-delivery.md) — scope and delivery model
  (no-ML v0, LSP-first).
- [ADR-0002](design/0002-hexagonal-ports.md) — hexagonal architecture and the
  `Parser`/`Lexicon`/`Annotator` seam.
- [ADR-0003](design/0003-pure-rust-parser.md) — a pure-Rust parser; tree-sitter
  declined for the core.

## Topics

- [parsing](topics/parsing/README.md) — how prose is lexed and shaped into
  structure (the `Parser` port).
- [lexicon](topics/lexicon/README.md) — the closed-class word set and
  classification (the `Lexicon` port).
- [coloring](topics/coloring/README.md) — how classification becomes ANSI output
  and LSP semantic tokens.
- [ir](topics/ir/architecture.md) — the intermediate representation and the
  compiler ladder (*in progress*; Wesley-generated contract).

## Releases

- [v0.1.0](goalposts/v0.1.0/release.md) — Goalpost 0, "English lights up"
  ([verification](goalposts/v0.1.0/verification.md)).

See [`../ROADMAP.md`](../ROADMAP.md) for the release train and
[`../CHANGELOG.md`](../CHANGELOG.md) for the ledger.
