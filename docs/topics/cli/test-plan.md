# CLI — Test Plan

Requirements:

- **CLI-1** The `colorful-cli` crate root remains a stable public facade for
  `run`, `colorize`, `try_colorize`, `decide_color`, `lint_report`, and
  `line_col`.
- **CLI-2** Argument parsing, source-format selection, ANSI coloring,
  diagnosis/IR output, and lint reporting live in separate implementation
  modules so a change to one adapter does not require editing unrelated command
  logic.
- **CLI-3** The module split preserves command output bytes, exit statuses,
  error behavior, `NO_COLOR`, canonical IR, and CLI/LSP coordinate parity.

## Cases

- **CLI-1a** — *Requirement:* CLI-1. *Behavior:* every existing crate-root
  function remains importable with the same signature after source
  decomposition. *Oracle:* the external integration target compiles and calls
  the public functions without importing an implementation module. *Evidence
  type:* Rust integration test. *Evidence:*
  `crates/colorful-cli/tests/module_layout.rs`
  `existing_public_facade_remains_importable`. *Tracking:*
  [#223](https://github.com/flyingrobots/colorful-language/issues/223).
  *Status:* implemented.
- **CLI-2a** — *Requirement:* CLI-2. *Behavior:* the crate root delegates to
  dedicated argument, source-format, coloring, diagnosis, and lint modules and
  contains no implementation copy of their owned functions. *Oracle:* exact
  module inventory and source-owner assertions. *Evidence type:* deterministic
  source layout test. *Evidence:*
  `crates/colorful-cli/tests/module_layout.rs`
  `command_responsibilities_have_exactly_one_module_owner`. *Tracking:*
  [#223](https://github.com/flyingrobots/colorful-language/issues/223).
  *Status:* implemented.
- **CLI-3a** — *Requirement:* CLI-3. *Behavior:* the existing real-binary,
  golden, unit, and seeded property suites remain unchanged and pass after the
  split. *Oracle:* exact output/status assertions and property oracles in the
  existing suites. *Evidence type:* characterization and public-contract tests.
  *Evidence:* `colorful-cli`'s 27 unit tests;
  `crates/colorful-cli/tests/binary_contract.rs`;
  `crates/colorful-cli/tests/lint_golden_fixtures.rs`;
  `crates/colorful-cli/tests/property_boundaries.rs`.
  *Tracking:*
  [#223](https://github.com/flyingrobots/colorful-language/issues/223).
  *Status:* implemented.

## Known gaps / risks

- This plan verifies source ownership and observable compatibility. It does not
  make private implementation modules part of the public Rust API.
