use super::color::run_color;
use super::diagnose::{run_diagnose, run_ir};
use super::lint::run_lint;
use std::collections::BTreeSet;
use std::io;
use std::process::ExitCode;

const HELP_BODY: &str = "\
USAGE:
    colorful [OPTIONS] [FILE]
    colorful lint [FILE]
    colorful ir [FILE]
    colorful diagnose [--json] [FILE]

ARGS:
    FILE          Path to read; omit or use \"-\" to read standard input.

OPTIONS:
    --no-color     Pass the text through without ANSI color.
    -V, --version  Print the colorful CLI version.
    -h, --help     Show this help.

SUBCOMMANDS:
    lint          Report prose problems (weak words, run-ons, passives); exits
                  non-zero when any are found.
    ir            Emit the colorful.syntax/v1 IR as canonical JSON.
    diagnose      Emit a machine-readable troubleshooting report for CLI/editor
                  projection checks.

Color is disabled automatically when the NO_COLOR environment variable is set.
";

pub(super) fn help_text() -> String {
    format!(
        "colorful {} — color English prose by part of speech\n\n{HELP_BODY}",
        env!("CARGO_PKG_VERSION")
    )
}

/// A single-document subcommand: `color` (the default), `ir`, `diagnose`, or
/// `lint`. Each recognizes its own flags and has its own `--help` text;
/// centralizing both here means a command's allowed flags live in exactly
/// one place, not scattered across each `run_*` call site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Command {
    /// `colorful [--no-color] [FILE]` — the default subcommand.
    Color,
    /// `colorful ir [FILE]`.
    Ir,
    /// `colorful diagnose [--json] [FILE]`.
    Diagnose,
    /// `colorful lint [FILE]`.
    Lint,
}

const IR_HELP: &str =
    "colorful ir [FILE]\n\nEmit the colorful.syntax/v1 IR as canonical JSON (stdin if no FILE).\n";
const DIAGNOSE_HELP: &str = "colorful diagnose [--json] [FILE]\n\n\
     Emit a machine-readable diagnostic report for CLI/editor \
     projection checks (stdin if no FILE). JSON is the only \
     current output format.\n";
const LINT_HELP: &str =
    "colorful lint [FILE]\n\nReport prose problems (stdin if no FILE). Exits non-zero when any are found.\n";

impl Command {
    /// The flags this command recognizes (each starting with `-`, e.g.
    /// `"--json"`). Every other command rejects them as unknown.
    pub(super) fn recognized_flags(self) -> &'static [&'static str] {
        match self {
            Command::Color => &["--no-color"],
            Command::Ir | Command::Lint => &[],
            Command::Diagnose => &["--json"],
        }
    }

    /// This command's `--help` text, a pure rendering with no I/O — the
    /// caller decides where it goes.
    pub(super) fn help_text(self) -> String {
        match self {
            Command::Color => help_text(),
            Command::Ir => IR_HELP.to_string(),
            Command::Diagnose => DIAGNOSE_HELP.to_string(),
            Command::Lint => LINT_HELP.to_string(),
        }
    }
}

/// The outcome of parsing a subcommand's arguments: help was requested, or
/// every argument was recognized.
#[derive(Debug)]
pub(super) enum ParseOutcome {
    /// `-h`/`--help` was seen; the caller should print its own usage and stop.
    Help,
    /// Parsing completed; every subcommand runs the same way from here.
    Run(InputArgs),
}

/// A subcommand's parsed input: at most one positional `FILE` (`None` means
/// read stdin — either `FILE` was omitted or given as the explicit `-`
/// sentinel), plus the recognized flags that were passed.
#[derive(Debug)]
pub(super) struct InputArgs {
    pub(super) path: Option<String>,
    pub(super) flags: BTreeSet<String>,
}

impl InputArgs {
    /// Whether `flag` (e.g. `"--json"`) was passed. Repeating a flag is
    /// idempotent — it either was passed or it wasn't.
    pub(super) fn has_flag(&self, flag: &str) -> bool {
        self.flags.contains(flag)
    }
}

