use crate::hashing::build_hash;
use crate::{
    sha256_hex, syntax_schema_hash, syntax_v1, validate_document, vocabulary_hash,
    ValidationErrors, CONTRACT_VERSION,
};
use colorful_core::{
    validate_classification, ClassificationError, Node, PassIdentity, PosClass, Span,
    Token as CoreToken, Tree, ValidatedClassification,
};

/// An error projecting a `colorful-core` classification into the IR.
///
/// The `colorful.syntax/v1` contract carries offsets, lengths, and ids as
/// GraphQL `Int` (Rust `i32`, ~2 GB). Projection **rejects** an input whose
/// offsets or counts exceed that wire range instead of silently wrapping them
/// negative — "bounded to ~2 GB" is only true if oversized input is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectionError {
    /// Public parser/annotator output failed the core validation boundary.
    InvalidClassification(ClassificationError),
    /// A byte offset, length, or id did not fit the IR's `i32` wire range.
    Overflow {
        /// What was being converted (e.g. `"source length"`, `"token index"`).
        what: &'static str,
        /// The value that overflowed.
        value: usize,
    },
    /// A parser or annotator did not override
    /// [`pass_identity`](colorful_core::Parser::pass_identity), so its identity
    /// is the invalid-by-construction empty default.
    MissingPassIdentity {
        /// Which producer role was missing an identity: `"parser"` or
        /// `"annotator"`.
        role: &'static str,
    },
    /// The parser and annotator both claimed the same `passId`.
    DuplicatePassId {
        /// The pass id both roles claimed.
        pass_id: &'static str,
    },
    /// Projection produced a document that failed its own wire validator.
    ///
    /// This is an internal-contract failure, not a malformed received
    /// artifact: successful projection never returns such a document.
    InvalidProjectedDocument(ValidationErrors),
}

impl core::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            ProjectionError::InvalidClassification(error) => {
                write!(f, "invalid parser/annotator classification: {error}")
            }
            ProjectionError::Overflow { what, value } => write!(
                f,
                "{what} ({value}) exceeds the colorful.syntax/v1 i32 range; \
                 the document is too large to project"
            ),
            ProjectionError::MissingPassIdentity { role } => write!(
                f,
                "the {role} did not override `pass_identity()`; its derivation \
                 identity would be indistinguishable from no identity at all"
            ),
            ProjectionError::DuplicatePassId { pass_id } => write!(
                f,
                "the parser and annotator both claimed pass id `{pass_id}`; \
                 each derivation step must be uniquely identifiable"
            ),
            ProjectionError::InvalidProjectedDocument(errors) => {
                write!(f, "projected document violated its contract: {errors}")
            }
        }
    }
}

impl std::error::Error for ProjectionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidClassification(error) => Some(error),
            Self::InvalidProjectedDocument(errors) => Some(errors),
            Self::Overflow { .. }
            | Self::MissingPassIdentity { .. }
            | Self::DuplicatePassId { .. } => None,
        }
    }
}

impl From<ClassificationError> for ProjectionError {
    fn from(error: ClassificationError) -> Self {
        Self::InvalidClassification(error)
    }
}

/// Narrow a `usize` offset, length, or id to the IR's `i32`, or fail loudly.
pub(crate) fn to_i32(what: &'static str, value: usize) -> Result<i32, ProjectionError> {
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

/// Count logical line breaks in `text`: `\n`, `\r`, and `\r\n` each count as
/// exactly one break — a `\r\n` pair is not double-counted as two — and
/// repeated sequences count individually (`"\n\n"` is two, `"\r\n\r\n"` is
/// two).
pub(crate) fn logical_line_break_count(text: &str) -> usize {
    let mut count = 0;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                count += 1;
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
            }
            '\n' => count += 1,
            _ => {}
        }
    }
    count
}

/// Whether `gap` (the source between two adjacent sentences) is a paragraph
/// boundary: at least two logical line breaks with only whitespace between
/// them, i.e. a genuine blank line rather than a single line wrap.
pub(crate) fn is_paragraph_break(gap: &str) -> bool {
    logical_line_break_count(gap) >= 2 && gap.chars().all(char::is_whitespace)
}

