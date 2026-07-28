use super::*;
use colorful_core::{
    Annotator, ClassificationError, LexicalAnnotator, Node, Parser, PassIdentity, PosClass, Span,
    Token as CoreToken, Tree, ValidatedClassification,
};
use colorful_lexicon::ClosedClassLexicon;
use colorful_parse::ProseParser;
use std::collections::{BTreeSet, HashMap};

fn analyze(source: &str) -> syntax_v1::DocumentAnalysis {
    let parser = ProseParser::new();
    let annotator = LexicalAnnotator::new(ClosedClassLexicon::new());
    let tree = parser.parse(source);
    let tokens = annotator.annotate(source, &tree);
    from_classification(
        "test",
        source,
        &tree,
        &tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .expect("projection within i32 range")
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValidatorParityMatrix {
    schema_version: u32,
    cases: Vec<ValidatorParityCase>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValidatorParityCase {
    name: String,
    replacements: Vec<ValidatorParityReplacement>,
    source_hex: Option<String>,
    rust_error: String,
    js_error: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidatorParityReplacement {
    pointer: String,
    value: serde_json::Value,
}

fn validator_parity_document(source: &str) -> syntax_v1::DocumentAnalysis {
    use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};

    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
    let tree = parser.parse(source);
    let tokens = annotator.annotate(source, &tree);
    from_classification(
        "crates/colorful-ir/tests/fixtures/validator-parity.txt",
        source,
        &tree,
        &tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .expect("validator parity fixture projects within the i32 wire range")
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err("hex input must contain an even number of digits".to_owned());
    }
    hex.as_bytes()
        .chunks_exact(2)
        .map(|digits| {
            let pair = std::str::from_utf8(digits)
                .map_err(|error| format!("hex input was not ASCII: {error}"))?;
            u8::from_str_radix(pair, 16)
                .map_err(|error| format!("invalid hex byte {pair:?}: {error}"))
        })
        .collect()
}

#[test]
fn shared_validator_parity_matrix_covers_every_error_variant() {
    const SOURCE: &str = include_str!("../tests/fixtures/validator-parity.txt");
    const MATRIX: &str = include_str!("../tests/fixtures/validator-parity.json");

    let matrix: ValidatorParityMatrix =
        serde_json::from_str(MATRIX).expect("validator parity matrix must deserialize");
    assert_eq!(
        matrix.schema_version, 1,
        "unsupported parity matrix version"
    );

    let inventory: BTreeSet<_> = ValidationError::VARIANT_NAMES.iter().copied().collect();
    assert_eq!(
        inventory.len(),
        ValidationError::VARIANT_NAMES.len(),
        "Rust ValidationError inventory contains a duplicate"
    );
    let matrix_errors: BTreeSet<_> = matrix
        .cases
        .iter()
        .map(|test_case| test_case.rust_error.as_str())
        .collect();
    assert_eq!(
        matrix_errors.len(),
        matrix.cases.len(),
        "each Rust ValidationError variant must have exactly one parity case"
    );
    assert_eq!(
        matrix_errors, inventory,
        "shared parity matrix must cover the complete Rust ValidationError inventory"
    );

    let case_names: BTreeSet<_> = matrix
        .cases
        .iter()
        .map(|test_case| test_case.name.as_str())
        .collect();
    assert_eq!(
        case_names.len(),
        matrix.cases.len(),
        "shared parity matrix contains a duplicate case name"
    );

    let locally_produced = validator_parity_document(SOURCE);
    let base_document = match std::env::var_os("COLORFUL_VALIDATOR_PARITY_DOCUMENT") {
        Some(path) => {
            let encoded = std::fs::read_to_string(&path).unwrap_or_else(|error| {
                panic!("failed to read parity producer document {path:?}: {error}")
            });
            assert_eq!(
                encoded,
                canonical_json(&locally_produced)
                    .expect("locally produced parity document must canonicalize"),
                "scripted parity input must be the exact canonical producer document"
            );
            serde_json::from_str(&encoded)
                .expect("scripted canonical producer document must deserialize")
        }
        None => locally_produced,
    };
    validate_document(&base_document, Some(SOURCE.as_bytes()))
        .expect("canonical producer document must pass before mutation");

    for test_case in &matrix.cases {
        assert!(
            !test_case.replacements.is_empty(),
            "{}: needs at least one replacement",
            test_case.name
        );
        assert!(
            !test_case.js_error.is_empty(),
            "{}: needs a JavaScript error code",
            test_case.name
        );

        let mut value =
            serde_json::to_value(&base_document).expect("producer document must serialize");
        for replacement in &test_case.replacements {
            let target = value.pointer_mut(&replacement.pointer).unwrap_or_else(|| {
                panic!(
                    "{}: replacement pointer does not exist: {}",
                    test_case.name, replacement.pointer
                )
            });
            *target = replacement.value.clone();
        }
        let document: syntax_v1::DocumentAnalysis =
            serde_json::from_value(value).unwrap_or_else(|error| {
                panic!("{}: mutation must deserialize: {error}", test_case.name)
            });
        let source = test_case
            .source_hex
            .as_deref()
            .map_or_else(|| Ok(SOURCE.as_bytes().to_vec()), decode_hex);
        let source = source.unwrap_or_else(|error| panic!("{}: {error}", test_case.name));
        let errors = match validate_document(&document, Some(&source)) {
            Ok(()) => panic!("{}: Rust validator accepted the mutation", test_case.name),
            Err(errors) => errors,
        };
        let actual: BTreeSet<_> = errors.0.iter().map(ValidationError::code).collect();
        assert!(
            actual.contains(test_case.rust_error.as_str()),
            "{}: expected Rust error {}, got {:?}",
            test_case.name,
            test_case.rust_error,
            actual
        );
    }
}

#[test]
fn to_i32_rejects_values_past_the_wire_range() {
    // The narrowing conversion every offset/length/id goes through must fail
    // loudly past i32::MAX rather than wrap negative.
    assert_eq!(to_i32("x", 0), Ok(0));
    assert_eq!(to_i32("x", i32::MAX as usize), Ok(i32::MAX));
    assert_eq!(
        to_i32("source length", i32::MAX as usize + 1),
        Err(ProjectionError::Overflow {
            what: "source length",
            value: i32::MAX as usize + 1,
        })
    );
}

fn assert_document_invariants(label: &str, source: &str, doc: &syntax_v1::DocumentAnalysis) {
    let len = i32::try_from(source.len()).unwrap();

    // Source digest + length.
    assert_eq!(
        doc.source.content_hash,
        sha256_hex(source.as_bytes()),
        "{label}: content hash"
    );
    assert_eq!(doc.source.utf8_byte_length, len, "{label}: byte length");
    assert_eq!(
        doc.contract_version, CONTRACT_VERSION,
        "{label}: contract version"
    );

    // Tokens: ordered, in-bounds, non-overlapping, on char boundaries
    // (slicing would panic otherwise), non-empty.
    let mut prev_end = 0;
    for token in &doc.tokens {
        let (start, end) = (token.byte_range.start_utf8, token.byte_range.end_utf8);
        assert!(start <= end && end <= len, "{label}: out of bounds");
        assert!(start >= prev_end, "{label}: overlapping tokens");
        let text = &source[start as usize..end as usize];
        assert!(!text.is_empty(), "{label}: empty token span");
        prev_end = end;
    }

    // Structure: every node's range contains each child's range.
    let by_id: HashMap<i32, &syntax_v1::OutlineNode> =
        doc.structure.iter().map(|n| (n.node_id, n)).collect();
    for node in &doc.structure {
        for child_id in &node.child_node_ids {
            let child = by_id[child_id];
            assert!(
                node.byte_range.start_utf8 <= child.byte_range.start_utf8,
                "{label}: child starts before parent"
            );
            assert!(
                child.byte_range.end_utf8 <= node.byte_range.end_utf8,
                "{label}: child ends after parent"
            );
        }
    }

    // Canonical JSON decodes back and re-encodes identically (Rust round-trip).
    let a = canonical_json(doc).unwrap();
    let decoded: syntax_v1::DocumentAnalysis = serde_json::from_str(&a).unwrap();
    assert_eq!(
        a,
        canonical_json(&decoded).unwrap(),
        "{label}: JSON round-trip"
    );
}

/// The IR-3 structural-invariant oracle: byte ranges ordered, in-bounds,
/// non-overlapping, and on char boundaries; every `structure` node's
/// range contains its children; the source digest matches; a Rust JSON
/// round-trip is stable. `label` identifies which fixture failed, since
/// every corpus entry below shares this exact same assertion function
/// rather than a bespoke check per input shape. Runs both the default
/// lexical annotator and the contextual annotator to ensure contextual
/// ambiguity invariants are exercised.
fn assert_invariants_hold(label: &str, source: &str) {
    let doc_lexical = analyze(source);
    assert_document_invariants(label, source, &doc_lexical);

    use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
    let tree = parser.parse(source);
    let tokens = annotator.annotate(source, &tree);
    let doc_contextual = from_classification(
        "test-contextual",
        source,
        &tree,
        &tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .expect("projection within i32 range");

    assert_document_invariants(label, source, &doc_contextual);
}

#[test]
fn document_analysis_holds_the_invariants() {
    assert_invariants_hold(
        "hand-written baseline fixture",
        "The cat sat on the mat. Paris is nice.\n\nDogs run fast.",
    );
}

/// A named fixture in the IR-3 structural-invariant corpus
/// (`docs/topics/ir/test-plan.md` IR-3/IR-3b): every entry runs through
/// the identical [`assert_invariants_hold`] oracle used above, rather
/// than a bespoke assertion per input shape.
struct InvariantFixture {
    name: &'static str,
    source: &'static str,
}

const INVARIANT_CORPUS: &[InvariantFixture] = &[
        InvariantFixture {
            name: "empty input",
            source: "",
        },
        InvariantFixture {
            name: "unicode",
            source: "Café résumé naïve 日本語 test. Ångström glows 😀 brightly.",
        },
        InvariantFixture {
            name: "crlf variants",
            source: "First line.\r\nSecond line.\rThird line.\n\r\nNew paragraph starts.",
        },
        InvariantFixture {
            name: "punctuation only",
            source: "... --- !!! ??? () [] {} \"\" ,;:",
        },
        InvariantFixture {
            name: "long tokens",
            source: "Supercalifragilisticexpialidocious antidisestablishmentarianism pneumonoultramicroscopicsilicovolcanoconiosis.",
        },
        InvariantFixture {
            name: "multiple paragraphs",
            source: "First paragraph, first sentence. First paragraph, second sentence.\n\nSecond paragraph starts here. It has two sentences.\n\nThird paragraph is short.",
        },
        InvariantFixture {
            name: "contextual ambiguity",
            source: "The book I book rooms. The fast river connects fast. They record a record. The lead pipe leads.",
        },
    ];

#[test]
fn invariant_corpus_holds_across_documented_edge_cases() {
    for fixture in INVARIANT_CORPUS {
        assert_invariants_hold(fixture.name, fixture.source);
    }
}

// ---- producer projection boundary ----

fn projection_parts(source: &str) -> (Tree, Vec<CoreToken>, PassIdentity, PassIdentity) {
    let parser = ProseParser::new();
    let annotator = LexicalAnnotator::new(ClosedClassLexicon::new());
    let tree = parser.parse(source);
    let tokens = annotator.annotate(source, &tree);
    (
        tree,
        tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
}

fn malformed_projection_error(source: &str, tree: &Tree, tokens: &[CoreToken]) -> ProjectionError {
    let parser_identity = ProseParser::new().pass_identity();
    let annotator_identity = LexicalAnnotator::new(ClosedClassLexicon::new()).pass_identity();
    from_classification(
        "malformed",
        source,
        tree,
        tokens,
        parser_identity,
        annotator_identity,
    )
    .unwrap_err()
}

#[test]
fn projection_rejects_a_reversed_span_with_the_core_error_path() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens[0].span = Span { start: 3, end: 0 };

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(ClassificationError::ReversedSpan {
            ref path,
            start: 3,
            end: 0,
        }) if path.to_string() == "tokens[0].span"
    ));
}

#[test]
fn projection_rejects_an_out_of_bounds_span_with_the_core_error_path() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    let last = tokens.len() - 1;
    tokens[last].span.end = source.len() + 1;

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(
            ClassificationError::SpanOutOfBounds {
                ref path,
                end,
                length,
            }
        ) if path.to_string() == format!("tokens[{last}].span.end")
            && end == source.len() + 1
            && length == source.len()
    ));
}

