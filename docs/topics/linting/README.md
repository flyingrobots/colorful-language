# Linting

Linting is the path from a classified document to a list of prose *findings*:
weak words, run-on sentences, length outliers, and passive-voice candidates. It
reuses the same parse and classification the colorizer uses, then runs a pack of
shallow, deterministic rules over the result. Findings surface two ways — as
exit-coded CLI warnings and as live LSP diagnostics.

## The `Analyzer` port (`colorful_core`)

`colorful-core` gains a fourth port alongside `Parser`, `Lexicon`, and
`Annotator`:

```rust
fn analyze(&self, source: &str, tree: &Tree, tokens: &[Token]) -> Vec<Finding>;
```

An `Analyzer` sees the source, its parsed `Tree`, and the classified `Token`
stream an `Annotator` produced, so a rule can reason about both **structure**
(sentences) and **part of speech** (auxiliaries, function words, content words)
without re-parsing. A `Finding` is a `Span` plus the `Rule` that flagged it, a
`Severity` (`Warning` or `Info`), and a human-readable `message`. Every `Rule`
carries a stable `code()` — `weak-word`, `run-on`, `length-outlier`,
`passive-voice` — that both surfaces use verbatim.

The core holds only the port and its vocabulary; it stays free of rules and I/O,
exactly as it stays free of a concrete parser or lexicon.

## The rule pack (`colorful-lint`)

`ProseLinter` is the `v0` `Analyzer`: an adapter that composes the rule pack over
a `LintConfig` (thresholds plus the filler-word list, all with `Default`s). Every
rule is shallow, deterministic, and pinned by golden fixtures — no model, no
network — so the same input always yields the same findings. New rules are added
here, never in the core or the surfaces.

| Rule | Severity | Heuristic |
| --- | --- | --- |
| `weak-word` | Info | A `Content` or `Open(_)` token whose lexeme is in the filler list (`very`, `really`, `just`, `actually`, …). |
| `run-on` | Warning | A sentence with more than `run_on_words` (default 40) words. |
| `length-outlier` | Info | A sentence at least `outlier_ratio`× (default 2×) the document's mean sentence length, past an absolute floor (default 25 words) — and **under** the run-on cap, so the two rules never double-report. |
| `passive-voice` | Info | A `be`-auxiliary (`is`/`are`/`was`/`were`/…) followed by a past participle (an `-ed` word or a known irregular), optionally one `-ly` adverb between (`was carefully reviewed`). |

The pack is intentionally conservative: every rule reports a *candidate* a writer
can dismiss, and the noisiest heuristic (passive voice) is `Info`, not a warning.
Findings come back in source order, ties broken by rule code, so the stream is
reproducible regardless of rule evaluation order.

## Terminal output (`colorful lint`)

`colorful lint [FILE]` (or stdin) parses, classifies, and lints the input, then
prints one compiler-style line per finding:

```text
draft.txt:3:12: warning [run-on]: sentence runs to 47 words
draft.txt:5:1: info [weak-word]: weak word 'really'
```

Line and column are 1-based; columns count characters. The command exits
**non-zero when it reports any findings** and zero when the prose is clean, so it
fails a CI gate on bad prose (I/O errors stay non-zero too). Clean input prints
nothing.

## Editor output (`colorful-lsp`)

The server lints on every `didOpen` and `didChange` and publishes the results as
diagnostics, so an editor's "Problems" view tracks the document live; closing a
document clears them. Each `Finding` maps to a `Diagnostic` carrying its rule
`code`, a `colorful` source tag, the message, and a severity — warnings as
`Warning`, advisory findings as `Information`. Ranges use the same UTF-16 line
model as the semantic-token path, so positions agree across both features.

The pure `compute_diagnostics(text, parser, annotator, analyzer)` does the work;
the binary is thin transport over it, which is what keeps the position
arithmetic unit-testable.

See the [test plan](test-plan.md) for the cases that pin this behavior.
