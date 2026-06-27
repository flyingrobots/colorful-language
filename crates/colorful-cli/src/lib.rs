//! Colorize English prose by part of speech in the terminal.
//!
//! This is a driving adapter: it wires the [`ProseParser`] and
//! [`ContextualOpenClassAnnotator`] together and renders the classified token
//! stream as ANSI-colored text. The same classification feeds the LSP server;
//! here it lands as color in a terminal with no editor.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::io::{self, Read, Write};
use std::process::ExitCode;

use colorful_core::{Analyzer, Annotator, Finding, Parser, PosClass, Severity};
use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
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

fn default_annotator() -> ContextualOpenClassAnnotator<SeedOpenClassLexicon> {
    ContextualOpenClassAnnotator::default()
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
    let tokens = default_annotator().annotate(source, &tree);

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

fn help_text() -> String {
    format!(
        "colorful {} — color English prose by part of speech\n\n{HELP_BODY}",
        env!("CARGO_PKG_VERSION")
    )
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

fn version_output() -> String {
    format!("colorful {}\n", env!("CARGO_PKG_VERSION"))
}

fn analyze_ir(
    unit_id: &str,
    input: &str,
) -> Result<colorful_ir::syntax_v1::DocumentAnalysis, colorful_ir::ProjectionError> {
    let tree = ProseParser::new().parse(input);
    let tokens = default_annotator().annotate(input, &tree);
    colorful_ir::from_classification(unit_id, input, &tree, &tokens)
}

fn json_error(err: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, err.to_string())
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
                print!("{}", help_text());
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

    let document = analyze_ir(&unit_id, &input)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
    let json = colorful_ir::canonical_json(&document)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;

    let mut stdout = io::stdout().lock();
    stdout.write_all(json.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

/// Emit a troubleshooting report for CLI/editor projection checks.
///
/// `colorful diagnose --json [FILE]` — reads the file (or stdin), parses and
/// classifies it through the default production path, and prints a decoded JSON
/// report showing each token's IR axes and presentation projection.
fn run_diagnose<I>(args: I) -> io::Result<()>
where
    I: IntoIterator<Item = String>,
{
    let mut path: Option<String> = None;
    let mut end_of_options = false;
    for arg in args {
        if end_of_options {
            if path.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "expected at most one FILE argument",
                ));
            }
            path = Some(arg);
            continue;
        }
        match arg.as_str() {
            "--" => end_of_options = true,
            "--json" => {}
            "-h" | "--help" => {
                print!(
                    "colorful diagnose [--json] [FILE]\n\n\
                     Emit a machine-readable diagnostic report for CLI/editor \
                     projection checks (stdin if no FILE). JSON is the only \
                     current output format.\n"
                );
                return Ok(());
            }
            "-" => path = None,
            other if other.starts_with('-') && other.len() > 1 => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown option: {other}"),
                ));
            }
            other => {
                if path.is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "expected at most one FILE argument",
                    ));
                }
                path = Some(other.to_string());
            }
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

    let json = diagnose_json(&unit_id, &input)?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(json.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

fn diagnose_json(unit_id: &str, input: &str) -> io::Result<String> {
    let parser = ProseParser::new();
    let annotator = default_annotator();
    let analyzer = ProseLinter::new();

    let tree = parser.parse(input);
    let tokens = annotator.annotate(input, &tree);
    let document = colorful_ir::from_classification(unit_id, input, &tree, &tokens)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
    let findings = analyzer.analyze(input, &tree, &tokens);
    let legend = colorful_ir::vocabulary::lsp_legend();

    let mut lsp_semantic_tokens = 0usize;
    let mut ansi_colored_tokens = 0usize;
    let mut graft_styled_tokens = 0usize;
    let mut report_tokens = Vec::with_capacity(document.tokens.len());

    for token in &document.tokens {
        let role = colorful_ir::vocabulary::visual_role(
            &token.token_kind,
            token.lexical_class.as_ref(),
            token.open_class_kind.as_ref(),
        );
        let projection = colorful_ir::vocabulary::projection(&role);
        let lsp_token_type = projection.lsp_token_type.as_deref();
        let lsp_token_type_index =
            lsp_token_type.and_then(|name| legend.iter().position(|candidate| *candidate == name));

        if lsp_token_type.is_some() {
            lsp_semantic_tokens += 1;
        }
        if projection.ansi.is_some() {
            ansi_colored_tokens += 1;
        }
        if projection.graft_class.is_some() {
            graft_styled_tokens += 1;
        }

        report_tokens.push(serde_json::json!({
            "occurrenceId": token.occurrence_id,
            "text": range_text(input, &token.byte_range),
            "byteRange": token.byte_range,
            "tokenKind": token.token_kind,
            "lexicalClass": token.lexical_class,
            "functionKind": token.function_kind,
            "openClassKind": token.open_class_kind,
            "visualRole": role,
            "ansi": projection.ansi,
            "graftClass": projection.graft_class,
            "lspTokenType": lsp_token_type,
            "lspTokenTypeIndex": lsp_token_type_index,
        }));
    }

    let diagnostics: Vec<_> = findings
        .iter()
        .map(|finding| {
            let (line, column) = line_col(input, finding.span.start);
            serde_json::json!({
                "byteRange": {
                    "startUtf8": finding.span.start,
                    "endUtf8": finding.span.end,
                },
                "line": line,
                "column": column,
                "severity": severity_name(finding.severity),
                "code": finding.rule.code(),
                "message": finding.message,
                "text": finding.span.slice(input),
            })
        })
        .collect();

    let report = serde_json::json!({
        "reportVersion": "colorful.diagnose/v1",
        "tool": {
            "name": "colorful",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "source": document.source,
        "contracts": {
            "syntax": {
                "contractVersion": document.contract_version,
                "schemaHash": document.schema_hash,
            },
            "vocabulary": {
                "hash": document.vocabulary_hash,
                "lspLegend": legend,
            },
        },
        "summary": {
            "tokens": report_tokens.len(),
            "ansiColoredTokens": ansi_colored_tokens,
            "graftStyledTokens": graft_styled_tokens,
            "lspSemanticTokens": lsp_semantic_tokens,
            "diagnostics": diagnostics.len(),
        },
        "tokens": report_tokens,
        "diagnostics": diagnostics,
    });

    colorful_ir::canonical_json(&report).map_err(json_error)
}

fn range_text<'a>(source: &'a str, range: &colorful_ir::syntax_v1::ByteRange) -> &'a str {
    let Ok(start) = usize::try_from(range.start_utf8) else {
        return "";
    };
    let Ok(end) = usize::try_from(range.end_utf8) else {
        return "";
    };
    source.get(start..end).unwrap_or("")
}

