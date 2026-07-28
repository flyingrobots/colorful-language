use colorful_cli::{line_col, lint_report};
use colorful_core::{
    Analyzer, ClassificationError, Finding, Node, PosClass, Rule, Severity, Span, Token, Tree,
    ValidatedClassification,
};
use colorful_ir::validate_document;
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lsp::compute_diagnostics;
use colorful_parse::ProseParser;
use colorful_projection::build_document;
use proptest::{
    collection::vec,
    prelude::*,
    test_runner::{Config, RngAlgorithm, TestCaseError, TestRng, TestRunner},
};

const PROPERTY_CASES: u32 = 256;
const PROPERTY_SEED: [u8; 32] = [
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
];

fn runner() -> TestRunner {
    let config = Config {
        cases: PROPERTY_CASES,
        failure_persistence: None,
        ..Config::default()
    };
    TestRunner::new_with_rng(
        config,
        TestRng::from_seed(RngAlgorithm::ChaCha, &PROPERTY_SEED),
    )
}

fn unicode_source() -> impl Strategy<Value = String> {
    (
        vec(any::<char>(), 0..24),
        vec(any::<char>(), 0..24),
        vec(any::<char>(), 0..24),
    )
        .prop_map(|(prefix, middle, suffix)| {
            let prefix: String = prefix.into_iter().collect();
            let middle: String = middle.into_iter().collect();
            let suffix: String = suffix.into_iter().collect();
            format!("é{prefix}😀e\u{301}\u{200d}\n{middle}\r\n{suffix}\r")
        })
}

