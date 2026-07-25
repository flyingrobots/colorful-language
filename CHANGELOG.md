# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Strict received-IR token and outline validation.** Rust
  `validate_document` and the JavaScript `validateWireContract` gate now reject
  empty, unsorted, or overlapping token ranges and outline graphs with invalid
  paragraph/sentence depths, cycles, multiple parents, or child ranges outside
  their parents. Rust reports path-addressed `ValidationError` variants in
  deterministic token/edge order; JavaScript reports stable matching
  `GraftProjectionError.code` values. Both iterative graph traversals keep
  malicious graph depth off the process stack.
- **Process-level IR refusal evidence.** `scripts/ir-witness.sh` now drives the
  real Node canonicalizer and Rust `recanon` executable through ten
  deterministic malformed-artifact cases: mismatched source, invalid JSON,
  wrong contract/schema/vocabulary identities, illegal axes, fractional and
  out-of-range offsets, a missing field, and a multi-identity precedence case.
  All 20 legs must exit exactly `1`, report the boundary's stable error code,
  and leave canonical stdout empty; the positive byte-identical round trip
  remains part of the same gate. `ValidationError::code` exposes the stable Rust
  validation category, while both processes now turn JSON/DTO decode failures
  into `E_JSON_DECODE` instead of allowing a panic or raw stack trace to define
  the contract.
- **Generation-safe cached LSP analysis.** Each open document now owns a rope,
  client version, monotonic server generation, cached analysis, cooperative
  cancellation handle, and per-document publication gate. Opens analyze
  immediately; edits cancel pending work and debounce replacement analysis for
  50 ms. Parsing and classification run from a rope snapshot on the blocking
  pool, once per accepted generation, and the cached result supplies both
  diagnostics and semantic tokens. A forced-completion regression makes an old
  computation finish last and proves it cannot publish or replace the current
  cache. Semantic-token responses identify their generation with `resultId`.
  Documents through 5 MiB enter normal analysis; larger inputs bypass analysis,
  return no semantic tokens, and publish the stable
  `colorful/document-too-large` warning.
- **A shared Rust/JavaScript validator-parity witness.** One declarative
  25-case mutation matrix now covers every public Rust `ValidationError`
  variant and its overlapping JavaScript wire-contract rejection. Both legs
  start from the same canonical Rust-produced Unicode document, apply the same
  mutation and optional source-byte override, then assert the named Rust
  variant / stable `GraftProjectionError.code`. The Rust test keeps an
  exhaustive variant inventory and requires exact case-count equality, so
  adding or dropping a validation reason cannot silently leave the
  cross-language gate stale. Token ordering and outline graph integrity are
  shared wire invariants in both validators.
- **The IR witness's TypeScript leg now actually validates.**
  `witness/ir-canonicalize.mjs` previously parsed and canonicalized a
  `DocumentAnalysis` with zero structural validation. It now runs a new
  `validateWireContract` gate (unknown/missing/wrongly-typed field checks at
  every nesting level, plus the existing range/hash checks) against the
  decoded document and the real source bytes before re-emitting, so a
  malformed artifact is rejected instead of canonicalized.
  `validateWireContract` and the product-facing `validateArtifact` now enforce
  the same shared wire invariants. Three checked-in
  negative fixtures under `witness/negative/` (an unknown top-level field, a
  missing field, a wrong-typed field) prove the rejection — for the specific
  expected reason, not just a nonzero exit — on every `scripts/ir-witness.sh`
  run. `consumers/graft-projection.mjs` also gains an unknown-field check at
  *every* nesting level (`source`, each token, structure node, diagnostic,
  derivation step, and byte range) it didn't have before (a field outside
  the contract was previously silently ignored at any level below the
  document root) — this affects the shipped graft reference consumer, not
  just the witness.
