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

## Optional Vale comparison adapter

`colorful-vale` is a non-publishable prototype outer crate for Vale v3. It is
not a dependency of `colorful-core`, `colorful-cli`, or `colorful-lsp`, and
neither production binary selects or invokes it. The built-in `ProseLinter`
therefore remains the default, offline analyzer even when no `vale` executable
or configuration exists.

The prototype requires the caller to provide both a Vale executable and an
explicit `.vale.ini`. Discovery accepts major version 3, and analysis invokes
Vale with JSON output, stdin using a caller-selected document extension
(`.txt` by default), no global configuration, a bounded output capture, and a
caller-cancellable timeout. It never runs `vale sync` or downloads a style.
Each child starts from an empty environment. Unix receives only the fixed
`/usr/bin:/bin` executable path; Windows retains `SystemRoot` and `WINDIR` when
present so the selected executable can use platform services. User `HOME`, XDG,
proxy, and Vale override variables are not inherited.
On Unix, each invocation owns a dedicated process group so timeout and
cancellation terminate configured wrappers and their descendants before
joining captured output. The same deadline and cancellation token remain active
while stdin and captured output drain, including after a wrapper exits while a
descendant still owns its pipes. Cancellation is rechecked immediately before
completed output is accepted. Other targets retain direct-child termination.
Missing configuration, an unavailable engine, unrecognized version output, an
incompatible engine, timeout, cancellation, process failure, excessive output,
invalid UTF-8, malformed JSON, duplicate JSON source keys, invalid alert data,
and source-identity mismatch are different `ValeErrorKind` values; none
silently becomes an empty result or a fallback to the built-in rules.
Additive unknown Vale v3 alert and action fields are ignored, while every field
Colorful consumes remains required and validated. Source-key failures use fixed
messages and do not echo process-controlled key material.

Set `VALE_BIN` to the absolute path of the selected executable before running
this example. Resolving the path first is required because the child receives
the isolated environment described above.

```rust
use colorful_vale::{CancellationToken, ValeAnalyzer, ValeConfig};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source = "This is very clear.";
    let executable = std::env::var_os("VALE_BIN")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "VALE_BIN must name an absolute Vale executable",
            )
        })?;
    let config = ValeConfig::new(executable, ".vale.ini").with_extension(".md");
    let adapter = ValeAnalyzer::discover(config)?;
    let cancellation = CancellationToken::new();
    let prepared = adapter.analyze(source, &cancellation)?;
    let _analyzer = prepared.bind(source)?;
    Ok(())
}
```

Only the successful, document-bound value returned by `bind` implements the
pure `Analyzer` port. Vale suggestions become Colorful `Info`; Vale warnings
and errors become `Warning`: Colorful has no higher editorial severity, so a
Vale error deliberately maps to the highest available tier rather than being
dropped. Vale v3 reports
[one-based, inclusive rune columns](https://github.com/vale-cli/vale/blob/v3.14.2/internal/core/file.go#L181-L220);
the adapter converts those endpoints to Rust byte ranges and validates the
required, non-empty `Match` against the exact source slice. Each response
indexes document line boundaries once before normalizing its alerts; individual
findings do not rescan the source prefix. Check names become validated
`vale/<check>` rule codes. Findings are sorted by complete range, rule code,
severity, and message. The external findings can then use the same CLI-report
and LSP-diagnostic projection helpers as `ProseLinter`, but they do not alter
semantic tokens, parser/classifier output, or canonical IR.

The prototype's reviewed maintenance surface is six production source modules
and exactly four production dependencies (`colorful-core`, Unix-only `rustix`,
`serde`, and `serde_json`); a workspace-boundary test fails if either measure
changes.
Utility evidence exercises deterministic process, normalization, configuration,
and boundary tests, including two external findings projected through both
surfaces with no semantic-token or canonical-IR drift. A one-off 2026-07-28
compatibility probe used the checksum-verified official Vale 3.14.2 macOS arm64
archive
(`vale_3.14.2_macOS_arm64.tar.gz`, SHA-256
`14305f4e5e0756351ffd4ff8dd1e561c5d49f6a27360834238d832d9e64ac70f`);
the exact JSON output is retained at
[`crates/colorful-vale/tests/fixtures/vale-3.14.2-smoke.json`](../../../crates/colorful-vale/tests/fixtures/vale-3.14.2-smoke.json)
and remains admitted by the normal test suite. This proves the comparison seam,
not enough product utility to make Vale a supported or mandatory surface.

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