fn too_many_file_operands() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "expected at most one FILE argument",
    )
}

/// Record `arg` as the (only) `FILE` operand: `"-"` means stdin (`None`),
/// anything else is a literal path. Errs if a `FILE` was already recorded.
fn take_path(arg: String, path: &mut Option<String>, has_path: &mut bool) -> io::Result<()> {
    if *has_path {
        return Err(too_many_file_operands());
    }
    *has_path = true;
    *path = if arg == "-" { None } else { Some(arg) };
    Ok(())
}

/// Parse `command`'s `args` against the flags it recognizes, shared by every
/// single-document command so `-h`/`--help`, `--`, and the `-`-means-stdin
/// sentinel behave identically everywhere — only which flags are recognized
/// varies, via [`Command::recognized_flags`].
///
/// Before `--`: `-h`/`--help` requests help; `-` or a recognized flag are
/// handled; anything else starting with `-` is an unknown option; anything
/// else is the `FILE` operand. After `--`, every remaining argument is
/// positional — `-` still means stdin (it is a sentinel, not a flag, even past
/// `--`), and a flag-shaped argument such as `--weird-file` is accepted
/// literally as a path rather than rejected as unknown. At most one `FILE`
/// operand is accepted, before or after `--`.
///
/// This function only parses — it performs no I/O of its own. Rendering
/// (help text) and process I/O (reading the file/stdin, writing output) are
/// both the caller's job.
///
/// # Errors
///
/// Returns an error if an unrecognized flag is seen, or more than one `FILE`
/// operand is given.
pub(super) fn parse_input_args<I>(command: Command, args: I) -> io::Result<ParseOutcome>
where
    I: IntoIterator<Item = String>,
{
    let recognized_flags = command.recognized_flags();
    let mut flags = BTreeSet::new();
    let mut path: Option<String> = None;
    let mut has_path = false;
    let mut end_of_options = false;

    for arg in args {
        if end_of_options {
            take_path(arg, &mut path, &mut has_path)?;
            continue;
        }
        match arg.as_str() {
            "--" => end_of_options = true,
            "-h" | "--help" => return Ok(ParseOutcome::Help),
            other if recognized_flags.contains(&other) => {
                flags.insert(other.to_string());
            }
            other if other.starts_with('-') && other.len() > 1 => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown option: {other}"),
                ));
            }
            _ => take_path(arg, &mut path, &mut has_path)?,
        }
    }

    Ok(ParseOutcome::Run(InputArgs { path, flags }))
}

/// Run the CLI over `args` (the program's arguments, excluding `argv[0]`).
///
/// Returns the process [`ExitCode`]: `lint` exits non-zero when it reports
/// findings; every other path exits zero on success.
///
/// # Errors
///
/// Returns an error if the input file cannot be read, standard input cannot be
/// read, or an unknown flag is supplied.
pub fn run<I>(args: I) -> io::Result<ExitCode>
where
    I: IntoIterator<Item = String>,
{
    let args: Vec<String> = args.into_iter().collect();
    match args.first().map(String::as_str) {
        Some("-V" | "--version") => run_version(&args[1..]),
        Some("ir") => run_ir(args.iter().skip(1).cloned()).map(|()| ExitCode::SUCCESS),
        Some("lint") => run_lint(args.iter().skip(1).cloned()),
        Some("diagnose") => run_diagnose(args.iter().skip(1).cloned()).map(|()| ExitCode::SUCCESS),
        Some("color") => run_color(args.iter().skip(1).cloned()).map(|()| ExitCode::SUCCESS),
        _ => run_color(args).map(|()| ExitCode::SUCCESS),
    }
}

fn run_version(args: &[String]) -> io::Result<ExitCode> {
    if let Some(extra) = args.first() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unexpected argument after version flag: {extra}"),
        ));
    }
    print!("{}", version_output());
    Ok(ExitCode::SUCCESS)
}

pub(super) fn version_output() -> String {
    format!("colorful {}\n", env!("CARGO_PKG_VERSION"))
}