#[test]
fn projection_rejects_a_mid_code_point_span_with_the_core_error_path() {
    let source = "é.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens[0].span.start = 1;

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(
            ClassificationError::SpanNotOnCharBoundary {
                ref path,
                offset: 1,
            }
        ) if path.to_string() == "tokens[0].span.start"
    ));
}

#[test]
fn projection_rejects_unsorted_tokens_with_the_core_error_path() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens.swap(0, 1);

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(ClassificationError::UnsortedSpan {
            ref path,
            previous_index: 0,
            ..
        }) if path.to_string() == "tokens[1].span.start"
    ));
}

#[test]
fn projection_rejects_overlapping_tokens_with_the_core_error_path() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens[1].span.start = 2;

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(ClassificationError::OverlappingSpan {
            ref path,
            previous_index: 0,
            ..
        }) if path.to_string() == "tokens[1].span.start"
    ));
}

#[test]
fn projection_rejects_a_tree_token_count_mismatch_with_the_core_error_path() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens.pop();

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(
            ClassificationError::TreeTokenCountMismatch {
                ref path,
                tree_leaves: 3,
                tokens: 2,
            }
        ) if path.to_string() == "tokens"
    ));
}

#[test]
fn projection_rejects_a_tree_token_span_mismatch_with_both_paths() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens[0].span.end = 2;

    assert!(matches!(
        malformed_projection_error(source, &tree, &tokens),
        ProjectionError::InvalidClassification(
            ClassificationError::TreeTokenSpanMismatch {
                ref path,
                ref tree_path,
                ..
            }
        ) if path.to_string() == "tokens[0].span"
            && tree_path.to_string() == "tree.root.sentences[0].parts[0].span"
    ));
}

