use colorful_core::{Analyzer, Annotator, Parser, Rule};
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;

const CORPUS: &str = include_str!("fixtures/passive_voice.tsv");

#[derive(Debug, Default, PartialEq, Eq)]
struct Counts {
    true_positives: usize,
    false_positives: usize,
    true_negatives: usize,
    false_negatives: usize,
}

#[test]
fn reviewed_passive_voice_corpus_has_no_false_positives() {
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let analyzer = ProseLinter::new();
    let mut counts = Counts::default();

    for (index, row) in CORPUS.lines().enumerate() {
        if row.is_empty() || row.starts_with('#') {
            continue;
        }
        let mut fields = row.splitn(3, '\t');
        let expectation = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no expectation", index + 1));
        let source = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no source", index + 1));
        let evidence = fields
            .next()
            .unwrap_or_else(|| panic!("row {} has no evidence", index + 1));
        assert!(!evidence.is_empty(), "row {} has empty evidence", index + 1);

        let tree = parser.parse(source);
        let tokens = annotator.annotate(source, &tree);
        let passive_count = analyzer
            .analyze(source, &tree, &tokens)
            .iter()
            .filter(|finding| finding.rule == Rule::PassiveVoice)
            .count();
        assert!(
            passive_count <= 1,
            "row {} emitted {passive_count} passive findings: {source}",
            index + 1
        );
        let predicted = passive_count == 1;

        match (expectation, predicted) {
            ("positive", true) => counts.true_positives += 1,
            ("positive", false) => counts.false_negatives += 1,
            ("negative", true) => counts.false_positives += 1,
            ("negative", false) => counts.true_negatives += 1,
            (other, _) => panic!("row {} has unknown expectation {other:?}", index + 1),
        }
    }

    assert_eq!(
        counts,
        Counts {
            true_positives: 4,
            false_positives: 0,
            true_negatives: 9,
            false_negatives: 0,
        }
    );
    let predicted_positives = counts.true_positives + counts.false_positives;
    assert_eq!(
        100 * counts.true_positives / predicted_positives,
        100,
        "reviewed development-corpus precision"
    );
}
