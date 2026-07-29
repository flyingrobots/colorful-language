use super::args::{parse_input_args, Command, ParseOutcome};
use super::color::{classification_io_error, default_annotator};
use super::format::analysis_source_for;
use colorful_core::{Analyzer, Finding, Severity, ValidatedClassification};
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;
use std::io::{self, Read, Write};
use std::process::ExitCode;

/// Report prose problems for a file (the `lint` subcommand).
///
/// `colorful lint [FILE]` — reads the file (or stdin), runs the
/// [`ProseLinter`], and prints one compiler-style line per finding. Exits
/// non-zero when any findings are reported, so it fails a CI gate on bad prose.
pub(super) fn run_lint<I>(args: I) -> io::Result<ExitCode>
where
    I: IntoIterator<Item = String>,
{
    let parsed = match parse_input_args(Command::Lint, args)? {
        ParseOutcome::Help => {
            print!("{}", Command::Lint.help_text());
            return Ok(ExitCode::SUCCESS);
        }
        ParseOutcome::Run(parsed) => parsed,
    };

    let (name, input) = match parsed.path {
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
pub(super) fn lint_to_writer<W: Write>(name: &str, source: &str, out: &mut W) -> io::Result<bool> {
    let analysis_source = analysis_source_for(Some(name), source);
    let classification = ValidatedClassification::from_ports(
        &analysis_source,
        &ProseParser::new(),
        &default_annotator(),
    )
    .map_err(classification_io_error)?;
    let findings = ProseLinter::new().analyze(
        &analysis_source,
        classification.tree(),
        classification.tokens(),
    );
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
/// columns in characters. Recognizes `\n`, `\r\n`, and a bare `\r` as line
/// terminators — a `\r\n` pair counts as one line break, never two — matching
/// `colorful-lsp`'s `LineIndex` exactly, so the CLI and the LSP never
/// disagree about which line a position falls on.
#[must_use]
pub fn line_col(source: &str, byte: usize) -> (usize, usize) {
    let mut line = 1usize;
    let mut col = 1usize;
    let mut prev_was_cr = false;
    for (i, ch) in source.char_indices() {
        if i >= byte {
            break;
        }
        if prev_was_cr && ch == '\n' {
            // The second half of a \r\n pair already broke the line; it
            // isn't a character of the new line, so it doesn't advance col.
            prev_was_cr = false;
            continue;
        }
        prev_was_cr = false;
        match ch {
            '\n' => {
                line += 1;
                col = 1;
            }
            '\r' => {
                line += 1;
                col = 1;
                prev_was_cr = true;
            }
            _ => col += 1,
        }
    }
    (line, col)
}