#[test]
fn projection_checks_classification_before_producer_identity() {
    let source = "cat runs.";
    let (tree, mut tokens, _, _) = projection_parts(source);
    tokens[0].span = Span { start: 3, end: 0 };

    let error = from_classification(
        "precedence",
        source,
        &tree,
        &tokens,
        PassIdentity::default(),
        PassIdentity::default(),
    )
    .unwrap_err();

    assert!(matches!(
        error,
        ProjectionError::InvalidClassification(ClassificationError::ReversedSpan { .. })
    ));
}

#[test]
fn aggregate_native_and_compatibility_projection_are_byte_identical() {
    let source = "The cat runs.";
    let parser = ProseParser::new();
    let annotator = LexicalAnnotator::new(ClosedClassLexicon::new());
    let classification = ValidatedClassification::from_ports(source, &parser, &annotator)
        .expect("built-in producers are valid");

    let compatibility = from_classification(
        "parity",
        source,
        classification.tree(),
        classification.tokens(),
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .expect("compatibility projection succeeds");
    let aggregate = from_validated_classification(
        "parity",
        &classification,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .expect("aggregate projection succeeds");

    assert_eq!(
        canonical_json(&compatibility).unwrap(),
        canonical_json(&aggregate).unwrap()
    );
}

#[test]
fn aggregate_projection_rejects_a_document_that_fails_its_postcondition() {
    let tree = Tree::document(vec![Node::Sentence {
        span: Span::new(0, 0),
        parts: vec![Node::Word {
            span: Span::new(0, 0),
        }],
    }]);
    let tokens = vec![CoreToken {
        span: Span::new(0, 0),
        class: PosClass::Content,
    }];
    let classification = ValidatedClassification::new("", tree, tokens)
        .expect("core permits an empty but internally consistent leaf");
    let error = from_validated_classification(
        "postcondition",
        &classification,
        PassIdentity {
            pass_id: "segment",
            rule_id: "test-parser",
        },
        PassIdentity {
            pass_id: "classify",
            rule_id: "test-annotator",
        },
    )
    .unwrap_err();

    assert!(matches!(
        error,
        ProjectionError::InvalidProjectedDocument(ref errors)
            if has(errors, |error| matches!(
                error,
                ValidationError::EmptyTokenRange { path, .. }
                    if path.to_string() == "tokens[0].byteRange"
            ))
    ));
}

// ---- paragraph boundaries ----

fn paragraph_count(source: &str) -> usize {
    analyze(source)
        .structure
        .iter()
        .filter(|n| n.kind == syntax_v1::OutlineKind::Paragraph)
        .count()
}

#[test]
fn a_carriage_return_only_blank_line_splits_paragraphs() {
    // Classic Mac Os line endings: no '\n' anywhere, so a byte-count of
    // '\n' characters (the old implementation) would never see two
    // paragraphs here.
    assert_eq!(paragraph_count("First sentence.\r\rSecond sentence."), 2);
}

#[test]
fn a_single_carriage_return_does_not_split_paragraphs() {
    // One line break is a line wrap, not a blank line.
    assert_eq!(paragraph_count("First sentence.\rSecond sentence."), 1);
}

#[test]
fn a_crlf_blank_line_splits_paragraphs_exactly_once() {
    // Each '\r\n' is one logical break; two such breaks (four bytes)
    // form one blank-line paragraph boundary.
    assert_eq!(
        paragraph_count("First sentence.\r\n\r\nSecond sentence."),
        2
    );
}

// ---- pass identity ----

#[test]
fn derivation_reports_the_real_producers_pass_identity() {
    // `analyze()` here uses ProseParser + LexicalAnnotator(ClosedClassLexicon);
    // the derivation must name exactly those two, not a hardcoded literal —
    // a different annotator (e.g. ContextualOpenClassAnnotator) must show up
    // under its own honest rule_id.
    let doc = analyze(VALID_SOURCE);
    assert_eq!(doc.derivation.len(), 2);
    assert_eq!(doc.derivation[0].pass_id, "segment");
    assert_eq!(doc.derivation[0].rule_id, "prose-segmenter");
    assert_eq!(doc.derivation[1].pass_id, "classify");
    assert_eq!(doc.derivation[1].rule_id, "lexical-annotator");
}

#[test]
fn derivation_names_a_different_annotator_honestly() {
    use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};

    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
    let tree = parser.parse(VALID_SOURCE);
    let tokens = annotator.annotate(VALID_SOURCE, &tree);
    let doc = from_classification(
        "test",
        VALID_SOURCE,
        &tree,
        &tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .expect("projection within i32 range");

    assert_eq!(doc.derivation[1].pass_id, "classify");
    assert_eq!(doc.derivation[1].rule_id, "contextual-open-class-annotator");
}

/// A third-party `Parser`/`Annotator` that does not override
/// `pass_identity()` — proves the additive-default compatibility boundary
/// actually rejects a silently-unidentified producer instead of letting it
/// through with a plausible-looking placeholder.
struct UnidentifiedParser;
impl Parser for UnidentifiedParser {
    fn parse(&self, text: &str) -> Tree {
        ProseParser::new().parse(text)
    }
}

struct UnidentifiedAnnotator;
impl Annotator for UnidentifiedAnnotator {
    fn annotate(&self, source: &str, tree: &Tree) -> Vec<CoreToken> {
        LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(source, tree)
    }
}

#[test]
fn from_classification_rejects_an_unidentified_parser() {
    let parser = UnidentifiedParser;
    let annotator = LexicalAnnotator::new(ClosedClassLexicon::new());
    let tree = parser.parse(VALID_SOURCE);
    let tokens = annotator.annotate(VALID_SOURCE, &tree);
    let err = from_classification(
        "test",
        VALID_SOURCE,
        &tree,
        &tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .unwrap_err();
    assert_eq!(err, ProjectionError::MissingPassIdentity { role: "parser" });
}

#[test]
fn from_classification_rejects_an_unidentified_annotator() {
    let parser = ProseParser::new();
    let annotator = UnidentifiedAnnotator;
    let tree = parser.parse(VALID_SOURCE);
    let tokens = annotator.annotate(VALID_SOURCE, &tree);
    let err = from_classification(
        "test",
        VALID_SOURCE,
        &tree,
        &tokens,
        parser.pass_identity(),
        annotator.pass_identity(),
    )
    .unwrap_err();
    assert_eq!(
        err,
        ProjectionError::MissingPassIdentity { role: "annotator" }
    );
}

#[test]
fn from_classification_rejects_a_duplicate_pass_id() {
    let parser = ProseParser::new();
    let annotator = LexicalAnnotator::new(ClosedClassLexicon::new());
    let tree = parser.parse(VALID_SOURCE);
    let tokens = annotator.annotate(VALID_SOURCE, &tree);
    let clashing = PassIdentity {
        pass_id: "segment",
        rule_id: "lexical-annotator",
    };
    let err = from_classification(
        "test",
        VALID_SOURCE,
        &tree,
        &tokens,
        parser.pass_identity(),
        clashing,
    )
    .unwrap_err();
    assert_eq!(err, ProjectionError::DuplicatePassId { pass_id: "segment" });
}

// ---- validate_document ----

const VALID_SOURCE: &str = "The cat sat on the mat. Paris is nice.\n\nDogs run fast.";

/// Whether `errors` contains a variant matching `pred`.
fn has(errors: &ValidationErrors, pred: impl Fn(&ValidationError) -> bool) -> bool {
    errors.0.iter().any(pred)
}

#[test]
fn a_produced_document_validates_with_and_without_source() {
    let doc = analyze(VALID_SOURCE);
    validate_document(&doc, Some(VALID_SOURCE.as_bytes())).expect("valid with source");
    validate_document(&doc, None).expect("valid without source");
}

#[test]
fn rejects_wrong_contract_schema_and_vocabulary() {
    let mut doc = analyze(VALID_SOURCE);
    doc.contract_version = "colorful.syntax/v2".to_string();
    doc.schema_hash = "sha256:deadbeef".to_string();
    doc.vocabulary_hash = "sha256:feedface".to_string();
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::UnsupportedContractVersion { path, .. }
            if path.to_string() == "contractVersion"
    )));
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::SchemaHashMismatch { path, .. }
            if path.to_string() == "schemaHash"
    )));
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::VocabularyHashMismatch { path, .. }
            if path.to_string() == "vocabularyHash"
    )));
}

