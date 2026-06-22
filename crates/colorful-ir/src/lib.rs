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

fn byte_range(span: Span) -> syntax_v1::ByteRange {
    syntax_v1::ByteRange {
        start_utf8: span.start as i32,
        end_utf8: span.end as i32,
    }
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
fn build_structure(source: &str, tree: &Tree) -> Vec<syntax_v1::OutlineNode> {
    let Node::Document(sentences) = &tree.root else {
        return Vec::new();
    };
    let spans: Vec<Span> = sentences
        .iter()
        .filter_map(|node| match node {
            Node::Sentence { span, .. } => Some(*span),
            _ => None,
        })
        .collect();
    if spans.is_empty() {
        return Vec::new();
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
    let sentence_id = |s: usize| (paragraph_count + s) as i32;
    let mut nodes = Vec::with_capacity(paragraph_count + spans.len());

    for (p, sentence_idxs) in paragraphs.iter().enumerate() {
        let first = spans[sentence_idxs[0]];
        let last = spans[sentence_idxs[sentence_idxs.len() - 1]];
        nodes.push(syntax_v1::OutlineNode {
            node_id: p as i32,
            kind: syntax_v1::OutlineKind::Paragraph,
            byte_range: syntax_v1::ByteRange {
                start_utf8: first.start as i32,
                end_utf8: last.end as i32,
            },
            depth: 0,
            child_node_ids: sentence_idxs.iter().map(|s| sentence_id(*s)).collect(),
        });
    }
    for (s, span) in spans.iter().enumerate() {
        nodes.push(syntax_v1::OutlineNode {
            node_id: sentence_id(s),
            kind: syntax_v1::OutlineKind::Sentence,
            byte_range: byte_range(*span),
            depth: 1,
            child_node_ids: Vec::new(),
        });
    }
    nodes
}

/// Project a `colorful-core` classification into a `DocumentAnalysis` DTO.
#[must_use]
pub fn from_classification(
    unit_id: &str,
    source: &str,
    tree: &Tree,
    tokens: &[CoreToken],
) -> syntax_v1::DocumentAnalysis {
    let ir_tokens = tokens
        .iter()
        .enumerate()
        .map(|(i, token)| {
            let (token_kind, lexical_class, function_kind) = token_axes(token.class);
            syntax_v1::Token {
                occurrence_id: i as i32,
                byte_range: byte_range(token.span),
                token_kind,
                lexical_class,
                function_kind,
            }
        })
        .collect();

    let whole = syntax_v1::ByteRange {
        start_utf8: 0,
        end_utf8: source.len() as i32,
    };
    let step = |pass: &str, rule: &str| syntax_v1::DerivationStep {
        pass_id: pass.to_string(),
        rule_id: rule.to_string(),
        source_ranges: vec![whole.clone()],
        compiler_build_hash: build_hash(),
    };

    syntax_v1::DocumentAnalysis {
        contract_version: CONTRACT_VERSION.to_string(),
        schema_hash: syntax_schema_hash(),
        vocabulary_hash: vocabulary_schema_hash(),
        source: syntax_v1::SourceArtifact {
            unit_id: unit_id.to_string(),
            content_hash: sha256_hex(source.as_bytes()),
            utf8_byte_length: source.len() as i32,
        },
        tokens: ir_tokens,
        structure: build_structure(source, tree),
        diagnostics: Vec::new(),
        derivation: vec![
            step("segment", "prose-segmenter"),
            step("classify", "lexical-annotator"),
        ],
    }
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
