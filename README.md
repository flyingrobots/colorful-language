<div align="center">
  <img alt="Colorful Language" src="https://github.com/user-attachments/assets/94c48976-9b6d-49fa-a634-7aab2d302592" />
    <h3><strong><i>“Easier said than done.”</i></strong></h3>
<h3><code>IDE-grade syntax highlighting for English prose.</code></h3>
</div>

_Open a `.txt`, essay draft, novel chapter, or design doc and watch the grammar light up, just like your editor does for code. Function words become **keywords**, proper nouns pop as **types**, quotation marks glow as **strings** while the words inside keep their own roles, and the skeleton of every sentence becomes visible._

## Why?

Programmers get rich feedback from their editors because code has visible
structure. Prose usually gets spellcheck, grammar guesses, or a wall of plain
text. That leaves the structure of a sentence — the little words that carry
logic, emphasis, negation, scope, and rhythm — harder to see than it should be.

Colorful makes English visible as a local, deterministic syntax surface. No
cloud, no opaque model: every token's classification comes from an
inspectable, local pipeline — a [lexicon](docs/topics/lexicon/) of
closed-class words plus the deterministic
[classification rules](docs/topics/coloring/) layered on top (a proper-noun
heuristic, contextual disambiguation for a small ambiguous set) — and the
separate [lint rules](docs/topics/linting/) that flag prose issues from that
already-classified stream are equally local and inspectable. Nothing here is
a black box. It shows the shape of prose the way a code highlighter shows the
shape of a program. The same parser, tree, classification model, and analyzer
ports underlie CLI highlighting, lint warnings, and LSP diagnostics.
`colorful-projection` turns that shared analysis into the separate
`colorful.syntax/v1` wire contract for external consumers.

That is the current contract. Future phases are tracked in the
[roadmap](ROADMAP.md), not promised by this README.

## Requirements

Rust 1.97.1 is the reviewed compiler for repository and release evidence.
The checked-in `rust-toolchain.toml` selects it automatically in a source
checkout. Published crates intentionally do not declare a minimum supported
Rust version (MSRV): 1.97.1 is the reproducibility oracle, not a claimed lower
compatibility bound, and older compilers are unverified.

Contributors running JavaScript evidence or building the VS Code adapter use
Node 22.23.1 and TypeScript 5.9.3. Version managers can read `.node-version`;
`npm ci` at the repository root and in `editors/vscode/` reproduces the two
locked dependency graphs. See the
[evidence-toolchain workflow](docs/workflows/evidence-toolchains/) for version
ownership and forward-compatibility policy.

## Try it now (30 seconds)

```bash
# Install the CLI
cargo install colorful-cli

# Color a file (or pipe stdin)
colorful my-essay.txt
cat README.md | colorful

# Lint it for weak words, run-ons, and passives (exits non-zero on findings)
colorful lint my-essay.txt

# Inspect the exact token roles and editor projections
colorful diagnose --json my-essay.txt | python3 -m json.tool
```

Or just:

```bash
colorful --help
colorful --version
```

It works on any valid UTF-8 text file and respects `NO_COLOR`. A file with
invalid UTF-8 bytes is rejected with a clear error, not silently mangled —
see [`docs/topics/coloring/`](docs/topics/coloring/) for the exact contract.
Use `colorful diagnose --json` when comparing terminal, Zed, jedit, or another
editor against the classes Colorful actually produced for format-neutral or
Plain Text input. The current diagnostic report and canonical IR deliberately
remain whole-source projections; `.md`/`.markdown` region selection applies to
file coloring, linting, and LSP analysis.

For a committed smoke sample with denser prose and deterministic POS probes, run:

```bash
colorful diagnose --json crates/colorful-cli/fixtures/editor-smoke-prose.txt \
  | python3 -m json.tool
```

<div align="center"><img width="739" height="817" alt="A terminal running `cat README.md | colorful`: this file's own prose rendered with function words in bold magenta, proper nouns and acronyms in bold yellow, quotation marks in green, numbers in cyan, punctuation in dim gray, and unlisted content words left in the default color." src="https://github.com/user-attachments/assets/ed433423-aa53-4da1-98fc-148b26213fa1" /></div>

The screenshot above pipes this README through `colorful` itself. The visible
token-role mapping (see [`docs/topics/coloring/`](docs/topics/coloring/) for
the exact contract):