/// Build the outline: a flattened paragraph → sentence tree. Paragraphs are
/// separated by a blank line (a gap containing at least two logical line
/// breaks — `\n`, `\r`, or `\r\n` — with nothing but whitespace between them).
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
        if is_paragraph_break(gap) {
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
/// `parser_identity` and `annotator_identity` are the [`PassIdentity`] each
/// producer reports via `pass_identity()` — pass them in rather than having
/// this function assume any particular parser or annotator, so a caller using
/// a different pair still gets an honest derivation identity (a trace seed,
/// not replayable provenance — see the `derivation` field's contract
/// description).
///
/// # Errors
///
/// Returns [`ProjectionError::InvalidClassification`] if the borrowed public
/// tree/token values do not form a valid classification of `source`.
/// Returns [`ProjectionError::Overflow`] if a byte offset, the source length, a
/// token index, or an outline id exceeds the IR's `i32` wire range (~2 GB).
/// Returns [`ProjectionError::MissingPassIdentity`] if either identity is the
/// invalid-by-construction default (an implementation that never overrode
/// `pass_identity()`), and [`ProjectionError::DuplicatePassId`] if both
/// identities claim the same pass id.
pub fn from_classification(
    unit_id: &str,
    source: &str,
    tree: &Tree,
    tokens: &[CoreToken],
    parser_identity: PassIdentity,
    annotator_identity: PassIdentity,
) -> Result<syntax_v1::DocumentAnalysis, ProjectionError> {
    validate_classification(source, tree, tokens)?;
    project_classification(
        unit_id,
        source,
        tree,
        tokens,
        parser_identity,
        annotator_identity,
    )
}

/// Project a source-bound [`ValidatedClassification`] into the IR.
///
/// This aggregate-native entry point avoids repeating validation when a
/// producer already crossed the core boundary. The compatibility
/// [`from_classification`] wrapper validates borrowed raw values, then enters
/// the same private projection path.
///
/// # Errors
///
/// Returns [`ProjectionError`] if producer identities are missing or
/// duplicated, an IR integer would overflow, or the projected document fails
/// its mandatory [`validate_document`] postcondition.
pub fn from_validated_classification(
    unit_id: &str,
    classification: &ValidatedClassification<'_>,
    parser_identity: PassIdentity,
    annotator_identity: PassIdentity,
) -> Result<syntax_v1::DocumentAnalysis, ProjectionError> {
    project_classification(
        unit_id,
        classification.source(),
        classification.tree(),
        classification.tokens(),
        parser_identity,
        annotator_identity,
    )
}

fn project_classification(
    unit_id: &str,
    source: &str,
    tree: &Tree,
    tokens: &[CoreToken],
    parser_identity: PassIdentity,
    annotator_identity: PassIdentity,
) -> Result<syntax_v1::DocumentAnalysis, ProjectionError> {
    if !parser_identity.is_present() {
        return Err(ProjectionError::MissingPassIdentity { role: "parser" });
    }
    if !annotator_identity.is_present() {
        return Err(ProjectionError::MissingPassIdentity { role: "annotator" });
    }
    if parser_identity.pass_id == annotator_identity.pass_id {
        return Err(ProjectionError::DuplicatePassId {
            pass_id: parser_identity.pass_id,
        });
    }

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
    let step = |identity: PassIdentity| syntax_v1::DerivationStep {
        pass_id: identity.pass_id.to_string(),
        rule_id: identity.rule_id.to_string(),
        source_ranges: vec![whole.clone()],
        compiler_build_hash: build_hash(),
    };

    let document = syntax_v1::DocumentAnalysis {
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
        derivation: vec![step(parser_identity), step(annotator_identity)],
    };
    validate_document(&document, Some(source.as_bytes()))
        .map_err(ProjectionError::InvalidProjectedDocument)?;
    Ok(document)
}
