//! Boundary DTOs for the `colorful.syntax/v1` IR, plus the projection from
//! `colorful-core`'s domain model and a canonical JSON serializer.
//!
//! The types under [`syntax_v1`] / [`vocabulary_v1`] are **Wesley-generated wire
//! boundary** types — never edited by hand and never used in place of
//! `colorful-core`'s ergonomic model. `colorful-core` stays free of generated
//! types; this crate is the one-way bridge.

#![forbid(unsafe_code)]

mod generated;
pub mod vocabulary;

pub use generated::{syntax_v1, vocabulary_v1};

use colorful_core::{Node, PosClass, Span, Token as CoreToken, Tree};
use std::fmt::Write as _;

/// The contract identity this crate produces.
pub const CONTRACT_VERSION: &str = "colorful.syntax/v1";
/// The Wesley version the committed generated types were emitted with.
pub const WESLEY_VERSION: &str = "0.1.1";

const SYNTAX_V1_SDL: &str = include_str!("../contracts/syntax.v1.graphql");

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

/// The hash of the `colorful.vocabulary/v1` **manifest** — the concrete
/// presentation mapping in `contracts/colorful/vocabulary.v1.json`, not merely
/// the `VisualRole` enum SDL. This is what the IR carries as `vocabularyHash`, so
/// the hash certifies presentation behavior: change a color or a role mapping and
/// the hash changes. See [`vocabulary`].
#[must_use]
pub fn vocabulary_hash() -> String {
    vocabulary::hash()
}