#[test]
fn rejects_content_hash_and_byte_length_against_the_real_source() {
    let doc = analyze(VALID_SOURCE);
    // A different source: the document's hash and length no longer describe it.
    let other = "Completely different prose here.";
    let errors = validate_document(&doc, Some(other.as_bytes())).unwrap_err();
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::ContentHashMismatch { path, .. }
            if path.to_string() == "source.contentHash"
    )));
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::ByteLengthMismatch { path, .. }
            if path.to_string() == "source.utf8ByteLength"
    )));
}

#[test]
fn rejects_a_range_out_of_order_and_out_of_bounds() {
    let mut doc = analyze(VALID_SOURCE);
    doc.tokens[0].byte_range = syntax_v1::ByteRange {
        start_utf8: 9,
        end_utf8: 2,
    };
    doc.tokens[1].byte_range = syntax_v1::ByteRange {
        start_utf8: 0,
        end_utf8: 100_000,
    };
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::RangeOutOfOrder { path, .. }
            if path.to_string() == "tokens[0].byteRange"
    )));
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::RangeOutOfBounds { path, .. }
            if path.to_string() == "tokens[1].byteRange.endUtf8"
    )));
}

#[test]
fn rejects_a_negative_offset() {
    let mut doc = analyze(VALID_SOURCE);
    doc.tokens[0].byte_range.start_utf8 = -1;
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::NegativeOffset { path, .. }
            if path.to_string() == "tokens[0].byteRange.startUtf8"
    )));
}

