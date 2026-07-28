use colorful_cli::{colorize, decide_color, line_col, lint_report, run, try_colorize};
use colorful_core::{ClassificationError, Finding};
use std::io;
use std::process::ExitCode;

const FACADE: &str = include_str!("../src/lib.rs");
const CLI_MODULE: &str = include_str!("../src/cli/mod.rs");
const ARGS: &str = include_str!("../src/cli/args.rs");
const COLOR: &str = include_str!("../src/cli/color.rs");
const DIAGNOSE: &str = include_str!("../src/cli/diagnose.rs");
const LINT: &str = include_str!("../src/cli/lint.rs");

fn assert_source_owner(
    symbol: &str,
    owner_name: &str,
    owner: &str,
    other_modules: &[(&str, &str)],
) {
    assert!(owner.contains(symbol), "{owner_name} must own {symbol}");
    assert!(
        !FACADE.contains(symbol),
        "the crate facade must not implement {symbol}"
    );
    for (name, source) in other_modules {
        assert!(
            !source.contains(symbol),
            "{name} must not duplicate {symbol} from {owner_name}"
        );
    }
}

#[test]
fn command_responsibilities_have_exactly_one_module_owner() {
    let modules = [
        ("args.rs", ARGS),
        ("color.rs", COLOR),
        ("diagnose.rs", DIAGNOSE),
        ("lint.rs", LINT),
    ];

    for (symbol, owner_name, owner) in [
        ("pub fn run", "args.rs", ARGS),
        ("pub fn colorize", "color.rs", COLOR),
        ("pub fn try_colorize", "color.rs", COLOR),
        ("pub fn decide_color", "color.rs", COLOR),
        ("fn diagnose_json", "diagnose.rs", DIAGNOSE),
        ("pub fn lint_report", "lint.rs", LINT),
        ("pub fn line_col", "lint.rs", LINT),
    ] {
        let others = modules
            .iter()
            .copied()
            .filter(|(name, _)| *name != owner_name)
            .collect::<Vec<_>>();
        assert_source_owner(symbol, owner_name, owner, &others);
    }

    assert!(FACADE.contains("mod cli;"));
    for declaration in ["mod args;", "mod color;", "mod diagnose;", "mod lint;"] {
        assert!(
            CLI_MODULE.contains(declaration),
            "the CLI module must declare {declaration}"
        );
    }
}

#[test]
fn existing_public_facade_remains_importable() {
    let _: fn(Vec<String>) -> io::Result<ExitCode> = run::<Vec<String>>;
    let _: fn(&str, bool) -> String = colorize;
    let _: fn(&str, bool) -> Result<String, ClassificationError> = try_colorize;
    let _: fn(bool, bool) -> bool = decide_color;
    let _: fn(&str, &str, &[Finding]) -> String = lint_report;
    let _: fn(&str, usize) -> (usize, usize) = line_col;

    assert_eq!(colorize("plain", false), "plain");
    assert!(!decide_color(true, false));
    assert_eq!(lint_report("plain.txt", "plain", &[]), "");
    assert_eq!(line_col("plain", 0), (1, 1));
}