fn leaf_spans(tree: &Tree) -> Result<Vec<Span>, TestCaseError> {
    let Node::Document(sentences) = &tree.root else {
        return Err(TestCaseError::fail("parser root was not a document"));
    };
    let mut spans = Vec::new();
    for sentence in sentences {
        let Node::Sentence { parts, .. } = sentence else {
            return Err(TestCaseError::fail("document child was not a sentence"));
        };
        for part in parts {
            match part {
                Node::Word { span } | Node::Punct { span } => spans.push(*span),
                Node::Document(_) | Node::Sentence { .. } => {
                    return Err(TestCaseError::fail(
                        "sentence child was not a word or punctuation node",
                    ));
                }
            }
        }
    }
    Ok(spans)
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

fn assert_gap_is_parser_whitespace(gap: &str) -> Result<(), TestCaseError> {
    prop_assert!(
        gap.chars().all(is_parser_whitespace),
        "uncovered source character in gap {gap:?}"
    );
    Ok(())
}

fn assert_legal_spans_and_round_trip(
    source: &str,
    tree: &Tree,
    tokens: &[Token],
) -> Result<(), TestCaseError> {
    let spans = leaf_spans(tree)?;
    prop_assert_eq!(spans.len(), tokens.len());

    let mut cursor = 0usize;
    let mut reconstructed = String::with_capacity(source.len());
    for (index, span) in spans.into_iter().enumerate() {
        prop_assert!(span.start < span.end);
        prop_assert!(span.start >= cursor);
        prop_assert!(span.end <= source.len());
        prop_assert!(source.is_char_boundary(span.start));
        prop_assert!(source.is_char_boundary(span.end));
        prop_assert_eq!(tokens[index].span, span);

        let gap = &source[cursor..span.start];
        assert_gap_is_parser_whitespace(gap)?;
        reconstructed.push_str(gap);
        reconstructed.push_str(&source[span.start..span.end]);
        cursor = span.end;
    }
    let trailing_gap = &source[cursor..];
    assert_gap_is_parser_whitespace(trailing_gap)?;
    reconstructed.push_str(trailing_gap);
    prop_assert_eq!(reconstructed, source);
    Ok(())
}

fn valid_tree_and_token() -> (Tree, Vec<Token>) {
    let span = Span::new(0, 2);
    (
        Tree::document(vec![Node::Sentence {
            span,
            parts: vec![Node::Word { span }],
        }]),
        vec![Token {
            span,
            class: PosClass::Content,
        }],
    )
}

fn malformed_classification(
    source: &str,
    mutation: u8,
) -> (Tree, Vec<Token>, &'static str, &'static str) {
    let (mut tree, mut tokens) = valid_tree_and_token();
    let first_end = source
        .char_indices()
        .nth(1)
        .map_or(source.len(), |(index, _)| index);
    let second_end = source
        .char_indices()
        .nth(2)
        .map_or(source.len(), |(index, _)| index);
    let (variant, path) = match mutation {
        0 => {
            tree.root = Node::Word {
                span: Span::new(0, 2),
            };
            ("UnexpectedNodeKind", "tree.root")
        }
        1 => {
            tree = Tree::document(vec![Node::Sentence {
                span: Span::new(0, 2),
                parts: vec![Node::Word {
                    span: Span { start: 2, end: 1 },
                }],
            }]);
            ("ReversedSpan", "tree.root.sentences[0].parts[0].span")
        }
        2 => {
            tree = Tree::document(vec![Node::Sentence {
                span: Span::new(0, 2),
                parts: vec![Node::Word {
                    span: Span::new(0, source.len() + 1),
                }],
            }]);
            (
                "SpanOutOfBounds",
                "tree.root.sentences[0].parts[0].span.end",
            )
        }
        3 => {
            tree = Tree::document(vec![Node::Sentence {
                span: Span::new(0, 2),
                parts: vec![Node::Word {
                    span: Span::new(1, 2),
                }],
            }]);
            (
                "SpanNotOnCharBoundary",
                "tree.root.sentences[0].parts[0].span.start",
            )
        }
        4 => {
            tokens.clear();
            ("TreeTokenCountMismatch", "tokens")
        }
        5 => {
            tree = Tree::document(vec![Node::Sentence {
                span: Span::new(0, second_end),
                parts: vec![
                    Node::Word {
                        span: Span::new(first_end, second_end),
                    },
                    Node::Word {
                        span: Span::new(0, first_end),
                    },
                ],
            }]);
            tokens = vec![
                Token {
                    span: Span::new(first_end, second_end),
                    class: PosClass::Content,
                },
                Token {
                    span: Span::new(0, first_end),
                    class: PosClass::Content,
                },
            ];
            ("UnsortedSpan", "tree.root.sentences[0].parts[1].span.start")
        }
        6 => {
            tree = Tree::document(vec![Node::Sentence {
                span: Span::new(0, second_end),
                parts: vec![
                    Node::Word {
                        span: Span::new(0, first_end),
                    },
                    Node::Word {
                        span: Span::new(0, second_end),
                    },
                ],
            }]);
            tokens = vec![
                Token {
                    span: Span::new(0, first_end),
                    class: PosClass::Content,
                },
                Token {
                    span: Span::new(0, second_end),
                    class: PosClass::Content,
                },
            ];
            (
                "OverlappingSpan",
                "tree.root.sentences[0].parts[1].span.start",
            )
        }
        7 => {
            tree = Tree::document(vec![Node::Sentence {
                span: Span::new(0, first_end),
                parts: vec![
                    Node::Word {
                        span: Span::new(0, first_end),
                    },
                    Node::Word {
                        span: Span::new(first_end, second_end),
                    },
                ],
            }]);
            tokens = vec![
                Token {
                    span: Span::new(0, first_end),
                    class: PosClass::Content,
                },
                Token {
                    span: Span::new(first_end, second_end),
                    class: PosClass::Content,
                },
            ];
            (
                "ChildSpanOutsideParent",
                "tree.root.sentences[0].parts[1].span",
            )
        }
        _ => {
            tokens[0].span = Span::new(0, second_end);
            ("TreeTokenSpanMismatch", "tokens[0].span")
        }
    };
    (tree, tokens, variant, path)
}

fn classification_variant(error: &ClassificationError) -> &'static str {
    match error {
        ClassificationError::UnexpectedNodeKind { .. } => "UnexpectedNodeKind",
        ClassificationError::ReversedSpan { .. } => "ReversedSpan",
        ClassificationError::SpanOutOfBounds { .. } => "SpanOutOfBounds",
        ClassificationError::SpanNotOnCharBoundary { .. } => "SpanNotOnCharBoundary",
        ClassificationError::UnsortedSpan { .. } => "UnsortedSpan",
        ClassificationError::OverlappingSpan { .. } => "OverlappingSpan",
        ClassificationError::ChildSpanOutsideParent { .. } => "ChildSpanOutsideParent",
        ClassificationError::TreeTokenCountMismatch { .. } => "TreeTokenCountMismatch",
        ClassificationError::TreeTokenSpanMismatch { .. } => "TreeTokenSpanMismatch",
    }
}

