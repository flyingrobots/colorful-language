use colorful_core::{numeric_prefix_len, Lexicon, Node, Parser, PosClass};
use colorful_lexicon::ClosedClassLexicon;
use colorful_parse::ProseParser;

const MATRIX: &str = include_str!("fixtures/numeric_parity.tsv");

#[derive(Debug, PartialEq, Eq)]
enum Leaf<'a> {
    Word(&'a str),
    Punct(&'a str),
}

fn leaves(source: &str) -> Vec<Leaf<'_>> {
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
            Node::Word { span } => Some(Leaf::Word(span.slice(source))),
            Node::Punct { span } => Some(Leaf::Punct(span.slice(source))),
            _ => None,
        })
        .collect()
}

fn expected_leaf(specification: &str, row: usize) -> Leaf<'_> {
    if let Some(source) = specification.strip_prefix("word:") {
        Leaf::Word(source)
    } else if let Some(source) = specification.strip_prefix("punct:") {
        Leaf::Punct(source)
    } else {
        panic!("row {row} has unknown leaf specification {specification:?}");
    }
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
        let expected_leaves: Vec<Leaf<'_>> = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no parser leaves", index + 1))
            .split('|')
            .map(|specification| expected_leaf(specification, index + 1))
            .collect();
        assert!(
            fields.next().is_none(),
            "row {} has extra columns",
            index + 1
        );

        assert_eq!(
            leaves(input),
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

#[test]
fn every_unicode_numeric_scalar_has_parser_lexicon_parity() {
    let lexicon = ClosedClassLexicon::new();

    for character in (0..=char::MAX as u32)
        .filter_map(char::from_u32)
        .filter(|character| character.is_numeric())
    {
        let source = character.to_string();
        assert_eq!(
            leaves(&source),
            vec![Leaf::Word(source.as_str())],
            "parser leaf for U+{:04X}",
            character as u32
        );
        assert_eq!(
            numeric_prefix_len(&source),
            Some(source.len()),
            "scanner acceptance for U+{:04X}",
            character as u32
        );
        assert_eq!(
            lexicon.classify(&source),
            PosClass::Number,
            "lexicon class for U+{:04X}",
            character as u32
        );
    }
}
