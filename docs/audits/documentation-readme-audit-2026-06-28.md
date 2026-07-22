# Documentation & README Audit (Completeness Check) — `colorful-language`

**Date:** 2026-06-28
**Role:** Technical Writer & Senior Developer Advocate
**Scope:** `README.md` validated against the codebase, plus the supporting set (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `NOTICE`, `CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`, `editors/README.md`, `docs/`).
**Verdict:** Recommendation **A — incremental updates.** Documentation here is a strength: accurate command examples, an honest "current contract vs roadmap" stance, a complete standard-file set, and `docs/topics/` coverage per subsystem. The gaps are small and specific.

---

## 1. Accuracy & Effectiveness Assessment

### 1.1 Core Mismatch (the single most material inaccuracy)

There is **no glaring factual error** — every README command was verified against the CLI (`run()` dispatch at `crates/colorful-cli/src/lib.rs:124-130` exposes exactly `ir`/`lint`/`diagnose`/`color` + default coloring; the binary is `colorful` via `default-run`). The most material *accuracy gap* is an **omission**: the README's `cargo install colorful-cli` quickstart states **no Rust toolchain / MSRV requirement**, while `Cargo.toml` deliberately leaves `rust-version` unset. A reader on an older-but-plausible toolchain hits a cryptic compile failure that the docs neither predict nor explain. For an install-from-source tool, the missing minimum-toolchain statement is the highest-impact documentation defect.

A secondary, smaller item: the README instructs `cargo install colorful-cli` and then runs `colorful` — correct, but the **crate-name ≠ binary-name** relationship (`colorful-cli` produces a `colorful` binary) is left implicit, which can confuse first-time `cargo install` users who expect the binary to match the crate.

### 1.2 Audience & Goal Alignment

The README serves **three** audiences, and serves all of them well:

| Audience | Top question | Addressed? |
| --- | --- | --- |
| **Writers / end users** | "What does it do and how do I run it on my file?" | ✅ "Why?", "Try it now (30s)", "What it does", "Lint your prose" — concrete and honest. |
| **Editor integrators** | "How do I get live coloring in my editor?" | ✅ "Editor Support (LSP)" + `editors/README.md` + `docs/topics/editor-integrations/`, with an explicit "not yet on marketplaces" caveat. |
| **Downstream consumers (Graft/jedit)** | "How is the IR discovered and consumed?" | ✅ "Use with jedit and graft" documents the `PATH` discovery, `--version` gate, and `colorful ir -` projection. |

The honesty is a model: "That is the current contract. Future phases are tracked in the roadmap, not promised by this README."

### 1.3 Time-to-Value (TTV) Barrier

The biggest barrier is the **unstated toolchain requirement** (1.1): a fresh user runs `cargo install colorful-cli` and, on the wrong rustc, gets a wall of compiler errors with no documented cause or fix. Every other TTV element is excellent — the 30-second block is real and the commands work. A one-line "requires Rust ≥ X" note would remove the only place a new user can get stuck before first output.

---

## 2. Required Updates & Completeness Check

### 2.1 README.md Priority Fixes

1. **Add a "Requirements" line.** State the minimum Rust version actually exercised in CI (or explicitly "current stable; MSRV not yet pinned — see `Cargo.toml`"). This closes the 1.1/1.3 gap.
2. **Make the crate-vs-binary mapping explicit.** One clause: "`cargo install colorful-cli` installs the `colorful` binary." Prevents the "where did `colorful` go / I installed `colorful-cli`" confusion.
3. **Document the subcommand/filename precedence.** Note that `lint`/`ir`/`diagnose`/`color` are subcommands and how to color a file whose name collides (e.g. `colorful -- lint` or `colorful color lint`) — matches the DX ambiguity flagged in the two-phase audit.

### 2.2 Missing Standard Documentation

The standard-file set is **complete** — `LICENSE`, `NOTICE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `ROADMAP.md`, and `AGENTS.md` are all present. Two best-practice additions for a **7-crate workspace** remain:

- **`ARCHITECTURE.md` (crate map).** There is no root architecture document describing the dependency graph (`core → parse/lexicon → ir → lint/lsp/cli`) and each crate's responsibility. `docs/design/` and `docs/topics/` cover subsystems, but a new contributor has no single "how the crates fit together" entry point. (High value, low effort.)
- **Per-crate `README.md` / crate-level rustdoc landing.** Crates have `#![warn(missing_docs)]` (good), but there are no per-crate READMEs, so the crates.io / docs.rs landing pages for `colorful-cli`, `colorful-lsp`, etc., lean only on `description`. A short `//!` crate-doc or README per published crate improves the registry presentation.

