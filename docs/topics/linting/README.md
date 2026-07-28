# Linting

Linting is the path from a classified document to a list of prose *findings*:
weak words, run-on sentences, length outliers, and passive-voice candidates. It
runs over the same parser, tree, token, and classification model as the
colorizer, then applies a pack of shallow, deterministic rules. Findings surface
two ways — as exit-coded CLI warnings and as live LSP diagnostics.

## The `Analyzer` port (`colorful_core`)

`colorful-core` defines a fourth port alongside `Parser`, `Lexicon`, and
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
rule is shallow and deterministic — no model, no network — so the same input
always yields the same findings, and each is pinned by reviewed golden
input/output fixtures under
[`crates/colorful-cli/fixtures/lint/`](../../../crates/colorful-cli/fixtures/lint/)
with a harness (`crates/colorful-cli/tests/lint_golden_fixtures.rs`) that
fails the build if the linter's actual output ever drifts from a fixture's
checked-in expected report. The same fixtures also pin that the CLI and LSP
report identical findings for identical input. New rules are added here,
never in the core or the surfaces.

| Rule | Severity | Heuristic |
| --- | --- | --- |
| `weak-word` | Info | A `Content` or `Open(_)` token whose lexeme is in the filler list (`very`, `really`, `just`, `actually`, …). |
| `run-on` | Warning | A sentence with more than `run_on_words` (default 40) words. |
| `length-outlier` | Info | A sentence at least `outlier_ratio`× (default 2×) the document's mean sentence length, past an absolute floor (default 25 words) — and **under** the run-on cap, so the two rules never double-report. |
| `passive-voice` | Info | A lexically classified `be` auxiliary followed by an eligible content/verb token in the reviewed participle table, optionally with one classified or `-ly` adverb between them. Result-state entries require a following classified `by` phrase. |

The pack is intentionally conservative: every rule reports a *candidate* a writer
can dismiss, and the noisiest heuristic (passive voice) is `Info`, not a warning.
Findings come back in source order, ties broken by rule code, so the stream is
reproducible regardless of rule evaluation order.
Passive analysis joins the ordered syntax leaves and classified tokens with one
forward cursor; it does not allocate a whole-document token lookup.

### Quotation policy

Weak-word findings are evaluated inside quoted text. Straight and curly quote
marks are punctuation context, not evidence that the enclosed prose belongs to
someone else or should bypass editorial checks. Colorful therefore keeps no
quote-balance suppression state: balanced, nested, and unbalanced quotes all
leave enclosed word tokens eligible for the same weak-word rule.

This also keeps apostrophes in contractions independent of quotation handling.
For example, the weak word in `The label isn't “very clear.` is intentionally
reported despite the contraction and unmatched opening quote. CLI and LSP
parity for the full policy matrix is pinned by the `quoted-weak-words` golden
fixture.

### Passive-voice evidence boundary

Passive-voice detection does not treat an `-ed` suffix as grammatical proof.
The rule requires all of the following:

1. The auxiliary token is classified as an auxiliary and is a form of `be`.
2. The candidate token is classified as undifferentiated content or as a verb.
3. Its lowercase lexeme occurs in the reviewed participle table.
4. A result-state entry such as `broken`, `closed`, `known`, or `lost` is
   followed by an unpunctuated, lexically classified `by` phrase whose object
   can conservatively name an agent. Temporal `by now` and `by then` phrases do
   not supply that evidence.

An explicit adjective class therefore wins over the participle table. A
result-state construction such as `the door was closed` also stays silent
without the local `by` evidence. Even when all evidence is present, the message
says `passive-voice candidate`; the shallow rule does not claim a complete
grammatical parse.

The checked-in development corpus at
`crates/colorful-lint/tests/fixtures/passive_voice.tsv` contains 4 reviewed
positive rows and 11 reviewed negative rows. The current rule produces 4 true
positives, 0 false positives, 11 true negatives, and 0 false negatives: fixture
precision is `4 / (4 + 0) = 100%`. This is a deterministic regression
measurement on a small, visible development corpus, not a held-out estimate of
real-world precision or recall. Product-level blinded evaluation remains
tracked by [#155](https://github.com/flyingrobots/colorful-language/issues/155).

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

The server schedules generation processing after `didOpen` and debounced
`didChange` activity, then publishes diagnostics only for the accepted current
generation, so an editor's "Problems" view tracks the document live without
stale results; closing a document clears them. For snapshots through the 5 MiB
limit, processing includes linting. An oversized snapshot skips linting and
publishes one `colorful/document-too-large` warning instead. Each `Finding` maps
to a `Diagnostic` carrying its rule `code`, a `colorful` source tag, the message,
and a severity — warnings as `Warning`, advisory findings as `Information`.
Ranges use the same UTF-16 line model as the semantic-token path, so positions
agree across both features.

The pure `compute_diagnostics(text, parser, annotator, analyzer)` helper remains
available for direct callers and CLI/LSP parity tests. It performs one standalone
parse, classification, and lint pass, which keeps diagnostic projection and
position arithmetic unit-testable without the transport.

The production binary does not call that helper independently on each
`didChange`. For snapshots through the size limit, its `DocumentStore` schedules
`analyze_document()` after `didOpen` or a debounced edit. Analysis is still
whole-document, but each accepted generation within the size limit is parsed
and classified once; the resulting `DocumentAnalysis` supplies both published
diagnostics and cached semantic tokens. An accepted oversized generation
bypasses parsing, classification, and linting while caching the limit diagnostic
and empty tokens. A semantic-token request waits for that generation's cached
value in either case rather than starting another parse. The release-mode SLO
and overload harness for this combined production path are published by
[#122](https://github.com/flyingrobots/colorful-language/issues/122), while
the broader cross-stage comparison is published by
[#135](https://github.com/flyingrobots/colorful-language/issues/135). See the
[coloring performance reference](../coloring/README.md#performance) and the
[linting test plan](test-plan.md) for the current evidence.
