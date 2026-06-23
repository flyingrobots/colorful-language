//! Boundary DTOs for the `colorful.syntax/v1` IR, plus the projection from
//! `colorful-core`'s domain model and a canonical JSON serializer.
//!
//! The types under [`syntax_v1`] / [`vocabulary_v1`] are **Wesley-generated wire
//! boundary** types — never edited by hand and never used in place of
//! `colorful-core`'s ergonomic model. `colorful-core` stays free of generated
//! types; this crate is the one-way bridge.

#![forbid(unsafe_code)]

mod generated;

pub use generated::{syntax_v1, vocabulary_v1};

use colorful_core::{Node, PosClass, Span, Token as CoreToken, Tree};
use std::fmt::Write as _;

/// The contract identity this crate produces.
pub const CONTRACT_VERSION: &str = "colorful.syntax/v1";
/// The Wesley version the committed generated types were emitted with.
pub const WESLEY_VERSION: &str = "0.0.5";

const SYNTAX_V1_SDL: &str = include_str!("../../../contracts/colorful/syntax.v1.graphql");
const VOCABULARY_V1_SDL: &str = include_str!("../../../contracts/colorful/vocabulary.v1.graphql");

/// Canonical JSON: compact, with object keys sorted lexicographically. Both the
/// Rust and TS sides use this exact form so a round-trip is byte-for-byte.
///
/// # Errors
/// Returns an error if `value` cannot be serialized.
pub fn canonical_json<T: serde::Serialize>(value: &T) -> Result<String, serde_json::Error> {
    // `serde_json::Value`'s object map is a BTreeMap (sorted keys) unless the
    // `preserve_order` feature is on, and `Display` is compact.
    Ok(serde_json::to_value(value)?.to_string())
}

/// `sha256:<hex>` of `bytes`.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    format!("sha256:{hex}")
}

/// The hash of the `colorful.syntax/v1` contract these types implement.
#[must_use]
pub fn syntax_schema_hash() -> String {
    sha256_hex(SYNTAX_V1_SDL.as_bytes())
}

/// The hash of the `colorful.vocabulary/v1` contract.
#[must_use]
pub fn vocabulary_schema_hash() -> String {
    sha256_hex(VOCABULARY_V1_SDL.as_bytes())
}

fn build_hash() -> String {
    // A stand-in identity for Stage 1; a real reproducible build hash comes later.
    format!("colorful-ir@{}", env!("CARGO_PKG_VERSION"))
}

/// An error projecting a `colorful-core` classification into the IR.
///
/// The `colorful.syntax/v1` contract carries offsets, lengths, and ids as
/// GraphQL `Int` (Rust `i32`, ~2 GB). Projection **rejects** an input whose
/// offsets or counts exceed that wire range instead of silently wrapping them
/// negative — "bounded to ~2 GB" is only true if oversized input is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectionError {
    /// A byte offset, length, or id did not fit the IR's `i32` wire range.
    Overflow {
        /// What was being converted (e.g. `"source length"`, `"token index"`).
        what: &'static str,
        /// The value that overflowed.
        value: usize,
    },
}

impl core::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            ProjectionError::Overflow { what, value } => write!(
                f,
                "{what} ({value}) exceeds the colorful.syntax/v1 i32 range; \
                 the document is too large to project"
            ),
        }
    }
}

impl std::error::Error for ProjectionError {}

/// Narrow a `usize` offset, length, or id to the IR's `i32`, or fail loudly.
fn to_i32(what: &'static str, value: usize) -> Result<i32, ProjectionError> {
    i32::try_from(value).map_err(|_| ProjectionError::Overflow { what, value })
}

fn byte_range(span: Span) -> Result<syntax_v1::ByteRange, ProjectionError> {
    Ok(syntax_v1::ByteRange {
        start_utf8: to_i32("byte range start", span.start)?,
        end_utf8: to_i32("byte range end", span.end)?,
    })
}

fn map_function_kind(kind: colorful_core::FunctionKind) -> syntax_v1::FunctionKind {
    use colorful_core::FunctionKind as Core;
    use syntax_v1::FunctionKind as Ir;
    match kind {
        Core::Article => Ir::Article,
        Core::Preposition => Ir::Preposition,
        Core::Conjunction => Ir::Conjunction,
        Core::Pronoun => Ir::Pronoun,
        Core::Auxiliary => Ir::Auxiliary,
        Core::Determiner => Ir::Determiner,
        Core::Negator => Ir::Negator,
    }
}