### 2.3 Supplementary Documentation (one undocumented complex area)

**The `colorful.vocabulary/v1` manifest and the class → `VisualRole` → surface-projection pipeline** (`crates/colorful-ir/src/vocabulary.rs`) is the most intricate, contract-bearing area and lacks a dedicated narrative doc. `docs/topics/ir/` covers the `colorful.syntax/v1` output IR, but the *vocabulary* manifest — how `class_roles` map parse classes to visual roles, how `role_projections` fan out to ANSI / LSP token types / graft classes, and what happens on an unmapped class — is only legible by reading the source. Given downstream editors theme against these projections, it deserves its own topic page.

> **Mitigation Prompt (Supplementary Doc):** `Write docs/topics/vocabulary/README.md explaining the colorful.vocabulary/v1 manifest: the class_roles mapping (token kind / lexical class / open-class kind → VisualRole), the role_projections fan-out to ANSI, LSP token types, and graft classes, the role of the embedded MANIFEST_JSON and its OnceLock loading, and the resolution behavior for unmapped classes. Cross-link it from README "Use with jedit and graft" and from docs/topics/ir/.`

---

## 3. Final Action Plan

### 3.1 Recommendation Type — **A. Incremental updates.**

The documentation is accurate, honest, and nearly complete. A rewrite would be destructive. The work is three small README additions plus two best-practice docs.

### 3.2 Deliverable — Generated prompt (Incremental: apply 2.1 fixes + create 2.2 docs)

> **Prompt:** `Tighten the colorful-language documentation without rewriting it.`
>
> `README.md: (1) Add a "Requirements" note stating the minimum Rust version exercised in CI, or explicitly that MSRV is not yet pinned (see Cargo.toml). (2) State that 'cargo install colorful-cli' installs the 'colorful' binary. (3) Add a short note on subcommand vs filename precedence (lint/ir/diagnose/color are subcommands; use 'colorful -- <file>' or 'colorful color <file>' for colliding names). Verify each command against crates/colorful-cli/src/lib.rs before writing.`
>
> `Create ARCHITECTURE.md at repo root: a crate map showing the dependency direction (colorful-core → colorful-parse/colorful-lexicon → colorful-ir → colorful-lint/colorful-lsp/colorful-cli), one paragraph per crate describing its responsibility, the contracts/ and consumers/ boundaries, and where the colorful.syntax/v1 and colorful.vocabulary/v1 contracts live. Link it from README "Documentation".`
>
> `Add a crate-level //! doc-comment (or per-crate README) to each published crate summarizing its purpose for the docs.rs/crates.io landing page.`
>
> `Create docs/topics/vocabulary/README.md documenting the colorful.vocabulary/v1 manifest and the class → VisualRole → projection pipeline as described in the supplementary-doc prompt above.`
>
> `Constraints: documentation only, no behavior changes; every command, crate name, file path, and function name must be confirmed against the current source before committing.`

### 3.3 Mitigation Prompt (ready to execute)

> `Act as a technical writer hardening the colorful-language docs. Step 1: verify the README command examples and crate/binary names against crates/colorful-cli/src/lib.rs and each crate's Cargo.toml. Step 2: apply the three README additions in 3.2 (Requirements/MSRV, crate-vs-binary, subcommand precedence). Step 3: create ARCHITECTURE.md (crate dependency map + per-crate responsibility) and docs/topics/vocabulary/README.md (manifest + projection pipeline), and add crate-level //! docs to the published crates. Constraints: docs only, no code changes; confirm every fact against source; preserve the project's honest "current contract vs roadmap" tone. Finish by listing each claim you verified with its file:line.`

---

### Evidence Basis

- README commands verified: `run()` dispatch at `crates/colorful-cli/src/lib.rs:124-130` (`ir`/`lint`/`diagnose`/`color` + default color); bin `colorful` via `default-run` (`crates/colorful-cli/Cargo.toml`).
- Standard files present at root: `LICENSE`, `NOTICE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `ROADMAP.md`, `AGENTS.md`. Absent: `ARCHITECTURE.md`; no per-crate `README.md`.
- MSRV: `rust-version` intentionally unset (`Cargo.toml`), no `rust-toolchain.toml`; README states no toolchain requirement.
- Doc depth: `docs/topics/{coloring,ir,lexicon,linting,parsing,editor-integrations,downstream-consumers,...}`, `docs/goalposts/v0.1.0..v0.3.0` (with `release.md` + `verification.md`), `docs/workflows/release-process`, `editors/README.md`.
- Undocumented area: `crates/colorful-ir/src/vocabulary.rs` (`colorful.vocabulary/v1` manifest + class→role→projection), no dedicated topic page.
