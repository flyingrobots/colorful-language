#![forbid(unsafe_code)]
#![no_main]

#[path = "../../crates/colorful-cli/tests/support/property_coordinates.rs"]
mod property_coordinates;

use colorful_cli::line_col;
use colorful_core::Span;
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lsp::compute_diagnostics;
use colorful_parse::ProseParser;
use libfuzzer_sys::fuzz_target;
use property_coordinates::{oracle_position, FixedFinding};

fuzz_target!(|prefix: &str| {
    let start = prefix.len();
    let source = format!("{prefix}target");
    let span = Span::new(start, source.len());
    let diagnostics = compute_diagnostics(
        &source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
        &FixedFinding::new(span),
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