/// Project a `PosClass` onto the IR's orthogonal axes.
fn token_axes(
    class: PosClass,
) -> (
    syntax_v1::TokenKind,
    Option<syntax_v1::LexicalClass>,
    Option<syntax_v1::FunctionKind>,
) {
    use syntax_v1::{LexicalClass, TokenKind};
    match class {
        PosClass::Function(kind) => (
            TokenKind::Word,
            Some(LexicalClass::Function),
            Some(map_function_kind(kind)),
        ),
        PosClass::Content => (TokenKind::Word, Some(LexicalClass::Content), None),
        PosClass::ProperNoun => (
            TokenKind::Word,
            Some(LexicalClass::ProperNounCandidate),
            None,
        ),
        PosClass::Number => (TokenKind::Number, None, None),
        PosClass::Punctuation => (TokenKind::Punctuation, None, None),
        PosClass::Quote => (TokenKind::Quote, None, None),
    }
}

/// Build the outline: a flattened paragraph → sentence tree. Paragraphs are
/// separated by a blank line (a gap containing two or more newlines).
fn build_structure(
    source: &str,
    tree: &Tree,
) -> Result<Vec<syntax_v1::OutlineNode>, ProjectionError> {
    let Node::Document(sentences) = &tree.root else {
        return Ok(Vec::new());
    };
    let spans: Vec<Span> = sentences
        .iter()
        .filter_map(|node| match node {
            Node::Sentence { span, .. } => Some(*span),
            _ => None,
        })
        .collect();
    if spans.is_empty() {
        return Ok(Vec::new());
    }

    // Group sentence indices into paragraphs.
    let mut paragraphs: Vec<Vec<usize>> = vec![vec![0]];
    for i in 1..spans.len() {
        let gap = source.get(spans[i - 1].end..spans[i].start).unwrap_or("");
        if gap.matches('\n').count() >= 2 {
            paragraphs.push(vec![i]);
        } else if let Some(last) = paragraphs.last_mut() {
            last.push(i);
        }
    }

    let paragraph_count = paragraphs.len();
    // Sentence node ids follow the paragraph ids, so they never collide.
    let sentence_id = |s: usize| to_i32("sentence id", paragraph_count + s);
    let mut nodes = Vec::with_capacity(paragraph_count + spans.len());

    for (p, sentence_idxs) in paragraphs.iter().enumerate() {
        let first = spans[sentence_idxs[0]];
        let last = spans[sentence_idxs[sentence_idxs.len() - 1]];
        nodes.push(syntax_v1::OutlineNode {
            node_id: to_i32("paragraph id", p)?,
            kind: syntax_v1::OutlineKind::Paragraph,
            byte_range: byte_range(Span::new(first.start, last.end))?,
            depth: 0,
            child_node_ids: sentence_idxs
                .iter()
                .map(|s| sentence_id(*s))
                .collect::<Result<Vec<_>, _>>()?,
        });
    }
    for (s, span) in spans.iter().enumerate() {
        nodes.push(syntax_v1::OutlineNode {
            node_id: sentence_id(s)?,
            kind: syntax_v1::OutlineKind::Sentence,
            byte_range: byte_range(*span)?,
            depth: 1,
            child_node_ids: Vec::new(),
        });
    }
    Ok(nodes)
}