#[test]
fn rejects_a_range_off_a_utf8_char_boundary() {
    // "é" is two bytes; a range ending at byte 1 splits the character.
    let source = "é is here.";
    let mut doc = analyze(source);
    doc.tokens[0].byte_range = syntax_v1::ByteRange {
        start_utf8: 0,
        end_utf8: 1,
    };
    let errors = validate_document(&doc, Some(source.as_bytes())).unwrap_err();
    assert!(has(&errors, |e| matches!(
        e,
        ValidationError::RangeNotOnCharBoundary { path, .. }
            if path.to_string() == "tokens[0].byteRange.endUtf8"
    )));
}

#[test]
fn rejects_an_empty_token_range() {
    let mut doc = analyze(VALID_SOURCE);
    doc.tokens[0].byte_range.end_utf8 = doc.tokens[0].byte_range.start_utf8;

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::EmptyTokenRange {
            path,
            occurrence_id: 0,
        } if path.to_string() == "tokens[0].byteRange"
    ));
}

#[test]
fn rejects_an_unsorted_token_range() {
    let mut doc = analyze(VALID_SOURCE);
    let first = doc.tokens[0].byte_range.clone();
    doc.tokens[0].byte_range = doc.tokens[1].byte_range.clone();
    doc.tokens[1].byte_range = first;

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::UnsortedTokenRange {
            path,
            previous_index: 0,
            ..
        } if path.to_string() == "tokens[1].byteRange.startUtf8"
    ));
}

#[test]
fn rejects_overlapping_token_ranges() {
    let mut doc = analyze(VALID_SOURCE);
    doc.tokens[1].byte_range.start_utf8 = doc.tokens[0].byte_range.end_utf8 - 1;

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::OverlappingTokenRange {
            path,
            previous_index: 0,
            ..
        } if path.to_string() == "tokens[1].byteRange.startUtf8"
    ));
}

#[test]
fn rejects_illegal_token_axes() {
    use syntax_v1::{LexicalClass, OpenClassKind, TokenKind};
    // A WORD without a lexicalClass.
    let mut doc = analyze(VALID_SOURCE);
    let word = doc
        .tokens
        .iter_mut()
        .find(|t| t.token_kind == TokenKind::Word)
        .unwrap();
    word.lexical_class = None;
    word.function_kind = None;
    assert!(has(
        &validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err(),
        |e| matches!(e, ValidationError::IllegalTokenAxes { path, .. } if path.to_string().starts_with("tokens["))
    ));

    // A NUMBER carrying a lexicalClass.
    let mut doc = analyze("I have 3 cats.");
    let number = doc
        .tokens
        .iter_mut()
        .find(|t| t.token_kind == TokenKind::Number)
        .unwrap();
    number.lexical_class = Some(LexicalClass::Content);
    assert!(has(
        &validate_document(&doc, None).unwrap_err(),
        |e| matches!(e, ValidationError::IllegalTokenAxes { path, .. } if path.to_string().starts_with("tokens["))
    ));

    // A NUMBER carrying an openClassKind.
    let mut doc = analyze("I have 3 cats.");
    let number = doc
        .tokens
        .iter_mut()
        .find(|t| t.token_kind == TokenKind::Number)
        .unwrap();
    number.open_class_kind = Some(OpenClassKind::Noun);
    assert!(has(
        &validate_document(&doc, None).unwrap_err(),
        |e| matches!(e, ValidationError::IllegalTokenAxes { path, .. } if path.to_string().starts_with("tokens["))
    ));

    // A FUNCTION word missing its functionKind.
    let mut doc = analyze(VALID_SOURCE);
    let function = doc
        .tokens
        .iter_mut()
        .find(|t| t.lexical_class == Some(LexicalClass::Function))
        .unwrap();
    function.function_kind = None;
    assert!(has(
        &validate_document(&doc, None).unwrap_err(),
        |e| matches!(e, ValidationError::IllegalTokenAxes { path, .. } if path.to_string().starts_with("tokens["))
    ));

    // A FUNCTION word carrying an openClassKind.
    let mut doc = analyze(VALID_SOURCE);
    let function = doc
        .tokens
        .iter_mut()
        .find(|t| t.lexical_class == Some(LexicalClass::Function))
        .unwrap();
    function.open_class_kind = Some(OpenClassKind::Verb);
    assert!(has(
        &validate_document(&doc, None).unwrap_err(),
        |e| matches!(e, ValidationError::IllegalTokenAxes { path, .. } if path.to_string().starts_with("tokens["))
    ));

    // A proper-noun candidate carrying an openClassKind.
    let mut doc = analyze("I saw Paris.");
    let proper_noun = doc
        .tokens
        .iter_mut()
        .find(|t| t.lexical_class == Some(LexicalClass::ProperNounCandidate))
        .unwrap();
    proper_noun.open_class_kind = Some(OpenClassKind::Noun);
    assert!(has(
        &validate_document(&doc, None).unwrap_err(),
        |e| matches!(e, ValidationError::IllegalTokenAxes { path, .. } if path.to_string().starts_with("tokens["))
    ));
}