- **Measured release-mode benchmarks replace unsubstantiated performance
  claims.** README.md's "Blazing fast" and the coloring topic's "cheap for
  prose" named no hardware, corpus, or number. Added
  `crates/colorful-cli/benches/colorize_bench.rs` and
  `crates/colorful-lsp/benches/semantic_tokens_bench.rs` (`criterion`,
  `cargo bench -p colorful-cli` / `-p colorful-lsp`), timing the CLI's
  `colorize()` path and the LSP's standalone `compute_semantic_tokens()`
  projection helper over a 899-byte real fixture and a 45 KB corpus. This
  is *not* the full production `analyze_document` and versioned scheduling
  path, which also includes lint/diagnostic projection, debounce/queue delay,
  cache coordination, and transport. `docs/topics/coloring/README.md` gets a new
  *Performance* section with the actual measured figures (2026-07-23,
  `rustc 1.96.0`, Apple M1 Pro), a stated 16 ms budget for documents up to
  ~50 KB, and explicit notes that the budget is not yet CI-enforced (a
  single machine's first measurement isn't a stable baseline) and that the
  combined production path and memory are open benchmarking gaps, not implied
  by "cheap."
- **Golden fixtures for the prose-linting rule pack.** Seven reviewed
  input/output fixtures under `crates/colorful-cli/fixtures/lint/` pin the
  exact CLI report for each of the four lint rules, a false-positive
  near-miss per rule, multi-rule source ordering, and CRLF line endings. A
  new harness (`crates/colorful-cli/tests/lint_golden_fixtures.rs`) fails
  the build if the linter's actual output ever drifts from a fixture's
  checked-in expected report, and separately asserts that `colorful-lsp`'s
  diagnostics never disagree with the CLI's findings for the same input.
  `colorful_cli::line_col` is now public (previously private) so the
  harness can cross-check CLI and LSP positions directly.
- **`colorful-lexicon`'s ambiguous-word rules are now named, data-driven
  senses.** `contextual_kind` previously hand-matched each ambiguous lexeme
  (`book`, `record`, `lead`, `fast`) against a separate senses-only table,
  with a catch-all branch that would silently do nothing for a word absent
  from the code even if present in the table (or vice versa). Each lexeme is
  now a `Sense` list — class, named evidence, and the context check that
  fires it, bundled together — checked in declaration order (the first
  match wins); there is no catch-all, so a sense can't exist in the data
  without the logic that makes it fire. A corpus test
  (`ambiguous_word_corpus_matches_expected_sense_with_rationale`) exercises
  every sense plus a no-match and an unrecognized-word case, citing each
  matched rule's own evidence on failure. Internal to `colorful-lexicon`,
  not a public API change.
- **`colorful-projection` crate.** A single `build_document` front door parses,
  annotates, and classifies source text into an `AnalyzedDocument` (tree +
  tokens + canonical `DocumentAnalysis`), so `colorful-cli`'s `diagnose_json`
  and `analyze_ir` no longer hand-roll the parse/annotate/project pipeline.
- **`PassIdentity` provenance.** `Parser` and `Annotator` (`colorful-core`) gain
  a `pass_identity()` method reporting which derivation stage and rule
  implementation they are; the default is invalid by construction (empty),
  so an implementation that never overrides it is honestly unidentified. IR
  derivation steps now carry these real identities instead of two hardcoded
  string literals — `ContextualOpenClassAnnotator` is now correctly reported
  as `contextual-open-class-annotator`, not the fallback `lexical-annotator`.
  `from_classification` rejects a missing or duplicate pass identity;
  `validate_document` rejects the same on a received artifact.
- **Shared CLI argument parser.** `colorful-cli`'s four subcommands (`color`,
  `ir`, `diagnose`, `lint`) now parse arguments through one `parse_input_args`
  function instead of four hand-rolled copies, keyed on a `Command` enum that
  centralizes each command's recognized flags and `--help` text in one place
  instead of scattering them across each `run_*` call site. `--` then a bare
  `-` now correctly means stdin instead of a literal file named `-`; a
  flag-shaped argument after `--` (e.g. `--weird-file`) is accepted as a
  literal path everywhere, not just in the default subcommand; and "at most
  one `FILE` operand" is now enforced uniformly instead of only in
  `diagnose`. A matrix test
  (`input_args_matrix_has_identical_operand_semantics_across_commands`)
  exercises every command against the option terminator, the stdin sentinel,
  an unknown flag, and zero/one/two file operands, asserting identical
  behavior across all four. All of this is internal to `colorful-cli`, not
  part of its public API.
