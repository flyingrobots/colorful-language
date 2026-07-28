#![forbid(unsafe_code)]
#![no_main]

use colorful_core::{Node, Parser, Span, Tree};
use colorful_parse::ProseParser;
use libfuzzer_sys::fuzz_target;

fn leaf_spans(tree: &Tree) -> Vec<Span> {
    let Node::Document(sentences) = &tree.root else {
        panic!("parser root was not a document");
    };
    sentences
        .iter()
        .flat_map(|sentence| {
            let Node::Sentence { parts, .. } = sentence else {
                panic!("document child was not a sentence");
            };
            parts.iter().map(|part| match part {
                Node::Word { span } | Node::Punct { span } => *span,
                Node::Document(_) | Node::Sentence { .. } => {
                    panic!("sentence child was not a leaf")
                }
            })
        })
        .collect()
}

fn is_parser_whitespace(character: char) -> bool {
    matches!(
        character,
        ' ' | '\t'
            | '\r'
            | '\n'
            | '\u{000C}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
    ) || ('\u{2000}'..='\u{200A}').contains(&character)
}

fuzz_target!(|source: &str| {
    let tree = ProseParser::new().parse(source);
    let mut cursor = 0usize;
    let mut reconstructed = String::with_capacity(source.len());
    for span in leaf_spans(&tree) {
        assert!(span.start < span.end);
        assert!(span.start >= cursor);
        assert!(span.end <= source.len());
        assert!(source.is_char_boundary(span.start));
        assert!(source.is_char_boundary(span.end));
        let gap = &source[cursor..span.start];
        assert!(gap.chars().all(is_parser_whitespace));
        reconstructed.push_str(gap);
        reconstructed.push_str(&source[span.start..span.end]);
        cursor = span.end;
    }
    let trailing_gap = &source[cursor..];
    assert!(trailing_gap.chars().all(is_parser_whitespace));
    reconstructed.push_str(trailing_gap);
    assert_eq!(reconstructed, source);
});