fn mutate_ir(
    document: &mut colorful_ir::syntax_v1::DocumentAnalysis,
    mutation: u8,
) -> (&'static str, &'static str) {
    match mutation {
        0 => {
            document.contract_version = "colorful.syntax/v999".to_string();
            ("UnsupportedContractVersion", "contractVersion")
        }
        1 => {
            document.source.content_hash = "not-the-source-hash".to_string();
            ("ContentHashMismatch", "source.contentHash")
        }
        2 => {
            document.tokens[0].byte_range.start_utf8 = -1;
            ("NegativeOffset", "tokens[0].byteRange.startUtf8")
        }
        3 => {
            document.tokens[0].byte_range.start_utf8 = document.tokens[0].byte_range.end_utf8 + 1;
            ("RangeOutOfOrder", "tokens[0].byteRange")
        }
        4 => {
            document.tokens[0].byte_range.end_utf8 = document.tokens[0].byte_range.start_utf8;
            ("EmptyTokenRange", "tokens[0].byteRange")
        }
        _ => {
            document.tokens[0].byte_range.start_utf8 = 1;
            ("RangeNotOnCharBoundary", "tokens[0].byteRange.startUtf8")
        }
    }
}

#[derive(Clone)]
struct FixedFinding {
    span: Span,
}

