#![forbid(unsafe_code)]
#![no_main]

use colorful_core::ValidatedClassification;
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_parse::ProseParser;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|source: &str| {
    let classification = ValidatedClassification::from_ports(
        source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
    )
    .expect("built-in parser and annotator must produce a valid classification");

    for token in classification.tokens() {
        assert!(token.span.start < token.span.end);
        assert!(token.span.end <= source.len());
        assert!(source.is_char_boundary(token.span.start));
        assert!(source.is_char_boundary(token.span.end));
    }
});
