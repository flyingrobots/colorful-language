//! Golden-fixture harness for the prose-linting rule pack.
//!
//! Each fixture is a real, reviewed prose sample under `fixtures/lint/*.txt`
//! paired with a hand-reviewed `fixtures/lint/*.golden` file holding the exact
//! compiler-style report `colorful lint` would print for it. A mismatch here
//! means either a rule's behavior changed or its rendering changed --
//! either way, something worth a human's attention, not a silent drift.
//!
//! Each fixture also cross-checks that `colorful-lsp`'s diagnostics name the
//! same findings (by rule code, severity, and message) as the CLI's report,
//! so the CLI and LSP surfaces can never silently disagree about what a
//! document's problems are -- only how a position is encoded (UTF-8 columns
//! for the CLI, UTF-16 for the LSP) is allowed to differ, and even that is
//! cross-checked directly for the ASCII golden fixtures and by a dedicated
//! Unicode + mixed-line-ending parity case below.

use colorful_cli::lint_report;
use colorful_core::{Analyzer, Annotator, Parser, Severity};
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;

/// Every fixture pair, named without extension: `NAME.txt` is the input,
/// `NAME.golden` is the reviewed expected CLI report.
const FIXTURES: &[&str] = &[
    "weak-word",
    "run-on",
    "length-outlier",
    "passive-voice",
    "mixed-ordering",
    "false-positives",
    "crlf-line-endings",
];

fn fixture_path(name: &str, ext: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/lint")
        .join(format!("{name}.{ext}"))
}

#[test]
fn golden_fixtures_match_the_reviewed_cli_report() {
    for name in FIXTURES {
        let source = std::fs::read_to_string(fixture_path(name, "txt"))
            .unwrap_or_else(|e| panic!("read {name}.txt: {e}"));
        let expected = std::fs::read_to_string(fixture_path(name, "golden"))
            .unwrap_or_else(|e| panic!("read {name}.golden: {e}"));

        let tree = ProseParser::new().parse(&source);
        let tokens = ContextualOpenClassAnnotator::default().annotate(&source, &tree);
        let findings = ProseLinter::new().analyze(&source, &tree, &tokens);
        let got = lint_report(&format!("{name}.txt"), &source, &findings);

        assert_eq!(got, expected, "fixture {name} drifted from its golden file");
    }
}

#[test]
fn cli_and_lsp_agree_on_every_fixture_finding() {
    for name in FIXTURES {
        let source = std::fs::read_to_string(fixture_path(name, "txt"))
            .unwrap_or_else(|e| panic!("read {name}.txt: {e}"));

        let parser = ProseParser::new();
        let annotator = ContextualOpenClassAnnotator::default();
        let tree = parser.parse(&source);
        let tokens = annotator.annotate(&source, &tree);
        let cli_findings = ProseLinter::new().analyze(&source, &tree, &tokens);

        let lsp_diagnostics =
            colorful_lsp::compute_diagnostics(&source, &parser, &annotator, &ProseLinter::new());

        assert_eq!(
            cli_findings.len(),
            lsp_diagnostics.len(),
            "{name}: CLI reported {} finding(s), LSP reported {} diagnostic(s)",
            cli_findings.len(),
            lsp_diagnostics.len()
        );

        for (finding, diagnostic) in cli_findings.iter().zip(lsp_diagnostics.iter()) {
            let code = finding.rule.code();
            let diagnostic_code = match &diagnostic.code {
                Some(tower_lsp::lsp_types::NumberOrString::String(s)) => s.as_str(),
                other => panic!("{name}: expected a string diagnostic code, got {other:?}"),
            };
            assert_eq!(diagnostic_code, code, "{name}: rule code mismatch");
            assert_eq!(
                diagnostic.message, finding.message,
                "{name}: message mismatch for {code}"
            );

            let expected_severity = match finding.severity {
                Severity::Warning => tower_lsp::lsp_types::DiagnosticSeverity::WARNING,
                Severity::Info => tower_lsp::lsp_types::DiagnosticSeverity::INFORMATION,
            };
            assert_eq!(
                diagnostic.severity,
                Some(expected_severity),
                "{name}: severity mismatch for {code}"
            );

            // These fixtures are ASCII-only, so UTF-8 character columns and
            // UTF-16 code-unit columns coincide: the LSP's 0-based line/
            // character should equal the CLI's 1-based line/column minus one.
            // Check both ends of the range -- a truncated or extended end
            // would still leave the start matching, so start alone can't
            // prove the ranges agree.
            let (start_line, start_col) = colorful_cli::line_col(&source, finding.span.start);
            assert_eq!(
                diagnostic.range.start.line as usize,
                start_line - 1,
                "{name}: start line mismatch for {code}"
            );
            assert_eq!(
                diagnostic.range.start.character as usize,
                start_col - 1,
                "{name}: start column mismatch for {code}"
            );

            let (end_line, end_col) = colorful_cli::line_col(&source, finding.span.end);
            assert_eq!(
                diagnostic.range.end.line as usize,
                end_line - 1,
                "{name}: end line mismatch for {code}"
            );
            assert_eq!(
                diagnostic.range.end.character as usize,
                end_col - 1,
                "{name}: end column mismatch for {code}"
            );
        }
    }
}