#[test]
fn open_class_pos_projects_with_explicit_open_class_kind() {
    use colorful_core::OpenClassKind;
    use syntax_v1::{LexicalClass, OpenClassKind as IrOpenClassKind, TokenKind};

    for (kind, ir_kind) in [
        (OpenClassKind::Noun, IrOpenClassKind::Noun),
        (OpenClassKind::Verb, IrOpenClassKind::Verb),
        (OpenClassKind::Adjective, IrOpenClassKind::Adjective),
        (OpenClassKind::Adverb, IrOpenClassKind::Adverb),
    ] {
        assert_eq!(
            token_axes(PosClass::Open(kind)),
            (
                TokenKind::Word,
                Some(LexicalClass::Content),
                None,
                Some(ir_kind)
            )
        );
    }
}

#[test]
fn rejects_a_duplicate_token_id() {
    let mut doc = analyze(VALID_SOURCE);
    let dup = doc.tokens[1].occurrence_id;
    doc.tokens[0].occurrence_id = dup;
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::DuplicateTokenId { path, .. }
                if path.to_string() == "tokens[1]"
        )),
        "{errors:?}"
    );
}

#[test]
fn rejects_a_dangling_child_ref() {
    let mut doc = analyze(VALID_SOURCE);
    // Point a paragraph at a nonexistent child node.
    let paragraph = doc
        .structure
        .iter_mut()
        .find(|n| n.kind == syntax_v1::OutlineKind::Paragraph)
        .unwrap();
    paragraph.child_node_ids.push(9_999);
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::DanglingChildRef { path, child: 9_999 }
                if path.to_string().starts_with("structure[")
                    && path.to_string().contains(".childNodeIds[")
        )),
        "{errors:?}"
    );
}

#[test]
fn rejects_a_duplicate_node_id() {
    let mut doc = analyze(VALID_SOURCE);
    // Two distinct outline nodes must exist for this to be a meaningful
    // mutation, not a coincidence of a single-node document.
    assert!(doc.structure.len() >= 2, "fixture needs 2+ outline nodes");
    let dup = doc.structure[1].node_id;
    doc.structure[0].node_id = dup;
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::DuplicateNodeId { path, node_id }
                if *node_id == dup && path.to_string() == "structure[1]"
        )),
        "{errors:?}"
    );
}

#[test]
fn rejects_an_invalid_outline_kind_depth_pair() {
    let mut doc = analyze(VALID_SOURCE);
    let paragraph_index = doc
        .structure
        .iter()
        .position(|node| node.kind == syntax_v1::OutlineKind::Paragraph)
        .expect("fixture needs a paragraph");
    doc.structure[paragraph_index].depth = 1;

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::InvalidOutlineDepth {
            path,
            depth: 1,
            expected: 0,
        } if path.to_string() == format!("structure[{paragraph_index}].depth")
    ));
}

#[test]
fn rejects_a_structure_cycle() {
    let mut doc = analyze(VALID_SOURCE);
    let paragraph_index = doc
        .structure
        .iter()
        .position(|node| node.kind == syntax_v1::OutlineKind::Paragraph)
        .expect("fixture needs a paragraph");
    let paragraph_id = doc.structure[paragraph_index].node_id;
    doc.structure[paragraph_index].child_node_ids = vec![paragraph_id];

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::StructureCycle {
            path,
            parent,
            child,
        } if path.to_string()
            == format!("structure[{paragraph_index}].childNodeIds[0]")
            && *parent == paragraph_id
            && *child == paragraph_id
    ));
}

#[test]
fn rejects_a_cycle_reached_through_an_unvisited_child() {
    let mut doc = analyze(VALID_SOURCE);
    let paragraph_index = doc
        .structure
        .iter()
        .position(|node| node.kind == syntax_v1::OutlineKind::Paragraph)
        .expect("fixture needs a paragraph");
    let paragraph_id = doc.structure[paragraph_index].node_id;
    let paragraph_range = doc.structure[paragraph_index].byte_range.clone();
    let child_id = doc.structure[paragraph_index]
        .child_node_ids
        .first()
        .copied()
        .expect("fixture paragraph needs a child");
    let child_index = doc
        .structure
        .iter()
        .position(|node| node.node_id == child_id)
        .expect("paragraph child must exist");

    // Equalize the ranges so the back edge isolates acyclicity from the
    // independent parent-containment invariant.
    doc.structure[child_index].byte_range = paragraph_range;
    doc.structure[child_index].child_node_ids = vec![paragraph_id];

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::StructureCycle {
            path,
            parent,
            child,
        } if path.to_string() == format!("structure[{child_index}].childNodeIds[0]")
            && *parent == child_id
            && *child == paragraph_id
    ));
}

#[test]
fn rejects_a_child_with_multiple_parents() {
    let mut doc = analyze(VALID_SOURCE);
    let paragraph_indices: Vec<_> = doc
        .structure
        .iter()
        .enumerate()
        .filter_map(|(index, node)| {
            (node.kind == syntax_v1::OutlineKind::Paragraph).then_some(index)
        })
        .collect();
    assert_eq!(paragraph_indices.len(), 2, "fixture needs two paragraphs");
    let first_parent = paragraph_indices[0];
    let second_parent = paragraph_indices[1];
    let shared_child = doc.structure[first_parent].child_node_ids[0];
    let edge_index = doc.structure[second_parent].child_node_ids.len();
    doc.structure[second_parent].byte_range = syntax_v1::ByteRange {
        start_utf8: 0,
        end_utf8: VALID_SOURCE.len() as i32,
    };
    doc.structure[second_parent]
        .child_node_ids
        .push(shared_child);

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::MultipleStructureParents { path, child, .. }
            if path.to_string()
                == format!("structure[{second_parent}].childNodeIds[{edge_index}]")
                && *child == shared_child
    ));
}

