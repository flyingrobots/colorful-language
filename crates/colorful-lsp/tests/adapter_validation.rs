//! Public-contract evidence for malformed parser and annotator output.

use colorful_core::{Annotator, ClassificationError, PosClass, Span, Token, Tree};
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lint::ProseLinter;
use colorful_lsp::{compute_diagnostics, compute_semantic_tokens, DocumentAnalysis};
use colorful_parse::ProseParser;
use tower_lsp::lsp_types::NumberOrString;

struct SwitchableAnnotator {
    emits_overlap: bool,
}

impl Annotator for SwitchableAnnotator {
    fn annotate(&self, source: &str, tree: &Tree) -> Vec<Token> {
        if !self.emits_overlap {
            return ContextualOpenClassAnnotator::default().annotate(source, tree);
        }
        vec![
            Token {
                span: Span::new(0, 3),
                class: PosClass::Content,
            },
            Token {
                span: Span::new(2, 7),
                class: PosClass::Content,
            },
        ]
    }
}

#[test]
fn standalone_surfaces_propagate_custom_adapter_validation_errors() {
    let valid = SwitchableAnnotator {
        emits_overlap: false,
    };
    compute_semantic_tokens("cat runs", &ProseParser::new(), &valid)
        .expect("valid custom semantic-token input must succeed");
    compute_diagnostics("cat runs", &ProseParser::new(), &valid, &ProseLinter::new())
        .expect("valid custom diagnostic input must succeed");

    let invalid = SwitchableAnnotator {
        emits_overlap: true,
    };
    let semantic_error = compute_semantic_tokens("cat runs", &ProseParser::new(), &invalid)
        .expect_err("overlapping semantic-token input must fail");
    let diagnostic_error = compute_diagnostics(
        "cat runs",
        &ProseParser::new(),
        &invalid,
        &ProseLinter::new(),
    )
    .expect_err("overlapping diagnostic input must fail");

    for error in [semantic_error, diagnostic_error] {
        assert!(matches!(
            error,
            ClassificationError::OverlappingSpan {
                previous_index: 0,
                ..
            }
        ));
    }
}

#[test]
fn invalid_source_view_is_a_stable_fail_closed_public_result() {
    let analysis = DocumentAnalysis::invalid_source_view();

    assert!(analysis.semantic_tokens().is_empty());
    assert_eq!(analysis.diagnostics().len(), 1);
    assert_eq!(
        analysis.diagnostics()[0].code,
        Some(NumberOrString::String(
            "colorful/invalid-source-view".to_string()
        ))
    );
}
