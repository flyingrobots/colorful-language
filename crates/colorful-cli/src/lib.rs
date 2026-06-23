//! Colorize English prose by part of speech in the terminal.
//!
//! This is a driving adapter: it wires the [`ProseParser`] and
//! [`ClosedClassLexicon`] together through a `LexicalAnnotator` and renders the
//! classified token stream as ANSI-colored text. The same classification feeds
//! the LSP server; here it lands as color in a terminal with no editor.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::io::{self, Read, Write};
use std::process::ExitCode;

use colorful_core::{Analyzer, Annotator, Finding, LexicalAnnotator, Parser, PosClass, Severity};
use colorful_lexicon::ClosedClassLexicon;
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;

/// The ANSI SGR parameter used to color a class, or `None` to leave it plain.
///
/// The colors are not chosen here: the class maps to an abstract `VisualRole`,
/// which the `colorful.vocabulary/v1` manifest projects onto ANSI. The same
/// manifest drives the LSP and the graft consumer, so all three surfaces agree.
fn sgr(class: PosClass) -> Option<&'static str> {
    let role = colorful_ir::vocabulary::visual_role_for(class);
    colorful_ir::vocabulary::projection(&role).ansi.as_deref()
}

/// Render `source` with ANSI color per part of speech.
///
/// When `color` is `false`, `source` is returned unchanged (a faithful
/// passthrough), so piping through the tool never alters the text.
#[must_use]
pub fn colorize(source: &str, color: bool) -> String {
    if !color {
        return source.to_string();
    }

    let tree = ProseParser::new().parse(source);
    let tokens = LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(source, &tree);

    let mut out = String::with_capacity(source.len() + tokens.len() * 8);
    let mut prev = 0;
    for token in tokens {
        // Emit the gap (whitespace and anything between tokens) verbatim.
        if token.span.start > prev {
            out.push_str(source.get(prev..token.span.start).unwrap_or(""));
        }
        let text = token.span.slice(source);
        if let Some(code) = sgr(token.class) {
            out.push_str("\x1b[");
            out.push_str(code);
            out.push('m');
            out.push_str(text);
            out.push_str("\x1b[0m");
        } else {
            out.push_str(text);
        }
        prev = token.span.end;
    }
    if prev < source.len() {
        out.push_str(source.get(prev..).unwrap_or(""));
    }
    out
}

/// Decide whether to emit color, honoring `--no-color` and the `NO_COLOR`
/// convention (<https://no-color.org/>): color is on unless either is set.
#[must_use]
pub fn decide_color(no_color_flag: bool, no_color_env: bool) -> bool {
    !no_color_flag && !no_color_env
}

const HELP: &str = "\
colorful — color English prose by part of speech

USAGE:
    colorful [OPTIONS] [FILE]
    colorful lint [FILE]
    colorful ir [FILE]

ARGS:
    FILE          Path to read; omit or use \"-\" to read standard input.

OPTIONS:
    --no-color    Pass the text through without ANSI color.
    -h, --help    Show this help.

SUBCOMMANDS:
    lint          Report prose problems (weak words, run-ons, passives); exits
                  non-zero when any are found.
    ir            Emit the colorful.syntax/v1 IR as canonical JSON.

Color is disabled automatically when the NO_COLOR environment variable is set.
";

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
        Some("ir") => run_ir(args.iter().skip(1).cloned()).map(|()| ExitCode::SUCCESS),
        Some("lint") => run_lint(args.iter().skip(1).cloned()),
        Some("color") => run_color(args.iter().skip(1).cloned()).map(|()| ExitCode::SUCCESS),
        _ => run_color(args).map(|()| ExitCode::SUCCESS),
    }
}

/// Colorize prose to ANSI in the terminal (the default subcommand).
fn run_color<I>(args: I) -> io::Result<()>
where
    I: IntoIterator<Item = String>,
{
    let mut no_color_flag = false;
    let mut path: Option<String> = None;
    let mut end_of_options = false;

    for arg in args {
        if end_of_options {
            path = Some(arg);
            continue;
        }
        match arg.as_str() {
            "--" => end_of_options = true,
            "--no-color" => no_color_flag = true,
            "-h" | "--help" => {
                print!("{HELP}");
                return Ok(());
            }
            "-" => path = None,
            other if other.starts_with('-') && other.len() > 1 => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown option: {other}"),
                ));
            }
            other => path = Some(other.to_string()),
        }
    }

    let input = match path {
        Some(p) => std::fs::read_to_string(p)?,
        None => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            buf
        }
    };

    let color = decide_color(no_color_flag, std::env::var_os("NO_COLOR").is_some());
    let mut stdout = io::stdout().lock();
    stdout.write_all(colorize(&input, color).as_bytes())?;
    stdout.flush()
}