impl Analyzer for FixedFinding {
    fn analyze(&self, _source: &str, _tree: &Tree, _tokens: &[Token]) -> Vec<Finding> {
        vec![Finding {
            span: self.span,
            rule: Rule::WeakWord,
            severity: Severity::Info,
            message: "property finding".to_string(),
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

fn report_position(report: &str) -> Result<(usize, usize), TestCaseError> {
    let mut fields = report.splitn(4, ':');
    let _name = fields.next();
    let line = fields
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| TestCaseError::fail("CLI report omitted a numeric line"))?;
    let column = fields
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| TestCaseError::fail("CLI report omitted a numeric column"))?;
    Ok((line, column))
}

fn assert_parser_and_annotator_property(source: &str) -> Result<(), TestCaseError> {
    let classification = ValidatedClassification::from_ports(
        source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
    )
    .map_err(|error| TestCaseError::fail(error.to_string()))?;
    assert_legal_spans_and_round_trip(source, classification.tree(), classification.tokens())
}

fn assert_public_tree_mutation(source: &str, mutation: u8) -> Result<(), TestCaseError> {
    let (tree, tokens, expected_variant, expected_path) =
        malformed_classification(source, mutation);
    let error = ValidatedClassification::new(source, tree, tokens)
        .expect_err("selected malformed classification must fail");
    prop_assert_eq!(classification_variant(&error), expected_variant);
    prop_assert_eq!(error.path().to_string(), expected_path);
    Ok(())
}

fn assert_projection_and_ir_mutation(source: &str, mutation: u8) -> Result<(), TestCaseError> {
    let mut document = build_document(
        "property",
        source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
    )
    .map_err(|error| TestCaseError::fail(error.to_string()))?;
    validate_document(&document.document, Some(source.as_bytes()))
        .map_err(|errors| TestCaseError::fail(errors.to_string()))?;
    let canonical = colorful_ir::canonical_json(&document.document)
        .map_err(|error| TestCaseError::fail(error.to_string()))?;
    let decoded: colorful_ir::syntax_v1::DocumentAnalysis =
        serde_json::from_str(&canonical).map_err(|error| TestCaseError::fail(error.to_string()))?;
    let recanonical = colorful_ir::canonical_json(&decoded)
        .map_err(|error| TestCaseError::fail(error.to_string()))?;
    prop_assert_eq!(recanonical, canonical);

    let (expected_code, expected_path) = mutate_ir(&mut document.document, mutation);
    let errors = validate_document(&document.document, Some(source.as_bytes()))
        .expect_err("selected malformed IR mutation must fail");
    let first = errors
        .0
        .first()
        .ok_or_else(|| TestCaseError::fail("IR mutation returned no error"))?;
    prop_assert_eq!(first.code(), expected_code);
    prop_assert_eq!(first.path().to_string(), expected_path);
    Ok(())
}

fn assert_cli_and_lsp_coordinate_property(prefix: &str) -> Result<(), TestCaseError> {
    let start = prefix.len();
    let source = format!("{prefix}target");
    let span = Span::new(start, source.len());
    let finding = Finding {
        span,
        rule: Rule::WeakWord,
        severity: Severity::Info,
        message: "property finding".to_string(),
    };

    let cli = report_position(&lint_report("property", &source, &[finding]))?;
    let diagnostics = compute_diagnostics(
        &source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
        &FixedFinding { span },
    )
    .map_err(|error| TestCaseError::fail(error.to_string()))?;
    let diagnostic = diagnostics
        .first()
        .ok_or_else(|| TestCaseError::fail("LSP omitted the property finding"))?;

    let (start_line, start_scalar, start_utf16) = oracle_position(&source, span.start);
    let (end_line, _end_scalar, end_utf16) = oracle_position(&source, span.end);
    prop_assert_eq!(
        line_col(&source, span.start),
        (start_line + 1, start_scalar + 1)
    );
    prop_assert_eq!(cli, (start_line + 1, start_scalar + 1));
    prop_assert_eq!(diagnostic.range.start.line as usize, start_line);
    prop_assert_eq!(diagnostic.range.start.character, start_utf16);
    prop_assert_eq!(diagnostic.range.end.line as usize, end_line);
    prop_assert_eq!(diagnostic.range.end.character, end_utf16);
    Ok(())
}

#[test]
fn seeded_property_boundaries_hold_for_each_generated_case() {
    runner()
        .run(
            &(unicode_source(), 0u8..9, 0u8..6),
            |(source, classification_mutation, ir_mutation)| {
                assert_parser_and_annotator_property(&source)?;
                assert_public_tree_mutation(&source, classification_mutation)?;
                assert_projection_and_ir_mutation(&source, ir_mutation)?;
                assert_cli_and_lsp_coordinate_property(&source)
            },
        )
        .expect("seeded property boundary corpus");
}

#[test]
fn classification_mutation_matrix_covers_every_error_variant() {
    let source = "é😀e\u{301}";
    let expected = [
        ("UnexpectedNodeKind", "tree.root"),
        ("ReversedSpan", "tree.root.sentences[0].parts[0].span"),
        (
            "SpanOutOfBounds",
            "tree.root.sentences[0].parts[0].span.end",
        ),
        (
            "SpanNotOnCharBoundary",
            "tree.root.sentences[0].parts[0].span.start",
        ),
        ("TreeTokenCountMismatch", "tokens"),
        ("UnsortedSpan", "tree.root.sentences[0].parts[1].span.start"),
        (
            "OverlappingSpan",
            "tree.root.sentences[0].parts[1].span.start",
        ),
        (
            "ChildSpanOutsideParent",
            "tree.root.sentences[0].parts[1].span",
        ),
        ("TreeTokenSpanMismatch", "tokens[0].span"),
    ];

    for (mutation, (expected_variant, expected_path)) in expected.into_iter().enumerate() {
        let (tree, tokens, declared_variant, declared_path) =
            malformed_classification(source, mutation as u8);
        assert_eq!(declared_variant, expected_variant);
        assert_eq!(declared_path, expected_path);
        let error = ValidatedClassification::new(source, tree, tokens)
            .expect_err("selected malformed classification must fail");
        assert_eq!(classification_variant(&error), expected_variant);
        assert_eq!(error.path().to_string(), expected_path);
    }
}

#[test]
fn source_round_trip_oracle_rejects_dropped_non_whitespace() {
    let source = "word";
    let error = assert_legal_spans_and_round_trip(source, &Tree::document(Vec::new()), &[])
        .expect_err("dropped non-whitespace input must fail the round-trip oracle");
    assert!(
        error.to_string().contains("uncovered source character"),
        "unexpected oracle error: {error}"
    );
}

#[test]
fn source_round_trip_oracle_accepts_every_parser_whitespace_scalar() {
    let source = " \t\r\n\u{000C}\u{00A0}\u{1680}\u{2000}\u{200A}\u{202F}\u{205F}\u{3000}";
    assert_legal_spans_and_round_trip(source, &Tree::document(Vec::new()), &[])
        .expect("the parser may omit every explicitly skipped whitespace scalar");
}