- **Graft reference consumer artifact validation.** The JS reference consumer
  (`consumers/graft-projection.mjs`) gains `validateArtifact(buffer, ir)`, an
  ordered admission gate `project()` now runs unconditionally: top-level
  shape, `contractVersion`, declared byte length, source UTF-8 validity, per-
  token byte-range order/bounds/char-boundary/non-emptiness and wire-order
  non-overlap, `occurrenceId` uniqueness, token axis legality, structure-graph
  depth/id/reference/ownership/containment/acyclicity checks, then
  `schemaHash`/`vocabularyHash`/`contentHash`
  — cheapest first, hashes last, malformed input rejected under a stable
  `GraftProjectionError.code` rather than repaired, clamped, or sorted into
  validity. `schemaHash` is newly verified, independently recomputed from this
  consumer's own `contracts/colorful/syntax.v1.graphql` copy exactly as
  `vocabularyHash` already was from the vocabulary manifest. The gate now also:
  checks `tokenKind`/`lexicalClass`/`functionKind`/`openClassKind`/outline
  `kind` against the actual wire enum, not just "is a string" (an unknown
  value no longer reaches a later, uncoded `Error`); holds every integer
  field to the real `colorful.syntax/v1` wire range (signed `i32`), not
  merely "any JS safe integer"; and validates `diagnostics`/`derivation`
  shape and ranges, rejecting an empty `derivation` (`E_EMPTY_DERIVATION`) or
  a step with an empty/duplicate pass identity
  (`E_MISSING_DERIVATION_IDENTITY` / `E_DUPLICATE_DERIVATION_PASS_ID`) —
  mirroring `colorful_ir::validate_document`'s own derivation checks.
- **`makeByteToPoint` no longer rescans from row 0 on every call.** The graft
  reference consumer's byte-offset-to-row/column mapper now advances a
  monotonic cursor forward for the sequential queries `project()` actually
  makes (now that token wire-order is validated — see above), falling back to
  a binary search for an out-of-order query instead of assuming one won't
  happen. A deterministic test proves the bound (total cursor advances across
  N sequential calls is at most N, not N²/2) without timing anything.

### Changed

- **Product maturity is now an explicit third roadmap axis.** The preserved
  moonshot phases now sit alongside M0–M4 evidence tracks that organize the
  34-issue non-epic intake snapshot around reproducibility, boundary integrity,
  responsive analysis, distribution, and observed user value.
  The deep-end evidence gate freezes new provenance, Controlled Natural English,
  and Edict surface expansion until the current boundary, LSP, distribution,
  independent consumer, and product-value obligations have executable evidence.
  The documentation index and owning topic test plans now route that work
  through issue-linked planned cases instead of presenting it as current
  behavior.
- **Breaking vocabulary lookup API queued for v0.4.0.**
  `colorful_ir::vocabulary::{visual_role, visual_role_for, projection}` now
  return `Option` instead of a bare `VisualRole` / `RoleProjection` reference.
  This is an intentional major-line change, not patch-compatible behavior:
  callers adopting `0.4.x` must handle the fallible result explicitly. No
  compatibility wrappers preserve the old panic/`.expect()` contract. The
  public axis lookup returns `None` for caller-supplied combinations without an
  authored mapping; manifest validation guarantees every current `PosClass`
  and generated `VisualRole` maps to `Some`. A compile-time signature test
  durably pins all three `Option` return types.
