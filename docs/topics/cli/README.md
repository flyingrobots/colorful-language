# CLI

The `colorful` command is the process boundary for terminal coloring, prose
linting, canonical IR export, and machine-readable diagnosis. This page is the
current reference for command dispatch and input behavior. Domain-specific
output contracts remain in the
[coloring](../coloring/README.md),
[linting](../linting/README.md), and [IR](../ir/README.md) topics.

## Commands

`colorful` accepts one optional UTF-8 file operand. Omitting the operand or
passing `-` reads standard input. Passing more than one file is an error.

```text
colorful [--no-color] [FILE]
colorful lint [FILE]
colorful ir [FILE]
colorful diagnose [--json] [FILE]
```

- The default command writes the source with manifest-backed ANSI styling.
  `.md` and `.markdown` files style only reviewed prose regions; other files and
  stdin retain whole-document behavior. `--no-color` and `NO_COLOR` produce an
  exact text passthrough.
- `lint` writes compiler-style findings and exits nonzero when it finds any.
- `ir` writes one canonical `colorful.syntax/v1` JSON document.
- `diagnose --json` writes whole-source token axes, presentation projections,
  and lint findings for troubleshooting format-neutral CLI/editor disagreement.
  Like canonical IR, it does not infer Markdown regions from a filename.
- `--version` and `-V` write the package version.
- `--help` and `-h` write command-specific help.

Every single-document command rejects invalid UTF-8 instead of replacing
malformed bytes. `--` ends option parsing, so a following flag-shaped operand is
treated as a path.

## Library boundary

The `colorful-cli` crate exposes the process dispatcher and pure helpers used by
tests, benchmarks, and the fuzzing workspace:

- `run` dispatches process arguments and returns the intended exit status;
- `colorize` and `try_colorize` render ANSI output;
- `decide_color` applies the `--no-color` and `NO_COLOR` rule;
- `lint_report` renders deterministic compiler-style findings;
- `line_col` maps UTF-8 byte offsets to one-based human positions.

The binary in `crates/colorful-cli/src/main.rs` is deliberately thin. It passes
arguments to `run`, prints process errors, and converts them to failure status.

## Source ownership

`crates/colorful-cli/src/lib.rs` is a stable facade. It re-exports the existing
public functions from five private implementation modules:

- `cli/args.rs` owns command selection, help/version rendering, and shared
  single-document argument parsing;
- `cli/color.rs` owns classification-to-ANSI rendering and color policy;
- `cli/diagnose.rs` owns canonical IR emission and diagnostic JSON;
- `cli/format.rs` owns filename-to-prose-view selection shared by ANSI and lint;
- `cli/lint.rs` owns lint execution, report rendering, and human positions.

These modules are not public API. Callers continue to import every supported
function from the `colorful_cli` crate root. Unit tests live beside the private
module facade in `cli/tests.rs`; external module-layout and facade checks live in
`tests/module_layout.rs`.

## Evidence

The process contract is exercised by
`crates/colorful-cli/tests/binary_contract.rs`. Golden lint output and CLI/LSP
position parity are exercised by
`crates/colorful-cli/tests/lint_golden_fixtures.rs`; seeded boundary properties
live in `crates/colorful-cli/tests/property_boundaries.rs`.

See the [CLI test plan](test-plan.md) for requirement IDs, structural evidence,
and implementation status.
