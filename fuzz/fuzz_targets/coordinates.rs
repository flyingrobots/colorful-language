#![forbid(unsafe_code)]
#![no_main]

use colorful_cli::line_col;
use colorful_core::{Analyzer, Finding, Rule, Severity, Span, Token, Tree};
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lsp::compute_diagnostics;
use colorful_parse::ProseParser;
use libfuzzer_sys::fuzz_target;

struct FixedFinding(Span);

impl Analyzer for FixedFinding {
    fn analyze(&self, _source: &str, _tree: &Tree, _tokens: &[Token]) -> Vec<Finding> {
        vec![Finding {
            span: self.0,
            rule: Rule::WeakWord,
            severity: Severity::Info,
            message: "fuzz finding".to_string(),
        }]
    }
}

fn oracle_position(source: &str, byte: usize) -> (usize, usize, u32) {
    let mut line = 0usize;
    let mut scalar_column = 0usize;
    let mut utf16_column = 0u32;
    let mut previous_was_cr = false;
    for (index, character) in source.char_indices() {
        if index >= byte {
            break;
        }
        if previous_was_cr && character == '\n' {
            previous_was_cr = false;
            continue;
        }
        previous_was_cr = false;
        match character {
            '\n' => {
                line += 1;
                scalar_column = 0;
                utf16_column = 0;
            }
            '\r' => {
                line += 1;
                scalar_column = 0;
                utf16_column = 0;
                previous_was_cr = true;
            }
            _ => {
                scalar_column += 1;
                utf16_column += character.len_utf16() as u32;
            }
        }
    }
    (line, scalar_column, utf16_column)
}

fuzz_target!(|prefix: &str| {
    let start = prefix.len();
    let source = format!("{prefix}target");
    let span = Span::new(start, source.len());
    let diagnostics = compute_diagnostics(
        &source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
        &FixedFinding(span),
    )
    .expect("built-in LSP classification");
    let diagnostic = &diagnostics[0];

    let (start_line, start_scalar, start_utf16) = oracle_position(&source, span.start);
    let (end_line, _end_scalar, end_utf16) = oracle_position(&source, span.end);
    assert_eq!(
        line_col(&source, span.start),
        (start_line + 1, start_scalar + 1)
    );
    assert_eq!(diagnostic.range.start.line as usize, start_line);
    assert_eq!(diagnostic.range.start.character, start_utf16);
    assert_eq!(diagnostic.range.end.line as usize, end_line);
    assert_eq!(diagnostic.range.end.character, end_utf16);
});
