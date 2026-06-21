# ADR-0003: A pure-Rust parser; tree-sitter declined for the core

- Status: Accepted
- Date: 2026-06-21

## Context

The idea began as "give my editor an English grammar via tree-sitter for
highlighting." Two facts reframed it:

1. Good coverage across editors needs a language server regardless, and an LSP is
   always a local process — "offline" here meant *no server process*, never *no
   network*.
2. tree-sitter grammars are authored in a JavaScript DSL and generated to C,
   consumed from Rust over FFI.

## Decision

Use a pure-Rust parser (a `logos` lexer with recursive descent) as the primary
`Parser` adapter, delivered LSP-first. Do not adopt tree-sitter for the core.

A deliberately shallow, structural-only tree-sitter grammar — for no-server
highlighting in tree-sitter-native editors, layered *under* the LSP — remains a
Horizon possibility, kept shallow so it never becomes a second source of truth.

## Consequences

- One language and one memory model: the parse tree is native Rust the whole
  stack holds references into — zero-copy, native lifetimes, no per-node FFI. The
  tree can be the domain model the interpreter and later tiers grow from.
- We own incremental parsing and error recovery. For prose this is cheap:
  sentence and paragraph boundaries are natural reparse units, so v0 can fully
  reparse per change and upgrade to per-paragraph later.
- The build stays single-toolchain (Cargo); no JS or C in the hot path.
- Trade accepted: tree-sitter's free in-editor highlighting in Neovim, Helix, and
  Zed is given up for now, recoverable later via the shallow grammar above.
