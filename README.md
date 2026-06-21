<div align="center"><h1>colorful-language</h1>
<h3><code>IDE-grade syntax highlighting for English prose.</code></h3></div>

_Open a `.txt`, essay draft, novel chapter, or design doc and watch the grammar light up, just like your editor does for code. Function words become **keywords**, proper nouns pop as **types**, quotes glow as **strings**, and the skeleton of every sentence becomes visible._

## Try it now (30 seconds)

```bash
# Install the CLI
cargo install --git https://github.com/flyingrobots/colorful-language.git colorful-cli

# Color a file (or pipe stdin)
cat README.md | colorful --help
colorful my-essay.txt
```

Or just:

```bash
colorful --help
```

It works on any text file and respects `NO_COLOR`.

<div align="center"><img width="739" height="817" alt="Screenshot 2026-06-21 at 12 20 52" src="https://github.com/user-attachments/assets/ed433423-aa53-4da1-98fc-148b26213fa1" /></div>

---

## Editor Support (LSP)

> [!note]
> COMING SOON!

The real magic is the **Language Server**. Install once and get live coloring in:

- **VS Code** / **Cursor**
- **Neovim**
- **Helix**, **Zed**, **Emacs**, **JetBrains**, etc.

**Quick VS Code setup:**

(Full setup instructions coming with first release; currently in pre-release.)

---

## What it does (v0 = "English lights up")

- **Closed-class words** (the, of, and, is, not, etc.) → highlighted like keywords
- **Proper nouns** (mid-sentence capitalized words) → highlighted
- **Numbers** → highlighted
- **Quotes** → highlighted as strings
- **Sentence structure** made visible
- Everything else stays clean (skeleton mode; no color overload)

No cloud. No ML. Blazing fast and 100% local.

---

## Why this actually works

Most "parse English" projects go straight to heavy NLP. We took a smarter shortcut:

English has a small, finite set of **closed-class words** (function words) that act exactly like programming keywords. By focusing on those + simple structural rules + a light proper-noun heuristic, we get something *immediately useful* without the complexity.

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

**Pre-release.** Goalpost 0 ("English lights up") is complete.

See the full [ROADMAP.md](ROADMAP.md) for what's next (prose linter is up next!).

---

## Installation

**From source (recommended while pre-release):**

```bash
cargo install --git https://github.com/flyingrobots/colorful-language.git --bin colorful
cargo install --git https://github.com/flyingrobots/colorful-language.git --bin colorful-lsp
```

---

## Contributing

This project has high documentation and testing standards. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

Contributions toward the **prose linter** (Goalpost 1) are especially welcome right now.

---

## License

[Apache License 2.0](LICENSE)

***

<div align="center"><h4>Made by <a href="https://github.com/flyingrobots">FLYING ROBOTS</a></h4></div>