| What's highlighted | Example | Terminal color |
| --- | --- | --- |
| Closed-class function words | `and`, `for`, `the`, `is`, `with` | bold magenta |
| Proper nouns and capitalized acronyms | `English`, `NLP`, `CLI`, `LSP` | bold yellow |
| Quotation marks | `"`, `"` | green (enclosed words keep their own styling) |
| Numbers | `0.1.0` | cyan |
| Punctuation | `,`, `.`, `:` | dim gray |
| Everything else (unlisted content words) | — | default terminal color |

---

## Editor Support (LSP)

> [!note]
> The integrations exist, build in CI, and have isolated pre-publication
> package smoke evidence; they are **not yet published** as editor marketplace
> packages. The tag workflow is prepared to publish one smoke-tested VSIX to
> both VS Code registries and package licensed Zed source, but no current
> reference claims those destinations before public URLs and rollback evidence
> exist. Install from source today.

The real magic is the **Language Server** (`colorful-lsp`), which gives live
coloring — and, as of Goalpost 1, live lint diagnostics — in any LSP editor:

- **VS Code** / **Cursor** — source extension in [`editors/vscode/`](editors/vscode/)
- **Zed** — source extension in [`editors/zed/`](editors/zed/)
- **Neovim**, **Helix**, **Emacs**, **Sublime**, **Kate** — copy-paste config
  recipes in [`editors/README.md`](editors/README.md)

From this source checkout, install the synchronized server with
`cargo install --path crates/colorful-lsp --locked` and point the source editor
adapter at it per the recipes above. Compatible public adapter/server artifacts
do not exist yet. See
[`docs/topics/editor-integrations/`](docs/topics/editor-integrations/) for the
current integration boundary, timing witness, text-equivalent visual demo,
evidence, and theme caveats.

---

## Use with jedit and graft

jedit receives prose structure through Graft. Graft discovers Colorful by finding
a `colorful` CLI on `PATH`, checking that `colorful --version` reports version
`0.3.0` or newer, and then projecting `.txt` buffers through `colorful ir -`.
The floor is `0.3.0`, not `0.2.1`: the `--version` flag itself did not exist
until after the `v0.2.1` tag, so a version-probing discovery mechanism cannot
detect `v0.2.1` as compatible in the first place. See
[`docs/topics/downstream-consumers/`](docs/topics/downstream-consumers/) for
the executable compatibility matrix that proves this.

For source-checkout development, install the local CLI into a stable user
directory:

```bash
scripts/install-local.sh
export PATH="$HOME/.colorful-language/bin:$PATH"
colorful --version
```

Re-run `scripts/install-local.sh` after pulling new Colorful commits. The script
uses `cargo install --force`, so install and upgrade are the same operation.

Then launch jedit with that `PATH`:

```bash
cd ~/git/jim/jedit
PATH="$HOME/.colorful-language/bin:$PATH" npm run dev
```

Open a `.txt` file in jedit. When Graft can find the CLI, the buffer is projected
from the same `colorful.syntax/v1` IR that `colorful ir` prints at the terminal.
See [`docs/topics/downstream-consumers/`](docs/topics/downstream-consumers/) for
the consumer boundary.

---

## What it does (v0 = "English lights up")

- **Closed-class words** (the, of, and, is, not, etc.) → highlighted like keywords
- **Seed open-class words** → representative nouns, verbs, adjectives, and adverbs
  get distinct roles
- **Contextual open-class words** → supported ambiguous words such as `book` and
  `fast` disambiguate from local sentence context
- **Proper nouns** (mid-sentence capitalized words) → highlighted
- **Numbers** → highlighted
- **Quotation marks** → highlighted as strings; the words they enclose keep
  their own roles
- **Sentence structure** made visible
- Unlisted content words stay clean (skeleton mode; no color overload)

No cloud. No ML. 100% local. Measured, release-mode CLI and LSP latency —
hardware, corpus, toolchain, and date — lives in
[`docs/topics/coloring/`](docs/topics/coloring/), not a marketing adjective.

---

## Lint your prose (Goalpost 1)

`colorful lint` turns the same parse into a writing linter that flags what a
shallow read can already see:

- **Weak / filler words** — `very`, `really`, `just`, `actually`, …
- **Run-on sentences** — past a word-count threshold
- **Length outliers** — sentences far longer than the document's average
- **Passive-voice candidates** — `was reviewed`, `was carefully cleaned`, …

Run:

```bash
colorful lint draft.txt
```

