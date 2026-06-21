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
| `goalposts/` | Delivery evidence for completed goalposts. |

## Topics

_No topic folders yet._ The first topics arrive with Goalpost 0:

- `parsing` — how prose is lexed and shaped into structure (the `Parser` port).
- `lexicon` — the closed-class word set and classification (the `Tagger` port).
- `coloring` — how classification becomes ANSI output and LSP semantic tokens.

See [`../ROADMAP.md`](../ROADMAP.md) for the release train.
