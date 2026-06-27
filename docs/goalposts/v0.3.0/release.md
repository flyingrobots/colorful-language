# colorful-language v0.3.0 — Release Packet

## Summary

`v0.3.0` ships the core/default path for **Goalpost 2, "open-class
disambiguation."** Colorful now distinguishes deterministic noun, verb,
adjective, and adverb roles instead of treating every ordinary content word as
undifferentiated text.

The release keeps the same hexagonal shape: parsing remains structural, closed
class lookup remains a `Lexicon`, and context-aware open-class decisions live
behind the `Annotator` port. The default CLI, IR, linter, and LSP surfaces all
use the same `ContextualOpenClassAnnotator`, so terminal colors, editor semantic
tokens, and `colorful.syntax/v1` agree.

## Included scope

- `colorful-core` adds `OpenClassKind::{Noun, Verb, Adjective, Adverb}` and
  `PosClass::Open(OpenClassKind)`.
- `colorful-lexicon` adds `SeedOpenClassLexicon`, a deterministic seed table for
  representative nouns, verbs, adjectives, and adverbs.
- `colorful-lexicon` adds `ContextualOpenClassAnnotator`, which refines a small
  ambiguous set (`book`, `record`, `lead`, `fast`) using local sentence context.
- The default CLI colorizer, `colorful ir`, CLI linting path, and
  `colorful-lsp` semantic-token path use the contextual annotator by default.
- `colorful.syntax/v1` carries optional `openClassKind` on valid `WORD` /
  `CONTENT` tokens, and validation rejects illegal open-class axes.
- `colorful.vocabulary/v1` maps noun, verb, adjective, and adverb axes to
  distinct ANSI, LSP, and graft projections.
- `colorful diagnose --json [FILE]` emits a machine-readable token projection
  report for comparing CLI, LSP, Zed, jedit, and other consumers.
- `colorful --version` and help output report the package version, so downstream
  tools can enforce a minimum Colorful version.
- `scripts/install-local.sh` installs or upgrades the local `colorful` CLI into
  `$HOME/.colorful-language/bin` for Graft and jedit development.
- The VS Code source extension declares Colorful's custom semantic token types,
  enables semantic highlighting for Plain Text and Markdown, maps fallback
  TextMate scopes, and exposes a **Colorful Language** output channel.
- The Zed source extension maps **Plain Text** to the `plaintext` LSP language
  id and honors `lsp.colorful-lsp.binary.path` before falling back to `PATH`.
- The committed Wesley-generated IR DTOs are recorded as emitted with
  `wesley 0.1.1`.
- The release and distribution docs now state the current binary artifact
  boundary precisely: one Linux `x86_64-unknown-linux-gnu` archive containing
  both `colorful` and `colorful-lsp`.

## Who it's for

- Writers who want more visible structure in plain English without sending text
  to a model or service.
- Editor users comparing terminal, Zed, VS Code, jedit, and LSP output against a
  deterministic token report.
- Tooling authors consuming `colorful.syntax/v1` who need explicit open-class
  axes instead of collapsing all ordinary content to one bucket.
- Downstream tools such as Graft that need stable version probing before
  shelling through `colorful ir -`.

## Version justification

`0.3.0` is a pre-1.0 minor release because it changes public API and public
behavior:

- `PosClass` is public and now has the new `Open(OpenClassKind)` variant.
- `colorful.syntax/v1` artifacts may now carry `openClassKind`.
- The vocabulary manifest adds public noun, verb, adjective, and adverb
  projection roles.
- The default CLI/LSP/IR path now emits explicit open-class roles for seeded and
  supported context-disambiguated words.
- The CLI adds the public `diagnose` troubleshooting surface.

Pre-1.0 minor versions may carry breaking API changes. This is not a patch
release because downstream code that exhaustively matches `PosClass` must update
before adopting the `0.3.x` line.

## Explicit non-claims

- **Not a full grammar parser.** Structure is still shallow: paragraphs,
  sentences, words, punctuation, quotes, and presentation roles.
- **Not broad NLP.** The open-class path is deterministic, local, and deliberately
  small. It is not WordNet coverage, a statistical tagger, or an ML model.
- **Not a complete Goalpost 2 theme package.** Custom token types are emitted,
  but some editor themes still need explicit semantic-token rules.
- **Editor marketplace packages are not published.** VS Code and Zed source
  integrations build in CI and can be installed from source; registry publishing
  remains a later packaging task.
- **Graft and jedit are not bundled.** Colorful provides the CLI, LSP, and IR
  surfaces they consume; downstream release trains remain separate.
- **Not replayable provenance.** `colorful.syntax/v1` carries source digests and
  derivation trace seed data, but it does not yet claim echo replay or witnessed
  provenance.
- **No native macOS or Windows binary archives.** Release assets remain one Linux
  `x86_64-unknown-linux-gnu` archive plus crates.io packages.
- **No Homebrew formula.** Homebrew packaging remains a separate tracked slice.
- **Controlled English is not shipped.** Contract English, Intent English, and
  proof-carrying execution remain roadmap phases.

## Acceptance

- `OpenClassKind` and `PosClass::Open` are covered by `colorful-core` port
  contract tests.
- `SeedOpenClassLexicon` precedence and role coverage are covered by
  `colorful-lexicon` tests.
- `ContextualOpenClassAnnotator` is covered for `book`, `record`, `lead`, and
  `fast`, including preservation of closed-class, number, proper-noun,
  punctuation, and seed behavior.
- CLI golden tests cover seeded and contextual open-class output.
- IR tests cover open-class projection, vocabulary role mapping, and illegal
  `openClassKind` combinations.
- LSP tests cover seeded and contextual open-class semantic tokens in the
  manifest-backed legend.
- Lint tests cover weak-word handling for both `Content` and `Open(_)` tokens.
- `colorful diagnose --json` is covered for report shape, LSP token type
  projection, the editor smoke fixture, and invalid operand handling.
- VS Code and Zed source integrations compile in CI.
- The release gate in [`docs/RELEASING.md`](../../RELEASING.md) passes before
  the release-prep PR is merged.

See [`verification.md`](verification.md) for the release witness.
