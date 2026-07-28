//! The single front door from a `colorful-core` producer to the canonical
//! `colorful.syntax/v1` analysis.
//!
//! [`build_document`] parses, annotates, and classifies source text into an
//! [`AnalyzedDocument`] in one call, so a Rust producer surface that needs the
//! `colorful.syntax/v1` IR stops hand-rolling the "parse -> annotate -> project
//! into IR" pipeline by hand. `colorful-cli`'s `analyze_ir`/`diagnose_json`
//! route through it today. `colorful-lsp` does not: its semantic-token and
//! diagnostic paths only ever needed the validated core classification, never
//! the projected IR. It is a Rust-only front door in any case: **only Rust
//! producer surfaces route through it**. An external consumer such as the JS
//! graft projection never calls this crate — it receives a serialized
//! [`colorful_ir::syntax_v1::DocumentAnalysis`] artifact and validates that
//! wire contract directly with [`colorful_ir::validate_document`]. Sameness of
//! semantics (the same canonical `DocumentAnalysis` model) is not sameness of
//! allocation — there is plainly not one physical object shared across
//! independently running CLI, LSP, and JS processes.
//!
//! ```text
//! source
//!   │
//!   ▼
//! colorful-projection::build_document (colorful-cli)
//!   ├── Tree + CoreToken ───────────────► lint
//!   └── DocumentAnalysis
//!         ├─────────────────────────────► ANSI / diagnose JSON (colorful-cli)
//!         └── serialized contract ──────► graft projection
//!
//! parser.parse + annotator.annotate (colorful-lsp, no IR step)
//!   └── Tree + CoreToken ───────────────► LSP semantic tokens / diagnostics
//! ```
//!
//! [`AnalyzedDocument::tree`] and [`AnalyzedDocument::tokens`] are producer-
//! local analysis products, not wire-contract fields: `colorful-lint` matches
//! against tree structure that the `colorful.syntax/v1` IR deliberately does
//! not carry (see `docs/design/0002`), so this crate hands them back alongside
//! the projected [`AnalyzedDocument::document`] instead of flattening
//! everything into the wire DTO merely to look uniform.
//!
//! The IR tokens in [`AnalyzedDocument::document`] correspond 1:1 by index to
//! the core tokens in [`AnalyzedDocument::tokens`] — same length, matching
//! byte ranges, and the same `visual_role`/`visual_role_for` mapping every
//! ANSI/LSP role lookup uses. `build_document` checks this with a
//! `debug_assert_eq!` and the test suite pins it directly.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use colorful_core::{Annotator, Parser, Token as CoreToken, Tree, ValidatedClassification};
use colorful_ir::syntax_v1::DocumentAnalysis;

/// An error building an [`AnalyzedDocument`]. A transparent alias for
/// [`colorful_ir::ProjectionError`]: `colorful-ir` owns both invalid
/// classification and projection-contract failure reasons, so this adapter
/// does not define a parallel error model.
pub use colorful_ir::ProjectionError;

/// The bundle [`build_document`] returns: the parse tree and classified
/// tokens a producer computed, alongside the canonical [`DocumentAnalysis`]
/// projected from them.
///
/// `tree` and `tokens` are producer-local analysis products (`colorful-lint`
/// needs the tree's structure), not part of the `colorful.syntax/v1` wire
/// contract — only `document` is ever serialized across a process boundary.
#[derive(Debug, Clone)]
pub struct AnalyzedDocument {
    /// The parse tree the [`Parser`] produced.
    pub tree: Tree,
    /// The classified tokens the [`Annotator`] produced, in source order.
    pub tokens: Vec<CoreToken>,
    /// The canonical `colorful.syntax/v1` analysis projected from `tree` and
    /// `tokens`.
    pub document: DocumentAnalysis,
}