#[test]
fn rejects_a_child_outside_its_parent_range() {
    let mut doc = analyze(VALID_SOURCE);
    let paragraph_index = doc
        .structure
        .iter()
        .enumerate()
        .filter_map(|(index, node)| {
            (node.kind == syntax_v1::OutlineKind::Paragraph).then_some(index)
        })
        .next_back()
        .expect("fixture needs a paragraph");
    let child_id = doc.structure[paragraph_index].child_node_ids[0];
    let child_end = doc
        .structure
        .iter()
        .find(|node| node.node_id == child_id)
        .expect("paragraph child must exist")
        .byte_range
        .end_utf8;
    doc.structure[paragraph_index].byte_range.end_utf8 = child_end - 1;

    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert_eq!(errors.0.len(), 1, "{errors:?}");
    assert!(matches!(
        &errors.0[0],
        ValidationError::ChildRangeOutsideParent {
            path,
            parent,
            child,
        } if path.to_string()
            == format!("structure[{paragraph_index}].childNodeIds[0]")
            && *parent == doc.structure[paragraph_index].node_id
            && *child == child_id
    ));
}

#[test]
fn rejects_an_out_of_bounds_diagnostic_range() {
    let mut doc = analyze(VALID_SOURCE);
    assert!(
        doc.diagnostics.is_empty(),
        "fixture must start with no diagnostics for the pushed one to land at index 0"
    );
    doc.diagnostics.push(syntax_v1::Diagnostic {
        byte_range: syntax_v1::ByteRange {
            start_utf8: 0,
            end_utf8: VALID_SOURCE.len() as i32 + 1_000,
        },
        severity: syntax_v1::DiagnosticSeverity::Warning,
        code: "test/out-of-bounds".to_string(),
        message: "test fixture".to_string(),
    });
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::RangeOutOfBounds { path, .. }
                if path.to_string() == "diagnostics[0].byteRange.endUtf8"
        )),
        "{errors:?}"
    );
}

#[test]
fn collects_every_failure_rather_than_the_first() {
    let mut doc = analyze(VALID_SOURCE);
    doc.contract_version = "wrong".to_string();
    doc.tokens[0].byte_range.start_utf8 = -5;
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(errors.0.len() >= 2, "expected several errors: {errors:?}");
}

#[test]
fn path_segments_reports_fields_and_indices_in_order() {
    let path = Path::root().field("tokens").index(2).field("byteRange");
    assert_eq!(
        path.segments(),
        &[
            PathSegment::Field("tokens"),
            PathSegment::Index(2),
            PathSegment::Field("byteRange"),
        ]
    );
}

#[test]
fn validation_error_display_renders_path_and_message() {
    let error = ValidationError::RangeOutOfBounds {
        path: Path::root()
            .field("tokens")
            .index(2)
            .field("byteRange")
            .field("endUtf8"),
        end: 100,
        length: 50,
    };
    assert_eq!(
        error.to_string(),
        "at tokens[2].byteRange.endUtf8: 100 exceeds source length 50"
    );
}

#[test]
fn validation_error_display_escapes_untrusted_document_strings() {
    // contractVersion, hash "found" values, and derivation passId all
    // come straight from an untrusted document. recanon.rs prints this
    // Display output directly to stderr, so a hostile value containing a
    // newline or a terminal escape sequence must not reach the render
    // verbatim — it must come out escaped, not interpreted.
    let hostile = "sha256:evil\x1b[31mFAKE ERROR\x1b[0m\nrecanon: fabricated line";

    let contract_version = ValidationError::UnsupportedContractVersion {
        path: Path::root().field("contractVersion"),
        found: hostile.to_string(),
    };
    let rendered = contract_version.to_string();
    assert!(
        !rendered.contains('\n') && !rendered.contains('\x1b'),
        "raw control characters leaked into rendered output: {rendered:?}"
    );
    assert!(
        rendered.contains("\\n") && rendered.contains("\\u{1b}"),
        "expected the control characters escaped, got: {rendered:?}"
    );

    let pass_id = ValidationError::DuplicateDerivationPassId {
        path: Path::root().field("derivation").index(0),
        pass_id: hostile.to_string(),
    };
    let rendered = pass_id.to_string();
    assert!(
        !rendered.contains('\n') && !rendered.contains('\x1b'),
        "raw control characters leaked into rendered output: {rendered:?}"
    );
}

#[test]
fn validation_errors_display_lists_every_error_by_display_not_debug() {
    let errors = ValidationErrors(vec![
        ValidationError::EmptyDerivation {
            path: Path::root().field("derivation"),
        },
        ValidationError::SourceNotUtf8 {
            path: Path::root().field("source"),
        },
    ]);
    assert_eq!(
            errors.to_string(),
            "document failed validation (2 issue(s)):\n  - at derivation: must not be empty\n  - at source: not valid UTF-8"
        );
}