/// Project a `colorful-core` classification into a `DocumentAnalysis` DTO.
///
/// # Errors
///
/// Returns [`ProjectionError::Overflow`] if a byte offset, the source length, a
/// token index, or an outline id exceeds the IR's `i32` wire range (~2 GB).
pub fn from_classification(
    unit_id: &str,
    source: &str,
    tree: &Tree,
    tokens: &[CoreToken],
) -> Result<syntax_v1::DocumentAnalysis, ProjectionError> {
    let ir_tokens = tokens
        .iter()
        .enumerate()
        .map(|(i, token)| {
            let (token_kind, lexical_class, function_kind) = token_axes(token.class);
            Ok(syntax_v1::Token {
                occurrence_id: to_i32("token index", i)?,
                byte_range: byte_range(token.span)?,
                token_kind,
                lexical_class,
                function_kind,
            })
        })
        .collect::<Result<Vec<_>, ProjectionError>>()?;

    let whole = syntax_v1::ByteRange {
        start_utf8: 0,
        end_utf8: to_i32("source length", source.len())?,
    };
    let step = |pass: &str, rule: &str| syntax_v1::DerivationStep {
        pass_id: pass.to_string(),
        rule_id: rule.to_string(),
        source_ranges: vec![whole.clone()],
        compiler_build_hash: build_hash(),
    };

    Ok(syntax_v1::DocumentAnalysis {
        contract_version: CONTRACT_VERSION.to_string(),
        schema_hash: syntax_schema_hash(),
        vocabulary_hash: vocabulary_schema_hash(),
        source: syntax_v1::SourceArtifact {
            unit_id: unit_id.to_string(),
            content_hash: sha256_hex(source.as_bytes()),
            utf8_byte_length: to_i32("source length", source.len())?,
        },
        tokens: ir_tokens,
        structure: build_structure(source, tree)?,
        diagnostics: Vec::new(),
        derivation: vec![
            step("segment", "prose-segmenter"),
            step("classify", "lexical-annotator"),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_sorts_keys_and_is_compact() {
        let range = syntax_v1::ByteRange {
            start_utf8: 1,
            end_utf8: 4,
        };
        // Keys sorted lexicographically ("endUtf8" < "startUtf8"), no spaces.
        assert_eq!(
            canonical_json(&range).unwrap(),
            r#"{"endUtf8":4,"startUtf8":1}"#
        );
    }

    #[test]
    fn round_trips_in_rust() {
        let range = syntax_v1::ByteRange {
            start_utf8: 2,
            end_utf8: 9,
        };
        let a = canonical_json(&range).unwrap();
        let decoded: syntax_v1::ByteRange = serde_json::from_str(&a).unwrap();
        let c = canonical_json(&decoded).unwrap();
        assert_eq!(a, c);
    }

    #[test]
    fn schema_hash_is_stable_and_prefixed() {
        let hash = syntax_schema_hash();
        assert!(hash.starts_with("sha256:"));
        assert_eq!(hash, syntax_schema_hash());
    }
}

#[cfg(test)]
mod integration {
    use super::*;
    use colorful_core::{Annotator, LexicalAnnotator, Parser};
    use colorful_lexicon::ClosedClassLexicon;
    use colorful_parse::ProseParser;
    use std::collections::HashMap;

    fn analyze(source: &str) -> syntax_v1::DocumentAnalysis {
        let tree = ProseParser::new().parse(source);
        let tokens = LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(source, &tree);
        from_classification("test", source, &tree, &tokens).expect("projection within i32 range")
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

    #[test]
    fn document_analysis_holds_the_invariants() {
        let source = "The cat sat on the mat. Paris is nice.\n\nDogs run fast.";
        let doc = analyze(source);
        let len = i32::try_from(source.len()).unwrap();

        // Source digest + length.
        assert_eq!(doc.source.content_hash, sha256_hex(source.as_bytes()));
        assert_eq!(doc.source.utf8_byte_length, len);
        assert_eq!(doc.contract_version, CONTRACT_VERSION);

        // Tokens: ordered, in-bounds, non-overlapping, on char boundaries
        // (slicing would panic otherwise), non-empty.
        let mut prev_end = 0;
        for token in &doc.tokens {
            let (start, end) = (token.byte_range.start_utf8, token.byte_range.end_utf8);
            assert!(start <= end && end <= len, "out of bounds");
            assert!(start >= prev_end, "overlapping tokens");
            let text = &source[start as usize..end as usize];
            assert!(!text.is_empty());
            prev_end = end;
        }

        // Structure: every node's range contains each child's range.
        let by_id: HashMap<i32, &syntax_v1::OutlineNode> =
            doc.structure.iter().map(|n| (n.node_id, n)).collect();
        for node in &doc.structure {
            for child_id in &node.child_node_ids {
                let child = by_id[child_id];
                assert!(node.byte_range.start_utf8 <= child.byte_range.start_utf8);
                assert!(child.byte_range.end_utf8 <= node.byte_range.end_utf8);
            }
        }

        // Canonical JSON decodes back and re-encodes identically (Rust round-trip).
        let a = canonical_json(&doc).unwrap();
        let decoded: syntax_v1::DocumentAnalysis = serde_json::from_str(&a).unwrap();
        assert_eq!(a, canonical_json(&decoded).unwrap());
    }
}
