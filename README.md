<div align="center"><h1>colorful-language</h1>
<h3><code>IDE-grade syntax highlighting for English prose.</code></h3></div>

_Open a `.txt`, essay draft, novel chapter, or design doc and watch the grammar light up, just like your editor does for code. Function words become **keywords**, proper nouns pop as **types**, quotes glow as **strings**, and the skeleton of every sentence becomes visible._

## Why?

Programmers get rich feedback from their editors because code has visible
structure. Prose usually gets spellcheck, grammar guesses, or a wall of plain
text. That leaves the structure of a sentence — the little words that carry
logic, emphasis, negation, scope, and rhythm — harder to see than it should be.

Colorful makes English visible as a local, deterministic syntax surface. No
cloud, no model, no hidden judgment. It shows the shape of prose the way a code
highlighter shows the shape of a program. The same parse feeds CLI highlighting,
lint warnings, LSP diagnostics, and the `colorful.syntax/v1` surface IR.

That is the current contract. Future phases are tracked in the
[roadmap](ROADMAP.md), not promised by this README.

## Try it now (30 seconds)

```bash
# Install the CLI
cargo install colorful-cli

# Color a file (or pipe stdin)
colorful my-essay.txt
cat README.md | colorful

# Lint it for weak words, run-ons, and passives (exits non-zero on findings)
colorful lint my-essay.txt
```

Or just:

```bash
colorful --help
colorful --version
```

It works on any text file and respects `NO_COLOR`.

<div align="center"><img width="739" height="817" alt="Screenshot 2026-06-21 at 12 20 52" src="https://github.com/user-attachments/assets/ed433423-aa53-4da1-98fc-148b26213fa1" /></div>

---

## Editor Support (LSP)

> [!note]
> The integrations exist and build in CI; they are **not yet published** as
> editor marketplace packages. Install from source today; marketplace/registry
> publishing is tracked separately.

The real magic is the **Language Server** (`colorful-lsp`), which gives live
coloring — and, as of Goalpost 1, live lint diagnostics — in any LSP editor:

- **VS Code** / **Cursor** — source extension in [`editors/vscode/`](editors/vscode/)
- **Zed** — source extension in [`editors/zed/`](editors/zed/)
- **Neovim**, **Helix**, **Emacs**, **Sublime**, **Kate** — copy-paste config
  recipes in [`editors/README.md`](editors/README.md)

Build the server with `cargo install colorful-lsp` (or from source) and point your
editor at it per the recipes above. See
[`docs/topics/editor-integrations/`](docs/topics/editor-integrations/) for the
current integration boundary, evidence, and theme caveats.

---

## Use with jedit and graft

jedit receives prose structure through Graft. Graft discovers Colorful by finding
a `colorful` CLI on `PATH`, checking that `colorful --version` reports version
`0.2.1` or newer, and then projecting `.txt` buffers through `colorful ir -`.

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
- **Proper nouns** (mid-sentence capitalized words) → highlighted
- **Numbers** → highlighted
- **Quotes** → highlighted as strings
- **Sentence structure** made visible
- Unlisted content words stay clean (skeleton mode; no color overload)

No cloud. No ML. Blazing fast and 100% local.

---

## Lint your prose (Goalpost 1)

`colorful lint` turns the same parse into a writing linter that flags what a
shallow read can already see:

- **Weak / filler words** — `very`, `really`, `just`, `actually`, …
- **Run-on sentences** — past a word-count threshold
- **Length outliers** — sentences far longer than the document's average
- **Passive-voice candidates** — `was reviewed`, `is broken`, …

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

English has a small, finite set of **closed-class words** (function words) that act exactly like programming keywords. By focusing on those + simple structural rules + a light proper-noun heuristic, we get something _immediately useful_ without the complexity.

It's deterministic, auditable, and built to grow.

---

## Architecture (for the curious)

Built as a **Rust hexagon** (ports & adapters):

- Pure core with three clean seams: `Parser` → `Lexicon` → `Annotator`
- Easy to extend (prose linter, better disambiguation, etc.)
- CLI + LSP adapters reuse the same logic

See [`docs/design/`](docs/design/) for the thinking.

---

## Project Status

**Current release — `v0.2.1`.** Goalpost 1 ("prose linter") is released.

See the [Releases](https://github.com/flyingrobots/colorful-language/releases)
page for downloads, the [CHANGELOG](CHANGELOG.md) for the ledger, and the full
[ROADMAP.md](ROADMAP.md) for what's next.

---

## Installation

**From crates.io** (installs the `colorful` CLI and the `colorful-lsp` server):

```bash
cargo install colorful-cli
cargo install colorful-lsp
```

**Prebuilt binaries:** download the archive for a tagged release from the
[Releases](https://github.com/flyingrobots/colorful-language/releases) page.

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

The **prose linter** (Goalpost 1) has landed on `main`; contributions that grow
its rule pack, or that continue **open-class disambiguation**
(noun/verb/adjective/adverb, Goalpost 2), are especially welcome right now.

---

## License

[Apache License 2.0](LICENSE)

---

<div align="center"><h4>Made by <a href="https://github.com/flyingrobots">FLYING ROBOTS</a></h4></div>