#[test]
fn error_order_follows_the_seven_validator_stages() {
    // Trip one invariant in each of the seven stages, then assert the
    // returned errors appear in the fixed stage order `validate_document`
    // runs: contract identity, source identity, token ranges, token
    // axes, structure graph, diagnostics, derivation. This pins the
    // ordering contract itself — nothing else in this suite fails if a
    // future edit reorders the `errors.extend(...)` calls in
    // `validate_document`.
    use syntax_v1::{LexicalClass, OpenClassKind};

    // A mid-sentence capitalized word ("Paris", not sentence-initial) is
    // needed to get a proper-noun-candidate token; VALID_SOURCE's only
    // capitalized word is sentence-initial and so is never tagged as one.
    let source = "The cat sat on the mat. I saw Paris.\n\nDogs run fast.";
    let mut doc = analyze(source);

    // Stage: contract identity.
    doc.contract_version = "wrong".to_string();

    // Stage: source identity — a declared length that lies about the
    // real bytes. `ctx.length` always uses the real byte count when a
    // source is supplied, so this cannot cascade into spurious
    // out-of-bounds errors in a later stage.
    doc.source.utf8_byte_length += 1;

    // Stage: token ranges.
    doc.tokens[0].byte_range.start_utf8 = -1;

    // Stage: token axes — a proper-noun candidate carrying an open-class
    // kind is an illegal axis combination.
    let proper_noun = doc
        .tokens
        .iter_mut()
        .find(|t| t.lexical_class == Some(LexicalClass::ProperNounCandidate))
        .expect("fixture has a proper-noun candidate token");
    proper_noun.open_class_kind = Some(OpenClassKind::Noun);

    // Stage: structure graph — duplicate a node id.
    assert!(doc.structure.len() >= 2, "fixture needs 2+ outline nodes");
    let dup_node = doc.structure[1].node_id;
    doc.structure[0].node_id = dup_node;

    // Stage: diagnostics — an out-of-bounds range.
    doc.diagnostics.push(syntax_v1::Diagnostic {
        byte_range: syntax_v1::ByteRange {
            start_utf8: 0,
            end_utf8: source.len() as i32 + 1_000,
        },
        severity: syntax_v1::DiagnosticSeverity::Warning,
        code: "test/stage-order".to_string(),
        message: "test fixture".to_string(),
    });

    // Stage: derivation — empty.
    doc.derivation.clear();

    let errors = validate_document(&doc, Some(source.as_bytes()))
        .unwrap_err()
        .0;

    let position_of = |pred: &dyn Fn(&ValidationError) -> bool| -> usize {
        errors
            .iter()
            .position(pred)
            .unwrap_or_else(|| panic!("expected error not found in {errors:?}"))
    };

    let contract_pos =
        position_of(&|e| matches!(e, ValidationError::UnsupportedContractVersion { .. }));
    let source_pos = position_of(&|e| matches!(e, ValidationError::ByteLengthMismatch { .. }));
    let token_range_pos = position_of(&|e| matches!(e, ValidationError::NegativeOffset { .. }));
    let token_axes_pos = position_of(&|e| matches!(e, ValidationError::IllegalTokenAxes { .. }));
    let structure_pos = position_of(&|e| matches!(e, ValidationError::DuplicateNodeId { .. }));
    let diagnostics_pos = position_of(&|e| {
        matches!(
            e,
            ValidationError::RangeOutOfBounds { path, .. }
                if path.to_string().starts_with("diagnostics[")
        )
    });
    let derivation_pos = position_of(&|e| matches!(e, ValidationError::EmptyDerivation { .. }));

    assert!(
        contract_pos < source_pos
            && source_pos < token_range_pos
            && token_range_pos < token_axes_pos
            && token_axes_pos < structure_pos
            && structure_pos < diagnostics_pos
            && diagnostics_pos < derivation_pos,
        "expected stage order contract < source < token_ranges < token_axes < structure \
             < diagnostics < derivation, got positions {contract_pos}, {source_pos}, \
             {token_range_pos}, {token_axes_pos}, {structure_pos}, {diagnostics_pos}, \
             {derivation_pos} in {errors:?}"
    );
}

#[test]
fn negative_declared_byte_length_is_rejected_without_a_source() {
    // Without a source we cannot check the length against real bytes, but a
    // negative declared length is nonsense on its face and must be rejected.
    let mut doc = analyze(VALID_SOURCE);
    doc.source.utf8_byte_length = -1;
    let errors = validate_document(&doc, None).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::NegativeByteLength { path, .. }
                if path.to_string() == "source.utf8ByteLength"
        )),
        "{errors:?}"
    );
}

#[test]
fn byte_length_mismatch_is_reported_even_for_non_utf8_source() {
    // A hostile artifact pairs non-UTF-8 bytes with a fabricated length.
    // `bytes.len()` is known regardless of UTF-8 validity, so the length lie
    // must be surfaced *alongside* SourceNotUtf8 — not dropped because the
    // bytes failed to decode.
    let doc = analyze(VALID_SOURCE); // declares len = VALID_SOURCE.len()
    let non_utf8: &[u8] = &[0xff, 0xfe]; // invalid UTF-8, length 2
    let errors = validate_document(&doc, Some(non_utf8)).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::SourceNotUtf8 { path } if path.to_string() == "source"
        )),
        "{errors:?}"
    );
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::ByteLengthMismatch { path, .. }
                if path.to_string() == "source.utf8ByteLength"
        )),
        "{errors:?}"
    );
}

#[test]
fn rejects_a_derivation_step_with_missing_identity() {
    let mut doc = analyze(VALID_SOURCE);
    doc.derivation[0].pass_id = String::new();
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::MissingDerivationIdentity { path }
                if path.to_string() == "derivation[0]"
        )),
        "{errors:?}"
    );
}

#[test]
fn rejects_an_artifact_with_an_empty_derivation_trace() {
    // Stripping `derivation` to `[]` must not bypass every per-step
    // identity check by making the loop iterate zero times — an artifact
    // claiming no producer ran at all is never valid.
    let mut doc = analyze(VALID_SOURCE);
    doc.derivation.clear();
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::EmptyDerivation { path } if path.to_string() == "derivation"
        )),
        "{errors:?}"
    );
}

#[test]
fn rejects_derivation_steps_sharing_a_pass_id() {
    let mut doc = analyze(VALID_SOURCE);
    let dup = doc.derivation[1].pass_id.clone();
    doc.derivation[0].pass_id = dup.clone();
    let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
    assert!(
        has(&errors, |e| matches!(
            e,
            ValidationError::DuplicateDerivationPassId { path, pass_id }
                if *pass_id == dup && path.to_string() == "derivation[1]"
        )),
        "{errors:?}"
    );
}