Representative output:

```text
draft.txt:3:12: warning [run-on]: sentence runs to 47 words
draft.txt:5:1: info [weak-word]: weak word 'really'
```

It exits non-zero when it finds anything, so you can drop it straight into a CI
gate. The same findings show up live as editor diagnostics through `colorful-lsp`.

---

## Why this actually works

Most "parse English" projects go straight to heavy NLP. We took a smarter shortcut:

English has a small, finite set of **closed-class words** (function words) that
act exactly like programming keywords. By focusing on those, a small
deterministic open-class seed table, local contextual disambiguation, and a light
proper-noun heuristic, we get something _immediately useful_ without the
complexity.

It's deterministic, auditable, and built to grow.

---

## Architecture (for the curious)

Built as a **Rust hexagon** (ports & adapters). `colorful-core` defines four
pure, I/O-free ports:

- `Parser` — text to a structural tree (sentences, words, punctuation spans).
- `Lexicon` — a single word, in isolation, to a part-of-speech class.
- `Annotator` — a parsed tree to a classified token stream, with context.
- `Analyzer` — source, tree, and tokens to prose findings (the linter's port).

The CLI and LSP are adapters: both reuse the same `Parser`/`Lexicon`/
`Annotator`/`Analyzer` implementations directly — they do not consume the
serialized `colorful.syntax/v1` IR. Building that IR (for graft, jedit, or any
external consumer) is a separate concern, `colorful-projection`'s job, layered
on top of the same ports rather than replacing them.

See [`docs/design/`](docs/design/) for the original ports-and-adapters
decision record, [`docs/topics/linting/`](docs/topics/linting/) for the
`Analyzer` port and its rule pack, and
[`docs/topics/ir/architecture.md`](docs/topics/ir/architecture.md) for the IR
producer/consumer boundary.

---

## Project Status

**Latest published release — `v0.3.0`. Current `main` workspace version —
`0.4.0` (unreleased).** The current source tree contains deterministic
open-class noun/verb/adjective/adverb roles through the CLI, IR, LSP, and editor
adapters, plus the breaking hardening work recorded under **Unreleased** in the
changelog.

See the [Releases](https://github.com/flyingrobots/colorful-language/releases)
page for downloads, the [CHANGELOG](CHANGELOG.md) for the ledger, and the full
[ROADMAP.md](ROADMAP.md) for the preserved moonshot phases and the product
maturity runway that orders current work.

---

## Installation

**From crates.io** (installs the `colorful` CLI and the `colorful-lsp` server):

```bash
cargo install colorful-cli
cargo install colorful-lsp
```

**Prebuilt binaries:** the latest public release includes a Linux
`x86_64-unknown-linux-gnu` archive containing `colorful` and `colorful-lsp`.
Download it from the
[Releases](https://github.com/flyingrobots/colorful-language/releases) page.
The `main` tag workflow is prepared to add checksummed, provenance-attested
Apple Silicon and Windows x86-64 archives on the next deliberate release; those
are not install paths until public assets exist. Use Cargo or build from source
on macOS, Windows, and other Linux targets today.

**From git** (latest `main`):

```bash
cargo install --git https://github.com/flyingrobots/colorful-language.git colorful-cli
cargo install --git https://github.com/flyingrobots/colorful-language.git colorful-lsp
```

**From a local checkout** (best for Graft or jedit development):

```bash
scripts/install-local.sh
export PATH="$HOME/.colorful-language/bin:$PATH"
```

See [`docs/topics/distribution/`](docs/topics/distribution/) for install-path
boundaries and packaging evidence.

---

## Contributing

This project has high documentation and testing standards. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

The **prose linter** and deterministic **open-class POS** path have landed on
`main`. The active contribution priorities are boundary integrity, LSP
freshness and capacity, executable public-contract evidence, and editor
distribution. The deeper controlled-English, provenance, Edict, and Ouroboros
phases remain in the roadmap; new surface area there follows the roadmap's
evidence gate rather than outrunning the current product.

For the full documentation corpus — every topic's current behavior and test
plan, design records, and release packets — start at the
[documentation spine](docs/README.md). Contributor-facing repository
operations, including the release process, are indexed in
[`docs/workflows/`](docs/workflows/README.md).

---

## License

[Apache License 2.0](LICENSE)

---

<div align="center"><h4>Made by <a href="https://github.com/flyingrobots">FLYING ROBOTS</a></h4></div>