/// Compatibility alias for the IR vocabulary hash.
///
/// Earlier Stage 1 code used this name while `vocabularyHash` pointed at the
/// generated vocabulary SDL. The hash now intentionally points at the concrete
/// `colorful.vocabulary/v1` manifest; keep the symbol so downstream callers do
/// not break while they migrate to [`vocabulary_hash`].
#[must_use]
pub fn vocabulary_schema_hash() -> String {
    vocabulary_hash()
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

fn map_open_class_kind(kind: colorful_core::OpenClassKind) -> syntax_v1::OpenClassKind {
    use colorful_core::OpenClassKind as Core;
    use syntax_v1::OpenClassKind as Ir;
    match kind {
        Core::Noun => Ir::Noun,
        Core::Verb => Ir::Verb,
        Core::Adjective => Ir::Adjective,
        Core::Adverb => Ir::Adverb,
    }
}

/// Project a `PosClass` onto the IR's orthogonal axes.
pub(crate) fn token_axes(
    class: PosClass,
) -> (
    syntax_v1::TokenKind,
    Option<syntax_v1::LexicalClass>,
    Option<syntax_v1::FunctionKind>,
    Option<syntax_v1::OpenClassKind>,
) {
    use syntax_v1::{LexicalClass, TokenKind};
    match class {
        PosClass::Function(kind) => (
            TokenKind::Word,
            Some(LexicalClass::Function),
            Some(map_function_kind(kind)),
            None,
        ),
        PosClass::Content => (TokenKind::Word, Some(LexicalClass::Content), None, None),
        PosClass::Open(kind) => (
            TokenKind::Word,
            Some(LexicalClass::Content),
            None,
            Some(map_open_class_kind(kind)),
        ),
        PosClass::ProperNoun => (
            TokenKind::Word,
            Some(LexicalClass::ProperNounCandidate),
            None,
            None,
        ),
        PosClass::Number => (TokenKind::Number, None, None, None),
        PosClass::Punctuation => (TokenKind::Punctuation, None, None, None),
        PosClass::Quote => (TokenKind::Quote, None, None, None),
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
            let (token_kind, lexical_class, function_kind, open_class_kind) =
                token_axes(token.class);
            Ok(syntax_v1::Token {
                occurrence_id: to_i32("token index", i)?,
                byte_range: byte_range(token.span)?,
                token_kind,
                lexical_class,
                function_kind,
                open_class_kind,
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
        vocabulary_hash: vocabulary_hash(),
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

/// One reason a [`syntax_v1::DocumentAnalysis`] failed validation.
///
/// The variants name the broken invariant precisely so a consumer (or the
/// witness) can report exactly which lie it rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    /// `contractVersion` is not the one this build understands.
    UnsupportedContractVersion {
        /// The version the document declared.
        found: String,
    },
    /// `schemaHash` does not match this build's `colorful.syntax/v1` SDL.
    SchemaHashMismatch {
        /// The hash this build expects.
        expected: String,
        /// The hash the document declared.
        found: String,
    },
    /// `vocabularyHash` is not a vocabulary this build recognizes.
    VocabularyHashMismatch {
        /// The hash this build expects.
        expected: String,
        /// The hash the document declared.
        found: String,
    },
    /// `source.contentHash` does not match the supplied source bytes.
    ContentHashMismatch {
        /// The hash of the supplied source.
        expected: String,
        /// The hash the document declared.
        found: String,
    },
    /// `source.utf8ByteLength` does not match the supplied source bytes.
    ByteLengthMismatch {
        /// The declared length.
        declared: i32,
        /// The actual source length.
        actual: usize,
    },
    /// `source.utf8ByteLength` is negative, which no byte length can be. Checked
    /// even without a source, so a nonsensical length never passes silently.
    NegativeByteLength {
        /// The offending declared length.
        value: i32,
    },
    /// The supplied source bytes are not valid UTF-8.
    SourceNotUtf8,
    /// A byte offset was negative.
    NegativeOffset {
        /// Where the offset came from.
        what: String,
        /// The offending value.
        value: i32,
    },
    /// A range's start is past its end.
    RangeOutOfOrder {
        /// Where the range came from.
        what: String,
        /// The start offset.
        start: i32,
        /// The end offset.
        end: i32,
    },
    /// A range extends past the end of the source.
    RangeOutOfBounds {
        /// Where the range came from.
        what: String,
        /// The end offset.
        end: i32,
        /// The source length the range exceeded.
        length: i64,
    },
    /// A range edge does not fall on a UTF-8 character boundary.
    RangeNotOnCharBoundary {
        /// Where the range came from.
        what: String,
        /// The offending offset.
        offset: i32,
    },
    /// A token's `tokenKind` / `lexicalClass` / `functionKind` /
    /// `openClassKind` axes are an illegal combination under the
    /// `colorful.syntax/v1` contract.
    IllegalTokenAxes {
        /// The token's occurrence id.
        occurrence_id: i32,
        /// What is wrong with the combination.
        detail: &'static str,
    },
    /// Two tokens share an `occurrenceId`.
    DuplicateTokenId {
        /// The duplicated id.
        occurrence_id: i32,
    },
    /// Two outline nodes share a `nodeId`.
    DuplicateNodeId {
        /// The duplicated id.
        node_id: i32,
    },
    /// An outline node's `childNodeIds` references a node that does not exist.
    DanglingChildRef {
        /// The parent node.
        node_id: i32,
        /// The missing child id.
        child: i32,
    },
}

/// The non-empty set of reasons a document failed validation. Validation runs
/// every check and collects all failures rather than stopping at the first, so a
/// consumer sees the whole truth about a malformed artifact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationErrors(pub Vec<ValidationError>);

impl core::fmt::Display for ValidationErrors {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "document failed validation ({} issue(s)):", self.0.len())?;
        for error in &self.0 {
            write!(f, "\n  - {error:?}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ValidationErrors {}

/// Validate a received [`syntax_v1::DocumentAnalysis`] against the
/// `colorful.syntax/v1` contract, and — when `source` is supplied — against the
/// exact bytes it claims to describe.
///
/// This is the hostile-consumer guard: a document built by
/// [`from_classification`] always passes, but an artifact received over a
/// boundary may lie. Every check runs; all failures are returned together.
///
/// With `source = None`, structural and self-consistent-hash checks run (schema,
/// vocabulary, contract version, range order/bounds against the declared length,
/// token-axis legality, id uniqueness, child references). With `source =
/// Some(bytes)`, the content hash, byte length, and UTF-8 character boundaries
/// are checked against the real bytes as well.
///
/// **Out of scope:** *inter-token* layout — source ordering, non-overlap, and
/// non-emptiness of token ranges — is a producer guarantee (pinned by
/// `from_classification`'s own tests), not a property of the wire contract, so it
/// is deliberately not enforced on a received artifact. A future contextual
/// re-tagger may legitimately emit a different layout. Per-token range validity
/// (order, bounds, boundaries) *is* checked.
///
/// # Errors
///
/// Returns [`ValidationErrors`] listing every broken invariant if the document
/// is invalid.
pub fn validate_document(
    document: &syntax_v1::DocumentAnalysis,
    source: Option<&[u8]>,
) -> Result<(), ValidationErrors> {
    let mut errors = Vec::new();

    if document.contract_version != CONTRACT_VERSION {
        errors.push(ValidationError::UnsupportedContractVersion {
            found: document.contract_version.clone(),
        });
    }
    let expected_schema = syntax_schema_hash();
    if document.schema_hash != expected_schema {
        errors.push(ValidationError::SchemaHashMismatch {
            expected: expected_schema,
            found: document.schema_hash.clone(),
        });
    }
    let expected_vocab = vocabulary_hash();
    if document.vocabulary_hash != expected_vocab {
        errors.push(ValidationError::VocabularyHashMismatch {
            expected: expected_vocab,
            found: document.vocabulary_hash.clone(),
        });
    }

    // A declared length is meaningful with or without a source; a negative one
    // is never valid and would otherwise be clamped away below.
    if document.source.utf8_byte_length < 0 {
        errors.push(ValidationError::NegativeByteLength {
            value: document.source.utf8_byte_length,
        });
    }

    // Resolve the source text (for hash, length, and char-boundary checks) and
    // the effective length every range is bounded against.
    let source_str = match source {
        Some(bytes) => {
            // The byte length is known regardless of UTF-8 validity, so check the
            // length lie before the decode decision — a hostile artifact must not
            // hide a fabricated `utf8ByteLength` behind non-UTF-8 bytes.
            if document.source.utf8_byte_length as i64 != bytes.len() as i64 {
                errors.push(ValidationError::ByteLengthMismatch {
                    declared: document.source.utf8_byte_length,
                    actual: bytes.len(),
                });
            }
            match std::str::from_utf8(bytes) {
                Ok(text) => {
                    let expected_hash = sha256_hex(bytes);
                    if document.source.content_hash != expected_hash {
                        errors.push(ValidationError::ContentHashMismatch {
                            expected: expected_hash,
                            found: document.source.content_hash.clone(),
                        });
                    }
                    Some(text)
                }
                Err(_) => {
                    errors.push(ValidationError::SourceNotUtf8);
                    None
                }
            }
        }
        None => None,
    };
    let length: i64 = match source {
        Some(bytes) => bytes.len() as i64,
        None => document.source.utf8_byte_length.max(0) as i64,
    };

    let check_range = |what: &str, range: &syntax_v1::ByteRange, errors: &mut Vec<_>| {
        for (edge, value) in [("start", range.start_utf8), ("end", range.end_utf8)] {
            if value < 0 {
                errors.push(ValidationError::NegativeOffset {
                    what: format!("{what} {edge}"),
                    value,
                });
            }
        }
        if range.start_utf8 > range.end_utf8 {
            errors.push(ValidationError::RangeOutOfOrder {
                what: what.to_string(),
                start: range.start_utf8,
                end: range.end_utf8,
            });
        }
        if range.end_utf8 as i64 > length {
            errors.push(ValidationError::RangeOutOfBounds {
                what: what.to_string(),
                end: range.end_utf8,
                length,
            });
        }
        if let Some(text) = source_str {
            for (edge, value) in [("start", range.start_utf8), ("end", range.end_utf8)] {
                if let Ok(offset) = usize::try_from(value) {
                    if offset <= text.len() && !text.is_char_boundary(offset) {
                        errors.push(ValidationError::RangeNotOnCharBoundary {
                            what: format!("{what} {edge}"),
                            offset: value,
                        });
                    }
                }
            }
        }
    };

    // Tokens: each token's own range validity, axis legality, and id uniqueness.
    // Inter-token layout (ordering, non-overlap, non-emptiness) is intentionally
    // *not* checked here — it is a producer guarantee, not a wire invariant (see
    // this function's docs).
    let mut seen_token_ids = std::collections::HashSet::new();
    for token in &document.tokens {
        check_range(
            &format!("token {} range", token.occurrence_id),
            &token.byte_range,
            &mut errors,
        );
        if let Some(detail) = token_axes_violation(token) {
            errors.push(ValidationError::IllegalTokenAxes {
                occurrence_id: token.occurrence_id,
                detail,
            });
        }
        if !seen_token_ids.insert(token.occurrence_id) {
            errors.push(ValidationError::DuplicateTokenId {
                occurrence_id: token.occurrence_id,
            });
        }
    }

    // Structure: ranges, node-id uniqueness, child references.
    let node_ids: std::collections::HashSet<i32> =
        document.structure.iter().map(|n| n.node_id).collect();
    let mut seen_node_ids = std::collections::HashSet::new();
    for node in &document.structure {
        check_range(
            &format!("outline node {} range", node.node_id),
            &node.byte_range,
            &mut errors,
        );
        if !seen_node_ids.insert(node.node_id) {
            errors.push(ValidationError::DuplicateNodeId {
                node_id: node.node_id,
            });
        }
        for child in &node.child_node_ids {
            if !node_ids.contains(child) {
                errors.push(ValidationError::DanglingChildRef {
                    node_id: node.node_id,
                    child: *child,
                });
            }
        }
    }

    // Diagnostics and derivation ranges are part of the artifact too.
    for diagnostic in &document.diagnostics {
        check_range("diagnostic range", &diagnostic.byte_range, &mut errors);
    }
    for step in &document.derivation {
        for range in &step.source_ranges {
            check_range(
                &format!("derivation '{}' range", step.pass_id),
                range,
                &mut errors,
            );
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(ValidationErrors(errors))
    }
}

/// Return why a token's axes are illegal under `colorful.syntax/v1`, or `None`
/// if they are legal. Mirrors the producer mapping in [`token_axes`]: a `WORD`
/// carries a `lexicalClass`; only a `FUNCTION` word carries a `functionKind`;
/// only a `CONTENT` word may carry an `openClassKind`; every other `tokenKind`
/// carries none of those optional axes.
fn token_axes_violation(token: &syntax_v1::Token) -> Option<&'static str> {
    use syntax_v1::{LexicalClass, TokenKind};
    match token.token_kind {
        TokenKind::Word => match token.lexical_class {
            None => Some("a WORD token must carry a lexicalClass"),
            Some(LexicalClass::Function) => {
                if token.function_kind.is_none() {
                    Some("a FUNCTION word must carry a functionKind")
                } else if token.open_class_kind.is_some() {
                    Some("only a CONTENT word may carry an openClassKind")
                } else {
                    None
                }
            }
            Some(LexicalClass::Content) => {
                if token.function_kind.is_some() {
                    Some("only a FUNCTION word may carry a functionKind")
                } else {
                    None
                }
            }
            Some(LexicalClass::ProperNounCandidate) => {
                if token.function_kind.is_some() {
                    Some("only a FUNCTION word may carry a functionKind")
                } else if token.open_class_kind.is_some() {
                    Some("only a CONTENT word may carry an openClassKind")
                } else {
                    None
                }
            }
        },
        TokenKind::Number | TokenKind::Punctuation | TokenKind::Quote => {
            if token.lexical_class.is_some() {
                Some("a non-word token must not carry a lexicalClass")
            } else if token.function_kind.is_some() {
                Some("a non-word token must not carry a functionKind")
            } else if token.open_class_kind.is_some() {
                Some("a non-word token must not carry an openClassKind")
            } else {
                None
            }
        }
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

    #[test]
    fn legacy_vocabulary_schema_hash_alias_matches_manifest_hash() {
        assert_eq!(vocabulary_schema_hash(), vocabulary_hash());
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
            ValidationError::UnsupportedContractVersion { .. }
        )));
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::SchemaHashMismatch { .. }
        )));
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::VocabularyHashMismatch { .. }
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
            ValidationError::ContentHashMismatch { .. }
        )));
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::ByteLengthMismatch { .. }
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
            ValidationError::RangeOutOfOrder { .. }
        )));
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::RangeOutOfBounds { .. }
        )));
    }

    #[test]
    fn rejects_a_negative_offset() {
        let mut doc = analyze(VALID_SOURCE);
        doc.tokens[0].byte_range.start_utf8 = -1;
        let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::NegativeOffset { .. }
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
            ValidationError::RangeNotOnCharBoundary { .. }
        )));
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
            |e| matches!(e, ValidationError::IllegalTokenAxes { .. })
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
            |e| matches!(e, ValidationError::IllegalTokenAxes { .. })
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
            |e| matches!(e, ValidationError::IllegalTokenAxes { .. })
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
            |e| matches!(e, ValidationError::IllegalTokenAxes { .. })
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
            |e| matches!(e, ValidationError::IllegalTokenAxes { .. })
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
            |e| matches!(e, ValidationError::IllegalTokenAxes { .. })
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
    fn rejects_duplicate_ids_and_dangling_child_refs() {
        let mut doc = analyze(VALID_SOURCE);
        // Duplicate a token id.
        let dup = doc.tokens[1].occurrence_id;
        doc.tokens[0].occurrence_id = dup;
        // Point a paragraph at a nonexistent child node.
        let paragraph = doc
            .structure
            .iter_mut()
            .find(|n| n.kind == syntax_v1::OutlineKind::Paragraph)
            .unwrap();
        paragraph.child_node_ids.push(9_999);
        let errors = validate_document(&doc, Some(VALID_SOURCE.as_bytes())).unwrap_err();
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::DuplicateTokenId { .. }
        )));
        assert!(has(&errors, |e| matches!(
            e,
            ValidationError::DanglingChildRef { .. }
        )));
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
    fn negative_declared_byte_length_is_rejected_without_a_source() {
        // Without a source we cannot check the length against real bytes, but a
        // negative declared length is nonsense on its face and must be rejected.
        let mut doc = analyze(VALID_SOURCE);
        doc.source.utf8_byte_length = -1;
        let errors = validate_document(&doc, None).unwrap_err();
        assert!(
            has(&errors, |e| matches!(
                e,
                ValidationError::NegativeByteLength { .. }
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
            has(&errors, |e| matches!(e, ValidationError::SourceNotUtf8)),
            "{errors:?}"
        );
        assert!(
            has(&errors, |e| matches!(
                e,
                ValidationError::ByteLengthMismatch { .. }
            )),
            "{errors:?}"
        );
    }
}