/// Parse, annotate, and classify `source` into an [`AnalyzedDocument`].
///
/// This is the one route a Rust producer surface has from source text to the
/// canonical `colorful.syntax/v1` analysis: `parser.parse`, then
/// `annotator.annotate`, core validation, then
/// [`colorful_ir::from_validated_classification`] with each producer's own
/// [`colorful_core::PassIdentity`] (via `pass_identity()`) — never a
/// hand-rolled copy of this sequence.
///
/// `parser` and `annotator` are borrowed, not consumed: both are typically
/// stateless, reusable services (a compiled lexicon, a stateless segmenter),
/// and this function has no need to take ownership of them.
///
/// # Errors
///
/// Returns [`ProjectionError`] if the parser/annotator output fails core
/// validation, `source` or its token count exceeds the IR's `i32` wire range,
/// either producer did not override `pass_identity()` (an
/// invalid-by-construction empty identity), both claim the same pass id, or
/// projection violates its wire-contract postcondition. See
/// [`colorful_ir::from_validated_classification`].
///
/// # Examples
///
/// ```
/// # // public-api-doctest: ir-projection
/// use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
/// use colorful_parse::ProseParser;
/// use colorful_projection::{build_document, ProjectionError};
///
/// fn project() -> Result<(), ProjectionError> {
///     let parser = ProseParser::new();
///     let annotator =
///         ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
///     let analysis = build_document("example.txt", "Dogs run.", &parser, &annotator)?;
///
///     assert_eq!(analysis.document.source.unit_id, "example.txt");
///     assert_eq!(analysis.tokens.len(), analysis.document.tokens.len());
///     Ok(())
/// }
///
/// project()?;
/// # Ok::<(), ProjectionError>(())
/// ```
///
/// See the [IR topic] for contract identity, validation, and consumer behavior.
///
/// [IR topic]: https://github.com/flyingrobots/colorful-language/blob/main/docs/topics/ir/README.md
pub fn build_document<P, A>(
    unit_id: &str,
    source: &str,
    parser: &P,
    annotator: &A,
) -> Result<AnalyzedDocument, ProjectionError>
where
    P: Parser + ?Sized,
    A: Annotator + ?Sized,
{
    let classification = ValidatedClassification::from_ports(source, parser, annotator)
        .map_err(ProjectionError::InvalidClassification)?;
    let document = colorful_ir::from_validated_classification(
        unit_id,
        &classification,
        parser.pass_identity(),
        annotator.pass_identity(),
    )?;
    let (tree, tokens) = classification.into_parts();

    // IR tokens correspond 1:1 by index to core tokens — validated projection's
    // own contract (see the `ir_tokens_correspond_1to1_to_core_tokens` test
    // below). This catches future drift right at the source.
    debug_assert_eq!(
        tokens.len(),
        document.tokens.len(),
        "validated IR projection must emit exactly one IR token per core token"
    );

    Ok(AnalyzedDocument {
        tree,
        tokens,
        document,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use colorful_core::{ClassificationError, PassIdentity};
    use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
    use colorful_parse::ProseParser;

    const SOURCE: &str = "The cat sat on the mat. Paris is nice.\n\nDogs run fast.";

    #[test]
    fn builds_an_analyzed_document_from_real_producers() {
        let parser = ProseParser::new();
        let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
        let analyzed =
            build_document("test", SOURCE, &parser, &annotator).expect("valid projection");

        assert_eq!(analyzed.document.source.unit_id, "test");
        assert!(!analyzed.tokens.is_empty());
        assert_eq!(analyzed.tokens.len(), analyzed.document.tokens.len());
    }

    #[test]
    fn ir_tokens_correspond_1to1_to_core_tokens() {
        let parser = ProseParser::new();
        let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
        let analyzed =
            build_document("test", SOURCE, &parser, &annotator).expect("valid projection");

        assert_eq!(analyzed.tokens.len(), analyzed.document.tokens.len());
        for (core, ir) in analyzed.tokens.iter().zip(analyzed.document.tokens.iter()) {
            assert_eq!(core.span.start as i32, ir.byte_range.start_utf8);
            assert_eq!(core.span.end as i32, ir.byte_range.end_utf8);

            // The IR's flat axes must agree with the same core class every
            // ANSI/LSP role lookup uses (colorful_ir::vocabulary::visual_role).
            let role = colorful_ir::vocabulary::visual_role(
                &ir.token_kind,
                ir.lexical_class.as_ref(),
                ir.open_class_kind.as_ref(),
            );
            let expected_role = colorful_ir::vocabulary::visual_role_for(core.class);
            assert_eq!(role, expected_role);
        }
    }

    #[test]
    fn builds_the_same_document_a_hand_rolled_pipeline_would() {
        // Parity: build_document must not silently diverge from calling
        // parse/annotate/from_classification directly.
        let parser = ProseParser::new();
        let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();

        let tree = parser.parse(SOURCE);
        let tokens = annotator.annotate(SOURCE, &tree);
        let expected = colorful_ir::from_classification(
            "test",
            SOURCE,
            &tree,
            &tokens,
            parser.pass_identity(),
            annotator.pass_identity(),
        )
        .expect("valid projection");

        let analyzed =
            build_document("test", SOURCE, &parser, &annotator).expect("valid projection");
        assert_eq!(
            colorful_ir::canonical_json(&analyzed.document).unwrap(),
            colorful_ir::canonical_json(&expected).unwrap()
        );
    }

    /// A third-party `Parser` that never overrode `pass_identity()` — proves
    /// `build_document` propagates the rejection instead of masking it.
    struct UnidentifiedParser;
    impl Parser for UnidentifiedParser {
        fn parse(&self, text: &str) -> Tree {
            ProseParser::new().parse(text)
        }
    }

    #[test]
    fn propagates_a_missing_pass_identity() {
        let parser = UnidentifiedParser;
        let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
        let err = build_document("test", SOURCE, &parser, &annotator).unwrap_err();
        assert_eq!(err, ProjectionError::MissingPassIdentity { role: "parser" });
    }

    struct OverlappingAnnotator;

    impl Annotator for OverlappingAnnotator {
        fn annotate(&self, source: &str, tree: &Tree) -> Vec<CoreToken> {
            let mut tokens = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default()
                .annotate(source, tree);
            // This also breaks tree/token correspondence; token layout runs
            // before leaf correspondence, so OverlappingSpan wins deterministically.
            tokens[1].span.start = tokens[0].span.end - 1;
            tokens
        }

        fn pass_identity(&self) -> PassIdentity {
            PassIdentity {
                pass_id: "classify",
                rule_id: "overlapping-test-annotator",
            }
        }
    }

    #[test]
    fn propagates_a_custom_annotators_typed_classification_error() {
        let error =
            build_document("test", SOURCE, &ProseParser::new(), &OverlappingAnnotator).unwrap_err();

        assert!(matches!(
            error,
            ProjectionError::InvalidClassification(ClassificationError::OverlappingSpan {
                ref path,
                previous_index: 0,
                ..
            }) if path.to_string() == "tokens[1].span.start"
        ));
    }

    #[test]
    fn does_not_consume_a_reusable_parser_or_annotator() {
        // build_document borrows, so the same instances build a second
        // document — a consuming signature would fail to compile here.
        let parser = ProseParser::new();
        let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
        let first = build_document("a", SOURCE, &parser, &annotator).unwrap();
        let second = build_document("b", SOURCE, &parser, &annotator).unwrap();
        assert_eq!(first.tokens.len(), second.tokens.len());
    }
}
