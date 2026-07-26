use colorful_core::{numeric_prefix_len, Lexicon, Node, Parser, PosClass, Span};
use colorful_lexicon::ClosedClassLexicon;
use colorful_parse::ProseParser;

const MATRIX: &str = include_str!("fixtures/numeric_parity.tsv");

fn leaf_slices(source: &str) -> Vec<&str> {
    let Node::Document(sentences) = ProseParser::new().parse(source).root else {
        unreachable!("parser root is always a document");
    };

    sentences
        .iter()
        .flat_map(|sentence| match sentence {
            Node::Sentence { parts, .. } => parts.as_slice(),
            _ => &[],
        })
        .filter_map(|part| match part {
            Node::Word { span } | Node::Punct { span } => Some(*span),
            _ => None,
        })
        .map(|span: Span| span.slice(source))
        .collect()
}

#[test]
fn parser_and_lexicon_share_the_numeric_matrix() {
    let lexicon = ClosedClassLexicon::new();

    for (index, row) in MATRIX.lines().enumerate() {
        if row.is_empty() || row.starts_with('#') {
            continue;
        }
        let mut fields = row.split('\t');
        let expected_class = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no class", index + 1));
        let input = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no input", index + 1));
        let expected_leaves: Vec<&str> = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no parser leaves", index + 1))
            .split('|')
            .collect();
        assert!(
            fields.next().is_none(),
            "row {} has extra columns",
            index + 1
        );

        assert_eq!(
            leaf_slices(input),
            expected_leaves,
            "row {} parser leaves for {input:?}",
            index + 1
        );

        let expected_number = match expected_class {
            "number" => true,
            "content" => false,
            other => panic!("row {} has unknown class {other:?}", index + 1),
        };
        assert_eq!(
            numeric_prefix_len(input) == Some(input.len()),
            expected_number,
            "row {} shared scanner for {input:?}",
            index + 1
        );
        assert_eq!(
            lexicon.classify(input) == PosClass::Number,
            expected_number,
            "row {} lexicon class for {input:?}",
            index + 1
        );
    }
}