- **Breaking API queued for v0.4.0.** `colorful_ir::from_classification` is a
  public function and now takes two additional mandatory parameters,
  `parser_identity: PassIdentity` and `annotator_identity: PassIdentity`.
  Downstream crates calling it directly must update call sites (pass each
  producer's `pass_identity()`) before adopting the `0.4.x` line; there is no
  compatible 4-argument entry point, since a default identity would be exactly
  the dishonest placeholder `PassIdentity` is designed to reject.
- **Breaking API queued for v0.4.0.** `colorful_ir::ValidationError` now
  carries a structured `path: Path` on every variant (e.g.
  `tokens[3].byteRange.startUtf8`) instead of the old ad hoc `what: String` /
  `index: usize` fields, and a new `ValidationError::path()` plus a `Display`
  impl (`"at {path}: ..."`) replace the previous `{:?}`-based rendering in
  `ValidationErrors`. `validate_document`'s pass/fail verdict is unchanged —
  it is now composed from seven independently testable validators
  (`validate_contract_identity`, `validate_source_identity`,
  `validate_token_ranges`, `validate_token_axes`, `validate_structure_graph`,
  `validate_diagnostics`, `validate_derivation`) run in that fixed order, so
  error ordering is still deterministic — but it is not byte-for-byte the old
  order: token range/duplicate-id errors and token axis errors used to be
  interleaved per token in one loop and are now two separate stages, so all
  of a document's range/duplicate-id errors precede all of its axis errors
  rather than alternating token by token. A new test
  (`error_order_follows_the_seven_validator_stages`) pins the new stage
  order. Any downstream code matching on the old field names, or depending
  on the exact previous interleaving, must update.
- **`syntax_schema_hash()` now normalizes against description-only edits.**
  It previously hashed `colorful.syntax/v1`'s raw SDL bytes verbatim,
  so a cosmetic GraphQL description fix (with no field, type, or wire
  behavior change) would still change `schemaHash` and, transitively,
  `contractVersion` compatibility checks. It now strips description string
  literals before hashing; a real shape change (a new field, a renamed
  type, a new enum value) still changes the hash. `schemaHash`'s current
  value has therefore changed as of this release even though nothing in the
  wire contract's shape did — treat this the same as any other
  `contractVersion`-adjacent identity change.

### Fixed

- **Documented downstream discovery floor corrected from `0.2.1` to `0.3.0`.**
  `README.md` and the downstream-consumers topic stated Graft/jedit discovery
  requires `colorful --version` to report `0.2.1` or newer. A new executable
  compatibility matrix (`scripts/version-compat-matrix.sh`), which builds the
  real, immutable `v0.2.1` and `v0.3.0` tags, proves this floor was never
  satisfiable: the `--version` flag itself did not exist until five commits
  after the `v0.2.1` tag (first shipping in `v0.3.0`), so a version-probing
  discovery mechanism cannot detect `v0.2.1` as compatible. The docs now state
  the provable floor, `0.3.0`.
- **`DerivationStep`'s schema description overstated `derivation` as full
  provenance.** `colorful.syntax/v1`'s SDL described `DerivationStep` as "for
  provenance and replay"; the actual guarantee (IR-8) is a trace seed — an
  honest `passId`/`ruleId` producer identity, not yet replayable provenance,
  as `docs/topics/ir/{README.md,test-plan.md}` already correctly stated.
  Corrected the description in both `contracts/colorful/syntax.v1.graphql`
  and its package-local copy, and softened matching "provenance" language in
  `colorful-ir`'s own doc comments. `syntax_schema_hash()` now strips GraphQL
  description strings before hashing (see below), so this description-only
  correction does not change `schemaHash`.
- **CLI line/column reporting missed non-LF line endings.**
  `colorful_cli::line_col` (used by `colorful lint`'s report and
  `diagnose --json`'s `line`/`column` fields) only split on `\n`, so a `\r\n`
  pair double-counted as two line breaks and a bare `\r` (classic Mac line
  endings) never advanced the line at all — disagreeing with
  `colorful_lsp`'s `LineIndex`, which already handled both correctly. Fixed
  to recognize `\n`, `\r\n` (as one break), and a bare `\r`, matching the
  LSP exactly.
- **Paragraph boundaries missed non-LF line endings.** `colorful_ir`'s outline
  builder counted raw `\n` bytes to detect a blank line, so a source using `\r`
  only (classic Mac line endings) never split into paragraphs. A named
  `logical_line_break_count` now counts `\n`, `\r`, and `\r\n` as one break
  each — never double-counting a `\r\n` pair — and a paragraph boundary
  requires at least two such breaks with only whitespace between them.
- **Empty derivation trace bypassed identity validation.**
  `colorful_ir::validate_document` iterated `derivation` to check each step's
  pass identity, but a document with `derivation: []` made that loop run zero
  times, vacuously passing validation despite claiming no producer identity at
  all. `validate_document` now rejects an empty `derivation` explicitly via
  `ValidationError::EmptyDerivation`.

### Security

- **`ValidationError`'s `Display` output could carry forged log lines or
  terminal control sequences from an untrusted document.** `contractVersion`,
  the schema/vocabulary/content hash "found" values, and derivation `passId`
  are attacker-controlled strings once a document arrives over a boundary;
  rendering them verbatim let a hostile artifact inject a newline (forging
  extra lines) or a raw escape sequence into any consumer that prints the
  error text — `crates/colorful-ir/examples/recanon.rs` writes it straight to
  stderr. These fields now render through `escape_debug()` before
  interpolation, so control characters come out as visible, inert escapes
  (e.g. `\n`, `\u{1b}`) instead of being interpreted by the terminal.
- **`brace-expansion` DoS ([GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp)).**
  Bumped `editors/vscode`'s transitive `brace-expansion` (via
  `vscode-languageclient` → `minimatch`) from `2.1.1` to `2.1.2`, closing an
  exponential-time regex DoS on crafted `{}` groups. `minimatch`'s own
  declared range (`^2.0.1`) already permitted the patched version; no
  `package.json` change was needed.

## [0.3.0] - 2026-06-27

### Added

- **Open-class POS contract.** `colorful-core` now has explicit
  `OpenClassKind::{Noun, Verb, Adjective, Adverb}` carried by
  `PosClass::Open`, plus a deterministic `SeedOpenClassLexicon` adapter in
  `colorful-lexicon`.
- **Contextual open-class annotator.** `colorful-lexicon` now ships
  `ContextualOpenClassAnnotator`, a deterministic `Annotator` adapter that
  disambiguates a small ambiguous set (`book`, `record`, `lead`, `fast`) from
  local sentence context while preserving the seed lexicon and existing surface
  contracts.
- **Open-class IR/vocabulary axes.** `colorful.syntax/v1` now carries optional
  `openClassKind` on `WORD` / `CONTENT` tokens, and the
  `colorful.vocabulary/v1` manifest maps noun, verb, adjective, and adverb axes
  to distinct ANSI, LSP, and graft projections.
- **Local source install.** `scripts/install-local.sh` installs or upgrades the
  local `colorful` CLI into `$HOME/.colorful-language/bin` with
  `cargo install --path ... --root ... --force`, giving Graft and jedit a stable
  development-time binary path.
- **CLI diagnostic JSON.** `colorful diagnose --json [FILE]` now emits a
  machine-readable troubleshooting report showing each token's text, byte range,
  class axes, visual role, ANSI projection, graft class, LSP token type, and LSP
  legend index.
- **Release profile and executable gates.** `.continuum/release.yml` now declares
  Colorful's release mechanics, and `scripts/release-profile-check.sh`,
  `scripts/release-prep.sh`, and `scripts/release-preflight.sh` make the
  profile, prep, and tag guards executable.
- **Release workflow metadata and rerun guards.** The tag-triggered release
  workflow now validates release metadata against the tag and skips crates whose
  exact release version is already available in the crates.io index during
  reruns.

### Changed

- **Breaking API.** `PosClass` is a public enum and now includes
  `PosClass::Open(OpenClassKind)`. Downstream crates that exhaustively match on
  `PosClass` must handle the new variant before adopting the `0.3.x` line.
- **Documentation routing.** Repository policy and maintainer workflow
  references now live under `docs/workflows/` instead of the product-oriented
  `docs/topics/` corpus.
- **Release lifecycle.** The release runbook now adapts the Continuum lifecycle
  to this repo: thesis, milestone scope, signposts, release-prep PRs, immutable
  tags, tag-triggered publication, public verification, and retrospectives.
- **Default open-class path.** The CLI colorizer, `colorful ir`, CLI lint, and
  `colorful-lsp` now use `ContextualOpenClassAnnotator` by default, so seeded and
  supported context-disambiguated noun, verb, adjective, and adverb words carry
  distinct ANSI colors, `openClassKind` values, and LSP semantic token types.
  Unlisted content words remain `Content`.
- **IR generator pin.** The committed Wesley-generated Rust and TypeScript DTOs
  are now recorded as emitted with `wesley 0.1.1`.

### Fixed

- **VS Code Plain Text highlighting.** The VS Code source extension now declares
  Colorful's `noun`, `verb`, `adjective`, and `adverb` semantic token types,
  enables semantic highlighting for Plain Text and Markdown, maps custom tokens
  to fallback TextMate scopes, and exposes a **Colorful Language** output channel
  for startup diagnostics.
- **Zed Plain Text activation.** The Zed source extension now honors
  `lsp.colorful-lsp.binary.path` before falling back to `PATH`, and its docs
  explain that Zed semantic tokens and custom semantic token rules must be
  enabled for Plain Text highlighting.
- **CLI version probe.** `colorful --version` and `colorful -V` now print the CLI
  package version, so Graft can enforce its `colorful >= 0.2.1` prose projection
  contract before shelling through `colorful ir -`.

## [0.2.1] - 2026-06-24

`v0.2.1` is the public recovery release for the failed `v0.2.0` tag workflow.
The `v0.2.0` tag published only `colorful-core`, `colorful-lexicon`, and
`colorful-parse` before `colorful-ir` failed package verification; no GitHub
Release was created for `v0.2.0`.

### Fixed

- **colorful-ir package contents.** `colorful-ir` now carries package-local copies
  of the GraphQL and vocabulary contract inputs it embeds with `include_str!`.
  The crate tarball can compile on its own, instead of depending on root-level
  workspace files that are not present during crates.io verification.
- **Release package witness.** CI and the tag-triggered `Release` workflow now
  run `scripts/package-witness.sh`, which packages all publishable crates,
  extracts the tarballs, and checks the extracted package workspace before any
  release publish can proceed.

## [0.2.0] - 2026-06-24

### Added

- **Prose linter (Goalpost 1).** A new `Analyzer` port in `colorful-core`
  (`Tree` + classified tokens → `Vec<Finding>`) and a `colorful-lint` crate that
  implements it as `ProseLinter` — a configurable, deterministic rule pack:
  `weak-word` (filler words), `run-on` (overlong sentences), `length-outlier`
  (sentences far past the document mean), and `passive-voice` (be-auxiliary +
  past participle). Surfaced two ways: `colorful lint [FILE]` prints
  compiler-style warnings and exits non-zero when any are found, and
  `colorful-lsp` publishes them as live diagnostics on open/change. See
  `docs/topics/linting/`.
- **Editor Reach (Phase 3).** A VS Code extension (`editors/vscode/`) and a Zed
  extension (`editors/zed/`, Rust→WASM) that drive `colorful-lsp`, plus
  copy-paste config recipes (`editors/README.md`) for Neovim, Helix, Emacs,
  Sublime, and Kate. One LSP engine, thin per-editor adapters. CI compiles both
  extensions.
- **IR Spine (Phase 1).** `colorful.syntax/v1` — a Wesley-generated GraphQL
  contract emitted as canonical JSON by `colorful ir [FILE]`. New `colorful-ir`
  crate holds the generated Rust + TypeScript boundary DTOs (pinned wesley
  `0.0.5`) and the `from_classification` projection; `colorful-core` stays free of
  generated types. A cross-language round-trip witness (`scripts/ir-witness.sh`,
  CI-enforced) proves the IR survives `Rust → JSON → TypeScript → JSON → Rust`
  byte-for-byte. The contracts split `PosClass` into orthogonal
  `TokenKind`/`LexicalClass`/`FunctionKind` axes, use UTF-8 `ByteRange`, and carry
  source digests + a derivation trace seed (not yet replayable provenance).
- **Vocabulary manifest (`colorful.vocabulary/v1`).** Presentation now lives in
  one versioned manifest (`contracts/colorful/vocabulary.v1.json`): token axes →
  `VisualRole` → `{ANSI, LSP token type, graft class}`. Its hash **is** the IR's
  `vocabularyHash`, so the hash certifies presentation behavior, and the CLI
  (`sgr`), the language server (legend + token indices), and the graft reference
  consumer (`className`) all derive their colors from it instead of keeping
  private copies. The graft consumer rejects an artifact whose `vocabularyHash`
  does not match its manifest.

- **IR boundary validation.** `colorful_ir::validate_document(&DocumentAnalysis,
  Option<&[u8]>)` checks a received artifact against the `colorful.syntax/v1`
  contract — contract version, schema/vocabulary hashes, content hash and byte
  length against the supplied source, byte-range order/bounds/UTF-8 boundaries,
  token-axis legality, occurrence/node id uniqueness, and outline child
  references — collecting every failure rather than the first. The witness
  `recanon` leg now validates against the real source before re-emitting, so the
  round-trip rejects a malformed document instead of laundering it.

### Fixed

- **IR projection rejects oversized input instead of wrapping.**
  `colorful_ir::from_classification` now returns `Result<_, ProjectionError>`:
  every narrowing of a byte offset, source length, token index, or outline id to
  the contract's `i32` goes through `i32::try_from`, so a document past the
  ~2 GB wire range is refused rather than silently wrapped negative. `colorful
  ir` surfaces the error instead of emitting a corrupt artifact.
- **graft reference consumer coordinates.** `consumers/graft-projection.mjs`
  read the source as a JavaScript string and indexed it in UTF-16 code units
  while comparing against the IR's UTF-8 byte offsets, corrupting every token
  position after a non-ASCII character; it also recognized only `\n`. It now
  indexes the source as raw bytes, derives columns by decoding only the line
  prefix, recognizes the LSP line-ending set (`\n`, `\r\n`, `\r`), and verifies
  the source against the IR's `contentHash` before projecting. Pinned by
  `consumers/graft-projection.test.mjs` (CI-enforced).

## [0.1.0] - 2026-06-21

First public release — **Goalpost 0, "English lights up."**

### Added

- Project scaffold: Apache-2.0 license, community files, documentation spine,
  and the initial `ROADMAP.md` describing the release train toward Goalpost 0
  ("English lights up").
- Founding architecture decision records (ADR-0001..0003).
- **Goalpost 0 — "English lights up":** a cargo workspace delivering
  closed-class and structural part-of-speech coloring of English prose.
  - `colorful-core` — domain types (`Span`, `PosClass`, `Node`, `Tree`) and the
    `Parser`, `Lexicon`, and `Annotator` ports, plus `LexicalAnnotator` (the
    proper-noun heuristic with line-break and title-case guards, and structural
    quote/punctuation classification).
  - `colorful-lexicon` — a compile-time perfect-hash closed-class function-word
    set (including common contractions and negation) implementing `Lexicon`.
  - `colorful-parse` — a `logos` lexer and sentence segmenter implementing
    `Parser`; total (never panics) over arbitrary input, and it absorbs trailing
    closing quotes/brackets.
  - `colorful-cli` — the `colorful` binary: ANSI prose coloring with `--no-color`
    / `NO_COLOR` passthrough and `--` end-of-options.
  - `colorful-lsp` — the `colorful-lsp` binary: a `tower-lsp` server emitting
    skeleton semantic tokens with UTF-16 column handling (incl. CR/CRLF) and
    incremental `ropey`-backed edits clamped to line bounds.
  - Topic docs for parsing, lexicon, and coloring with executable test plans.
  - Hardened during a multi-reviewer pass before merge: the context-free `Tagger`
    port was split into `Lexicon` + `Annotator` so Goalpost 2's contextual
    disambiguation can slot in behind a port; an LSP cross-line edit-clamp bug was
    fixed; coloring moved to skeleton mode (content left unstyled); edits and
    semantic tokens were unified on the LSP line model; `is_number` accepts
    Unicode `\p{N}`; letter-initial alphanumeric words (`covid19`) stay whole.

[Unreleased]: https://github.com/flyingrobots/colorful-language/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/flyingrobots/colorful-language/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/flyingrobots/colorful-language/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/flyingrobots/colorful-language/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/flyingrobots/colorful-language/releases/tag/v0.1.0