fn severity_name(severity: Severity) -> &'static str {
    match severity {
        Severity::Warning => "WARNING",
        Severity::Info => "INFO",
    }
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
    let tokens = default_annotator().annotate(source, &tree);
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
        // "The" (function), cat (seed noun), "is" (function), 3 (number),
        // "." (punctuation), with whitespace preserved verbatim.
        let got = colorize("The cat is 3.", true);
        let want = "\x1b[1;35mThe\x1b[0m \x1b[34mcat\x1b[0m \x1b[1;35mis\x1b[0m \x1b[36m3\x1b[0m\x1b[90m.\x1b[0m";
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
    fn default_colorizer_emits_seed_open_class_roles() {
        let got = colorize("cat connects quick silently.", true);
        let want = concat!(
            "\x1b[34mcat\x1b[0m ",
            "\x1b[31mconnects\x1b[0m ",
            "\x1b[33mquick\x1b[0m ",
            "\x1b[35msilently\x1b[0m",
            "\x1b[90m.\x1b[0m",
        );
        assert_eq!(got, want);
    }

    #[test]
    fn default_colorizer_emits_contextual_open_class_roles() {
        let got = colorize("the book I book rooms the fast river connects fast.", true);
        let want = concat!(
            "\x1b[1;35mthe\x1b[0m ",
            "\x1b[34mbook\x1b[0m ",
            "\x1b[1;35mI\x1b[0m ",
            "\x1b[31mbook\x1b[0m ",
            "rooms ",
            "\x1b[1;35mthe\x1b[0m ",
            "\x1b[33mfast\x1b[0m ",
            "\x1b[34mriver\x1b[0m ",
            "\x1b[31mconnects\x1b[0m ",
            "\x1b[35mfast\x1b[0m",
            "\x1b[90m.\x1b[0m",
        );
        assert_eq!(got, want);
    }

    #[test]
    fn ir_uses_default_seed_open_class_roles() {
        use colorful_ir::syntax_v1::OpenClassKind;

        let doc = analyze_ir("fixture.txt", "cat connects quick silently.").unwrap();
        let classes: Vec<_> = doc
            .tokens
            .iter()
            .filter_map(|token| token.open_class_kind.clone())
            .collect();
        assert_eq!(
            classes,
            vec![
                OpenClassKind::Noun,
                OpenClassKind::Verb,
                OpenClassKind::Adjective,
                OpenClassKind::Adverb,
            ]
        );
    }

    #[test]
    fn ir_uses_contextual_open_class_roles() {
        use colorful_ir::syntax_v1::OpenClassKind;

        let source = "the book I book rooms the fast river connects fast.";
        let doc = analyze_ir("fixture.txt", source).unwrap();
        let classes: Vec<_> = doc
            .tokens
            .iter()
            .filter_map(|token| {
                let kind = token.open_class_kind.clone()?;
                let start = token.byte_range.start_utf8 as usize;
                let end = token.byte_range.end_utf8 as usize;
                Some((&source[start..end], kind))
            })
            .collect();

        assert_eq!(
            classes,
            vec![
                ("book", OpenClassKind::Noun),
                ("book", OpenClassKind::Verb),
                ("fast", OpenClassKind::Adjective),
                ("river", OpenClassKind::Noun),
                ("connects", OpenClassKind::Verb),
                ("fast", OpenClassKind::Adverb),
            ]
        );
    }

    #[test]
    fn diagnose_json_reports_token_roles_and_lsp_types() {
        let report = diagnose_json("fixture.txt", "The cat connects fast.").unwrap();
        let value: serde_json::Value = serde_json::from_str(&report).unwrap();

        assert_eq!(value["reportVersion"], "colorful.diagnose/v1");
        assert_eq!(value["tool"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(
            value["contracts"]["vocabulary"]["lspLegend"],
            serde_json::json!([
                "keyword",
                "class",
                "number",
                "string",
                "noun",
                "verb",
                "adjective",
                "adverb"
            ])
        );
        assert_eq!(value["summary"]["tokens"], 5);
        assert_eq!(value["summary"]["lspSemanticTokens"], 4);
        assert_eq!(value["summary"]["diagnostics"], 0);

        let tokens = value["tokens"].as_array().unwrap();
        assert_eq!(tokens[0]["text"], "The");
        assert_eq!(tokens[0]["lexicalClass"], "FUNCTION");
        assert_eq!(tokens[0]["functionKind"], "ARTICLE");
        assert_eq!(tokens[0]["visualRole"], "STRUCTURAL_KEYWORD");
        assert_eq!(tokens[0]["lspTokenType"], "keyword");
        assert_eq!(tokens[0]["lspTokenTypeIndex"], 0);

        assert_eq!(tokens[1]["text"], "cat");
        assert_eq!(tokens[1]["openClassKind"], "NOUN");
        assert_eq!(tokens[1]["visualRole"], "NOUN");
        assert_eq!(tokens[1]["lspTokenType"], "noun");
        assert_eq!(tokens[1]["lspTokenTypeIndex"], 4);

        assert_eq!(tokens[2]["text"], "connects");
        assert_eq!(tokens[2]["openClassKind"], "VERB");
        assert_eq!(tokens[2]["lspTokenType"], "verb");

        assert_eq!(tokens[3]["text"], "fast");
        assert_eq!(tokens[3]["openClassKind"], "ADVERB");
        assert_eq!(tokens[3]["lspTokenType"], "adverb");

        assert_eq!(tokens[4]["text"], ".");
        assert_eq!(tokens[4]["tokenKind"], "PUNCTUATION");
        assert!(tokens[4]["lspTokenType"].is_null());
        assert!(tokens[4]["lspTokenTypeIndex"].is_null());
    }

    #[test]
    fn diagnose_json_covers_editor_smoke_fixture() {
        let source = include_str!("../fixtures/editor-smoke-prose.txt");
        let report = diagnose_json("fixtures/editor-smoke-prose.txt", source).unwrap();
        let value: serde_json::Value = serde_json::from_str(&report).unwrap();

        assert_eq!(value["source"]["utf8ByteLength"], 899);
        assert_eq!(
            value["source"]["contentHash"],
            "sha256:94a03286a53a888248512692865d2947ccf48c3c15247c0683f9aa3f76b82a0c"
        );
        assert_eq!(
            value["summary"],
            serde_json::json!({
                "ansiColoredTokens": 102,
                "diagnostics": 0,
                "graftStyledTokens": 75,
                "lspSemanticTokens": 75,
                "tokens": 173,
            })
        );

        let tokens = value["tokens"].as_array().unwrap();
        assert_eq!(
            count_field(tokens, "lspTokenType"),
            [
                ("<null>", 98),
                ("adjective", 5),
                ("adverb", 6),
                ("class", 4),
                ("keyword", 40),
                ("noun", 7),
                ("number", 1),
                ("string", 4),
                ("verb", 8),
            ]
            .into_iter()
            .map(|(key, count)| (key.to_string(), count))
            .collect()
        );
        assert_eq!(
            count_field(tokens, "visualRole"),
            [
                ("ADJECTIVE", 5),
                ("ADVERB", 6),
                ("LITERAL", 1),
                ("MUTED", 27),
                ("NOUN", 7),
                ("QUOTED", 4),
                ("STRUCTURAL_KEYWORD", 40),
                ("TYPE_LIKE", 4),
                ("UNSTYLED", 71),
                ("VERB", 8),
            ]
            .into_iter()
            .map(|(key, count)| (key.to_string(), count))
            .collect()
        );
    }

    #[test]
    fn diagnose_rejects_multiple_file_operands() {
        let err = run_diagnose(["first.txt".to_string(), "second.txt".to_string()]).unwrap_err();

        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(err.to_string(), "expected at most one FILE argument");
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
    fn version_flag_reports_package_version() {
        let want = format!("colorful {}\n", env!("CARGO_PKG_VERSION"));
        assert_eq!(version_output(), want);
        assert!(run(["--version".to_string()]).is_ok());
        assert!(run(["-V".to_string()]).is_ok());
    }

    #[test]
    fn help_text_reports_package_version() {
        let help = help_text();
        assert!(help.starts_with(&format!(
            "colorful {} — color English prose by part of speech\n\n",
            env!("CARGO_PKG_VERSION")
        )));
        assert!(help.contains("-V, --version"));
        assert!(help.contains("colorful diagnose [--json] [FILE]"));
    }

    #[test]
    fn version_flag_rejects_extra_arguments() {
        let err = run(["--version".to_string(), "extra".to_string()]).unwrap_err();
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

    fn count_field(
        tokens: &[serde_json::Value],
        field: &str,
    ) -> std::collections::BTreeMap<String, usize> {
        let mut counts = std::collections::BTreeMap::new();
        for token in tokens {
            let key = token[field].as_str().unwrap_or("<null>");
            *counts.entry(key.to_string()).or_insert(0) += 1;
        }
        counts
    }
}