/// Emit the `colorful.syntax/v1` IR (`DocumentAnalysis`) as canonical JSON.
///
/// `colorful ir [FILE]` — reads the file (or stdin), parses and classifies it,
/// and prints the IR a back-end (graft, jedit, an editor) can consume.
fn run_ir<I>(args: I) -> io::Result<()>
where
    I: IntoIterator<Item = String>,
{
    let mut path: Option<String> = None;
    let mut end_of_options = false;
    for arg in args {
        if end_of_options {
            path = Some(arg);
            continue;
        }
        match arg.as_str() {
            "--" => end_of_options = true,
            "-h" | "--help" => {
                print!("colorful ir [FILE]\n\nEmit the colorful.syntax/v1 IR as canonical JSON (stdin if no FILE).\n");
                return Ok(());
            }
            "-" => path = None,
            other if other.starts_with('-') && other.len() > 1 => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown option: {other}"),
                ));
            }
            other => path = Some(other.to_string()),
        }
    }

    let (unit_id, input) = match path {
        Some(p) => {
            let contents = std::fs::read_to_string(&p)?;
            (p, contents)
        }
        None => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            ("stdin".to_string(), buf)
        }
    };

    let tree = ProseParser::new().parse(&input);
    let tokens = LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(&input, &tree);
    let document = colorful_ir::from_classification(&unit_id, &input, &tree, &tokens)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
    let json = colorful_ir::canonical_json(&document)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;

    let mut stdout = io::stdout().lock();
    stdout.write_all(json.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

/// Report prose problems for a file (the `lint` subcommand).
///
/// `colorful lint [FILE]` — reads the file (or stdin), runs the
/// [`ProseLinter`], and prints one compiler-style line per finding. Exits
/// non-zero when any findings are reported, so it fails a CI gate on bad prose.
fn run_lint<I>(args: I) -> io::Result<ExitCode>
where
    I: IntoIterator<Item = String>,
{
    let mut path: Option<String> = None;
    let mut end_of_options = false;
    for arg in args {
        if end_of_options {
            path = Some(arg);
            continue;
        }
        match arg.as_str() {
            "--" => end_of_options = true,
            "-h" | "--help" => {
                print!("colorful lint [FILE]\n\nReport prose problems (stdin if no FILE). Exits non-zero when any are found.\n");
                return Ok(ExitCode::SUCCESS);
            }
            "-" => path = None,
            other if other.starts_with('-') && other.len() > 1 => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown option: {other}"),
                ));
            }
            other => path = Some(other.to_string()),
        }
    }

    let (name, input) = match path {
        Some(p) => {
            let contents = std::fs::read_to_string(&p)?;
            (p, contents)
        }
        None => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            ("<stdin>".to_string(), buf)
        }
    };

    let mut stdout = io::stdout().lock();
    let found = lint_to_writer(&name, &input, &mut stdout)?;
    stdout.flush()?;
    Ok(if found {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// Lint `source` and write the report to `out`, one finding per line. Returns
/// whether any findings were reported, which the caller turns into the exit
/// code. Factored out of [`run_lint`] so the format and the exit decision are
/// testable without touching the filesystem.
fn lint_to_writer<W: Write>(name: &str, source: &str, out: &mut W) -> io::Result<bool> {
    let tree = ProseParser::new().parse(source);
    let tokens = LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(source, &tree);
    let findings = ProseLinter::new().analyze(source, &tree, &tokens);
    out.write_all(lint_report(name, source, &findings).as_bytes())?;
    Ok(!findings.is_empty())
}

/// Render `findings` as compiler-style diagnostic lines:
/// `name:line:col: severity [code]: message`. Returns `""` for no findings, so
/// clean input prints nothing.
#[must_use]
pub fn lint_report(name: &str, source: &str, findings: &[Finding]) -> String {
    let mut out = String::new();
    for finding in findings {
        let (line, col) = line_col(source, finding.span.start);
        let severity = match finding.severity {
            Severity::Warning => "warning",
            Severity::Info => "info",
        };
        out.push_str(&format!(
            "{name}:{line}:{col}: {severity} [{code}]: {message}\n",
            code = finding.rule.code(),
            message = finding.message,
        ));
    }
    out
}

/// The 1-based `(line, column)` of byte offset `byte` in `source`, counting
/// columns in characters. Lines are split on `\n`.
fn line_col(source: &str, byte: usize) -> (usize, usize) {
    let mut line = 1usize;
    let mut col = 1usize;
    for (i, ch) in source.char_indices() {
        if i >= byte {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }
    (line, col)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_when_color_disabled() {
        let s = "The cat is 3.\nA second line.";
        assert_eq!(colorize(s, false), s);
    }

    #[test]
    fn golden_colored_output() {
        // "The" (function), cat (content), "is" (function), 3 (number),
        // "." (punctuation), with whitespace preserved verbatim.
        let got = colorize("The cat is 3.", true);
        let want = "\x1b[1;35mThe\x1b[0m cat \x1b[1;35mis\x1b[0m \x1b[36m3\x1b[0m\x1b[90m.\x1b[0m";
        assert_eq!(got, want);
    }

    #[test]
    fn golden_proper_noun_output() {
        // Mid-sentence capitalized "Paris" becomes a (bold yellow) proper noun.
        let got = colorize("I visited Paris.", true);
        let want = "\x1b[1;35mI\x1b[0m visited \x1b[1;33mParis\x1b[0m\x1b[90m.\x1b[0m";
        assert_eq!(got, want);
    }

    #[test]
    fn gaps_and_newlines_are_preserved_exactly() {
        // Stripping all ANSI escapes must reproduce the original source.
        let src = "Well,  \t\"quoted\"\n  text—here.";
        let colored = colorize(src, true);
        let stripped = strip_ansi(&colored);
        assert_eq!(stripped, src);
    }

    #[test]
    fn double_dash_allows_dash_prefixed_paths() {
        // After `--`, a leading-dash argument is treated as a path: reading it
        // fails with NotFound, not an "unknown option" InvalidInput.
        let err = run(["--".to_string(), "-weird.txt".to_string()]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        // Without `--`, the same argument is rejected as an unknown option.
        let err = run(["-weird.txt".to_string()]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn lint_reports_findings_in_compiler_style_and_signals_failure() {
        // "just" is a weak word at column 9; the report names the file, position,
        // severity, rule code, and message, and the writer reports a failure.
        let mut buf = Vec::new();
        let found = lint_to_writer("draft.txt", "This is just wrong.", &mut buf).unwrap();
        assert!(found, "findings should signal a non-zero exit");
        assert_eq!(
            String::from_utf8(buf).unwrap(),
            "draft.txt:1:9: info [weak-word]: weak word 'just'\n"
        );
    }

    #[test]
    fn lint_of_clean_prose_prints_nothing_and_signals_success() {
        let mut buf = Vec::new();
        let found = lint_to_writer("clean.txt", "The cat sat on the mat.", &mut buf).unwrap();
        assert!(!found, "clean prose should signal a zero exit");
        assert!(buf.is_empty(), "clean prose should print nothing");
    }

    #[test]
    fn lint_line_col_tracks_newlines() {
        // A run-on on the third line points at the start of that line's sentence.
        let src = "First line.\nSecond line.\nthird";
        assert_eq!(line_col(src, 0), (1, 1));
        assert_eq!(line_col(src, 12), (2, 1));
        assert_eq!(line_col(src, 25), (3, 1));
    }

    #[test]
    fn lint_unknown_option_is_rejected() {
        let err = run(["lint".to_string(), "--bogus".to_string()]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn decide_color_honors_flag_and_env() {
        assert!(decide_color(false, false));
        assert!(!decide_color(true, false));
        assert!(!decide_color(false, true));
        assert!(!decide_color(true, true));
    }

    /// Remove ANSI SGR sequences (`ESC [ ... m`) for round-trip checks.
    fn strip_ansi(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut chars = s.chars();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                // Consume through the terminating 'm'.
                for d in chars.by_ref() {
                    if d == 'm' {
                        break;
                    }
                }
            } else {
                out.push(c);
            }
        }
        out
    }
}