/// Independently resolve one byte offset into the two position encodings under
/// test: the CLI's 1-based Unicode-scalar line/column and the LSP's 0-based
/// UTF-16 line/character. `\r\n`, bare `\r`, and bare `\n` are each one logical
/// line break.
fn expected_positions(source: &str, byte: usize) -> ((usize, usize), (u32, u32)) {
    assert!(
        source.is_char_boundary(byte),
        "oracle byte offset must be a character boundary"
    );

    let mut cli_line = 1usize;
    let mut cli_col = 1usize;
    let mut lsp_line = 0u32;
    let mut lsp_character = 0u32;
    let mut chars = source[..byte].chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                cli_line += 1;
                cli_col = 1;
                lsp_line += 1;
                lsp_character = 0;
            }
            '\n' => {
                cli_line += 1;
                cli_col = 1;
                lsp_line += 1;
                lsp_character = 0;
            }
            _ => {
                cli_col += 1;
                lsp_character += ch.len_utf16() as u32;
            }
        }
    }

    ((cli_line, cli_col), (lsp_line, lsp_character))
}

#[test]
fn cli_and_lsp_positions_agree_across_unicode_and_mixed_line_endings() {
    // Each finding follows both an astral scalar (two UTF-16 code units, one
    // Unicode scalar) and a combining mark (one unit/scalar). The four lines
    // exercise CRLF, bare CR, and LF in a single source.
    let source =
        "😀 cafe\u{301} just.\r\n😀 cafe\u{301} just.\r😀 cafe\u{301} just.\n😀 cafe\u{301} just.";
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let tree = parser.parse(source);
    let tokens = annotator.annotate(source, &tree);
    let cli_findings = ProseLinter::new().analyze(source, &tree, &tokens);
    let lsp_diagnostics =
        colorful_lsp::compute_diagnostics(source, &parser, &annotator, &ProseLinter::new());

    assert_eq!(cli_findings.len(), 4, "one weak-word finding per line");
    assert_eq!(lsp_diagnostics.len(), cli_findings.len());

    for (index, (finding, diagnostic)) in
        cli_findings.iter().zip(lsp_diagnostics.iter()).enumerate()
    {
        let expected_line = index + 1;
        let code = finding.rule.code();
        assert_eq!(code, "weak-word");
        assert_eq!(finding.span.slice(source), "just");
        let diagnostic_code = match &diagnostic.code {
            Some(tower_lsp::lsp_types::NumberOrString::String(code)) => code.as_str(),
            other => panic!("line {expected_line}: expected string diagnostic code, got {other:?}"),
        };
        assert_eq!(diagnostic_code, code, "line {expected_line}: rule mismatch");
        assert_eq!(
            diagnostic.message, finding.message,
            "line {expected_line}: message mismatch"
        );
        let expected_severity = match finding.severity {
            Severity::Warning => tower_lsp::lsp_types::DiagnosticSeverity::WARNING,
            Severity::Info => tower_lsp::lsp_types::DiagnosticSeverity::INFORMATION,
        };
        assert_eq!(
            diagnostic.severity,
            Some(expected_severity),
            "line {expected_line}: severity mismatch"
        );

        let (cli_start, lsp_start) = expected_positions(source, finding.span.start);
        let (cli_end, lsp_end) = expected_positions(source, finding.span.end);
        assert_eq!(cli_start.0, expected_line, "CLI start human line");
        assert_eq!(cli_end.0, expected_line, "CLI end human line");
        assert_eq!(
            colorful_cli::line_col(source, finding.span.start),
            cli_start,
            "CLI start position"
        );
        assert_eq!(
            colorful_cli::line_col(source, finding.span.end),
            cli_end,
            "CLI end position"
        );
        assert_eq!(
            (
                diagnostic.range.start.line,
                diagnostic.range.start.character
            ),
            lsp_start,
            "LSP start position"
        );
        assert_eq!(
            (diagnostic.range.end.line, diagnostic.range.end.character),
            lsp_end,
            "LSP end position"
        );
    }
}
