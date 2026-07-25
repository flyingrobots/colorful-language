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

use colorful_core::{Node, PassIdentity, PosClass, Span, Token as CoreToken, Tree};
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

/// Strip GraphQL description strings from `sdl` before hashing, so a
/// documentation-only description edit does not change `schemaHash` --
/// only real shape (types, fields, enum values) does. This crate's
/// contracts only ever use a single-line `"..."` description immediately
/// preceding a type or enum, never a `"""..."""` block string or a
/// field-level description, so a per-line check (a line that, once
/// trimmed, is nothing but a quoted string) is sufficient; extend this if
/// that ever changes.
fn strip_graphql_descriptions(sdl: &str) -> String {
    sdl.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The hash of the `colorful.syntax/v1` contract these types implement.
///
/// Normalized against description-only edits (see
/// [`strip_graphql_descriptions`]): a `DerivationStep` description fix, for
/// example, does not bump this hash. A real shape change -- a new field, a
/// renamed type, a new enum value -- still does.
#[must_use]
pub fn syntax_schema_hash() -> String {
    sha256_hex(strip_graphql_descriptions(SYNTAX_V1_SDL).as_bytes())
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
}

impl core::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
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

/// Count logical line breaks in `text`: `\n`, `\r`, and `\r\n` each count as
/// exactly one break — a `\r\n` pair is not double-counted as two — and
/// repeated sequences count individually (`"\n\n"` is two, `"\r\n\r\n"` is
/// two).
fn logical_line_break_count(text: &str) -> usize {
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
fn is_paragraph_break(gap: &str) -> bool {
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
        derivation: vec![step(parser_identity), step(annotator_identity)],
    })
}

/// One segment of a [`Path`]: a named field, or an index into a list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathSegment {
    /// A field access, e.g. `.byteRange`.
    Field(&'static str),
    /// A list index, e.g. `[3]`.
    Index(usize),
}

/// A field path into a [`syntax_v1::DocumentAnalysis`], identifying exactly
/// where a [`ValidationError`] found a broken invariant — e.g.
/// `tokens[3].byteRange.startUtf8` — so a consumer can locate the failure by
/// following field names, not by parsing prose. Field names match the wire
/// (camelCase) names, since a `Path` is meant to be read against the JSON a
/// consumer actually received.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Path(Vec<PathSegment>);

impl Path {
    /// The empty path — the document itself.
    #[must_use]
    pub fn root() -> Self {
        Self(Vec::new())
    }

    /// Append a field access.
    #[must_use]
    pub fn field(mut self, name: &'static str) -> Self {
        self.0.push(PathSegment::Field(name));
        self
    }

    /// Append a list index.
    #[must_use]
    pub fn index(mut self, i: usize) -> Self {
        self.0.push(PathSegment::Index(i));
        self
    }

    /// The path's segments, in order from the root.
    #[must_use]
    pub fn segments(&self) -> &[PathSegment] {
        &self.0
    }
}

impl core::fmt::Display for Path {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for (i, segment) in self.0.iter().enumerate() {
            match segment {
                PathSegment::Field(name) => {
                    if i > 0 {
                        write!(f, ".")?;
                    }
                    write!(f, "{name}")?;
                }
                PathSegment::Index(index) => write!(f, "[{index}]")?,
            }
        }
        Ok(())
    }
}

macro_rules! define_validation_errors {
    (
        $(#[$enum_meta:meta])*
        pub enum $name:ident {
            $(
                $(#[$variant_meta:meta])*
                $variant:ident {
                    $(#[$path_meta:meta])*
                    $path:ident: Path,
                    $(
                        $(#[$field_meta:meta])*
                        $field:ident: $field_ty:ty,
                    )*
                } => |$formatter:ident| $display:block
            ),+ $(,)?
        }
    ) => {
        $(#[$enum_meta])*
        #[derive(Debug, Clone, PartialEq, Eq)]
        pub enum $name {
            $(
                $(#[$variant_meta])*
                $variant {
                    $(#[$path_meta])*
                    $path: Path,
                    $(
                        $(#[$field_meta])*
                        $field: $field_ty,
                    )*
                },
            )+
        }

        impl $name {
            /// The path this error points at.
            #[must_use]
            pub fn path(&self) -> &Path {
                match self {
                    $(Self::$variant { $path, .. } => $path,)+
                }
            }

            /// The stable process-facing category for this validation failure.
            ///
            /// Codes are the Rust variant names so logs and witness processes
            /// can assert a rejection reason without parsing
            /// [`core::fmt::Display`] prose.
            #[must_use]
            pub fn code(&self) -> &'static str {
                match self {
                    $(Self::$variant { .. } => stringify!($variant),)+
                }
            }

            #[cfg(test)]
            const VARIANT_NAMES: &'static [&'static str] = &[
                $(stringify!($variant),)+
            ];
        }

        impl core::fmt::Display for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                match self {
                    $(
                        Self::$variant {
                            $path,
                            $($field,)*
                        } => {
                            let $formatter = f;
                            $(let _ = $field;)*
                            $display
                        }
                    )+
                }
            }
        }
    };
}

define_validation_errors! {
    /// One reason a [`syntax_v1::DocumentAnalysis`] failed validation.
    ///
    /// The variants name the broken invariant precisely so a consumer (or the
    /// witness) can report exactly which lie it rejected. Every variant carries a
    /// [`Path`] pointing at exactly where in the document the invariant broke.
    pub enum ValidationError {
        /// `contractVersion` is not the one this build understands.
        UnsupportedContractVersion {
            /// Always `contractVersion`.
            path: Path,
            /// The version the document declared.
            found: String,
        } => |f| {
            let found = escape_untrusted(found);
            write!(f, "at {path}: unsupported contract version `{found}`")
        },
        /// `schemaHash` does not match this build's `colorful.syntax/v1` SDL.
        SchemaHashMismatch {
            /// Always `schemaHash`.
            path: Path,
            /// The hash this build expects.
            expected: String,
            /// The hash the document declared.
            found: String,
        } => |f| {
            let found = escape_untrusted(found);
            write!(f, "at {path}: expected `{expected}`, found `{found}`")
        },
        /// `vocabularyHash` is not a vocabulary this build recognizes.
        VocabularyHashMismatch {
            /// Always `vocabularyHash`.
            path: Path,
            /// The hash this build expects.
            expected: String,
            /// The hash the document declared.
            found: String,
        } => |f| {
            let found = escape_untrusted(found);
            write!(f, "at {path}: expected `{expected}`, found `{found}`")
        },
        /// `source.contentHash` does not match the supplied source bytes.
        ContentHashMismatch {
            /// Always `source.contentHash`.
            path: Path,
            /// The hash of the supplied source.
            expected: String,
            /// The hash the document declared.
            found: String,
        } => |f| {
            let found = escape_untrusted(found);
            write!(f, "at {path}: expected `{expected}`, found `{found}`")
        },
        /// `source.utf8ByteLength` does not match the supplied source bytes.
        ByteLengthMismatch {
            /// Always `source.utf8ByteLength`.
            path: Path,
            /// The declared length.
            declared: i32,
            /// The actual source length.
            actual: usize,
        } => |f| {
            write!(f, "at {path}: declared {declared}, actual {actual}")
        },
        /// `source.utf8ByteLength` is negative, which no byte length can be.
        /// Checked even without a source, so a nonsensical length never passes
        /// silently.
        NegativeByteLength {
            /// Always `source.utf8ByteLength`.
            path: Path,
            /// The offending declared length.
            value: i32,
        } => |f| {
            write!(f, "at {path}: {value} is negative")
        },
        /// The supplied source bytes are not valid UTF-8.
        SourceNotUtf8 {
            /// Always `source`.
            path: Path,
        } => |f| {
            write!(f, "at {path}: not valid UTF-8")
        },
        /// A byte offset was negative.
        NegativeOffset {
            /// The offending `startUtf8`/`endUtf8` field.
            path: Path,
            /// The offending value.
            value: i32,
        } => |f| {
            write!(f, "at {path}: {value} is negative")
        },
        /// A range's start is past its end.
        RangeOutOfOrder {
            /// The `byteRange` whose start exceeds its end.
            path: Path,
            /// The start offset.
            start: i32,
            /// The end offset.
            end: i32,
        } => |f| {
            write!(f, "at {path}: start {start} exceeds end {end}")
        },
        /// A range extends past the end of the source.
        RangeOutOfBounds {
            /// The offending `endUtf8` field.
            path: Path,
            /// The end offset.
            end: i32,
            /// The source length the range exceeded.
            length: i64,
        } => |f| {
            write!(f, "at {path}: {end} exceeds source length {length}")
        },
        /// A range edge does not fall on a UTF-8 character boundary.
        RangeNotOnCharBoundary {
            /// The offending `startUtf8`/`endUtf8` field.
            path: Path,
            /// The offending offset.
            offset: i32,
        } => |f| {
            write!(f, "at {path}: {offset} is not a UTF-8 character boundary")
        },
        /// A token range contains no source bytes.
        EmptyTokenRange {
            /// The offending `tokens[i].byteRange`.
            path: Path,
            /// The token's occurrence id.
            occurrence_id: i32,
        } => |f| {
            write!(f, "at {path}: token {occurrence_id} has an empty range")
        },
        /// A token starts before the preceding token starts.
        UnsortedTokenRange {
            /// The offending `tokens[i].byteRange.startUtf8`.
            path: Path,
            /// The preceding token's array index.
            previous_index: usize,
            /// The preceding token's start offset.
            previous_start: i32,
            /// The offending token's start offset.
            start: i32,
        } => |f| {
            write!(
                f,
                "at {path}: start {start} precedes tokens[{previous_index}] start {previous_start}"
            )
        },
        /// A token starts before the preceding token ends.
        OverlappingTokenRange {
            /// The offending `tokens[i].byteRange.startUtf8`.
            path: Path,
            /// The preceding token's array index.
            previous_index: usize,
            /// The preceding token's end offset.
            previous_end: i32,
            /// The offending token's start offset.
            start: i32,
        } => |f| {
            write!(
                f,
                "at {path}: start {start} overlaps tokens[{previous_index}] ending at {previous_end}"
            )
        },
        /// A token's `tokenKind` / `lexicalClass` / `functionKind` /
        /// `openClassKind` axes are an illegal combination under the
        /// `colorful.syntax/v1` contract.
        IllegalTokenAxes {
            /// The offending `tokens[i]`.
            path: Path,
            /// The token's occurrence id.
            occurrence_id: i32,
            /// What is wrong with the combination.
            detail: &'static str,
        } => |f| {
            write!(f, "at {path}: {detail}")
        },
        /// Two tokens share an `occurrenceId`.
        DuplicateTokenId {
            /// The `tokens[i]` where the duplicate was found.
            path: Path,
            /// The duplicated id.
            occurrence_id: i32,
        } => |f| {
            write!(f, "at {path}: duplicate occurrenceId {occurrence_id}")
        },
        /// Two outline nodes share a `nodeId`.
        DuplicateNodeId {
            /// The `structure[i]` where the duplicate was found.
            path: Path,
            /// The duplicated id.
            node_id: i32,
        } => |f| {
            write!(f, "at {path}: duplicate nodeId {node_id}")
        },
        /// An outline node's `childNodeIds` references a node that does not
        /// exist.
        DanglingChildRef {
            /// The offending `structure[i].childNodeIds[j]`.
            path: Path,
            /// The missing child id.
            child: i32,
        } => |f| {
            write!(f, "at {path}: references missing child {child}")
        },
        /// An outline kind carries a depth other than the one defined by the
        /// wire contract.
        InvalidOutlineDepth {
            /// The offending `structure[i].depth`.
            path: Path,
            /// The depth the document declared.
            depth: i32,
            /// The depth required for the node's kind.
            expected: i32,
        } => |f| {
            write!(f, "at {path}: depth {depth}, expected {expected} for this outline kind")
        },
        /// A `childNodeIds` edge closes a cycle in the structure graph.
        StructureCycle {
            /// The offending `structure[i].childNodeIds[j]`.
            path: Path,
            /// The parent node id.
            parent: i32,
            /// The child node id that reaches an active ancestor.
            child: i32,
        } => |f| {
            write!(f, "at {path}: edge {parent} -> {child} closes a structure cycle")
        },
        /// A structure node is referenced by more than one parent.
        MultipleStructureParents {
            /// The second offending `structure[i].childNodeIds[j]`.
            path: Path,
            /// The shared child node id.
            child: i32,
            /// The first parent node id encountered in wire order.
            first_parent: i32,
            /// The second parent node id.
            second_parent: i32,
        } => |f| {
            write!(
                f,
                "at {path}: child {child} already belongs to parent {first_parent}, not {second_parent}"
            )
        },
        /// A child's range extends outside its parent's range.
        ChildRangeOutsideParent {
            /// The offending `structure[i].childNodeIds[j]`.
            path: Path,
            /// The parent node id.
            parent: i32,
            /// The child node id.
            child: i32,
        } => |f| {
            write!(f, "at {path}: child {child} falls outside parent {parent}")
        },
        /// A derivation step's `passId` or `ruleId` is empty — the invalid-by-
        /// construction placeholder a producer reports when it never overrode
        /// `pass_identity()`.
        MissingDerivationIdentity {
            /// The offending `derivation[i]`.
            path: Path,
        } => |f| {
            write!(f, "at {path}: empty passId or ruleId")
        },
        /// Two derivation steps share a `passId`.
        DuplicateDerivationPassId {
            /// The `derivation[i]` where the duplicate was found.
            path: Path,
            /// The duplicated pass id.
            pass_id: String,
        } => |f| {
            let pass_id = escape_untrusted(pass_id);
            write!(f, "at {path}: duplicate passId `{pass_id}`")
        },
        /// `derivation` is empty — the document claims no producer ran at all,
        /// which is never valid: a per-step identity check that only runs inside
        /// a loop over `derivation` is vacuously satisfied by an empty list, so
        /// this must be rejected explicitly rather than relying on the loop.
        EmptyDerivation {
            /// Always `derivation`.
            path: Path,
        } => |f| {
            write!(f, "at {path}: must not be empty")
        },
    }
}

/// Escape a string that came from an untrusted document before interpolating
/// it into a rendered [`ValidationError`] message. Consumers such as
/// `examples/recanon.rs` write this text directly to stderr, so a hostile
/// value must not be able to inject a newline (forging extra log lines) or a
/// terminal control sequence — it renders as visible, inert escapes instead.
///
/// Returns the borrowing `EscapeDebug` iterator rather than an allocated
/// `String`: a hostile, arbitrarily large value can expand several-fold once
/// control bytes become `\u{..}` escapes, and this way the formatter writes
/// each escaped char as it goes instead of the rejection path first
/// materializing the whole (attacker-sized) escaped string in memory.
fn escape_untrusted(value: &str) -> core::str::EscapeDebug<'_> {
    value.escape_debug()
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
            write!(f, "\n  - {error}")?;
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
/// vocabulary, contract version, ordered non-empty token layout, range
/// order/bounds against the declared length, token-axis legality, id uniqueness,
/// and outline depth/ownership/containment/acyclicity). With `source =
/// Some(bytes)`, the content hash, byte length, and UTF-8 character boundaries
/// are checked against the real bytes as well.
///
/// # Errors
///
/// Returns [`ValidationErrors`] listing every broken invariant if the document
/// is invalid.
///
/// Implemented as seven pure, independently testable validators — contract
/// identity, source identity, token ranges, token axes, the structure graph,
/// diagnostics, and derivation — run in that order and concatenated, so the
/// error order is deterministic and each concern can be reasoned about (and
/// mutation-tested) on its own.
pub fn validate_document(
    document: &syntax_v1::DocumentAnalysis,
    source: Option<&[u8]>,
) -> Result<(), ValidationErrors> {
    let mut errors = validate_contract_identity(document);
    let (ctx, source_errors) = validate_source_identity(document, source);
    errors.extend(source_errors);
    errors.extend(validate_token_ranges(document, &ctx));
    errors.extend(validate_token_axes(document));
    errors.extend(validate_structure_graph(document, &ctx));
    errors.extend(validate_diagnostics(document, &ctx));
    errors.extend(validate_derivation(document, &ctx));

    if errors.is_empty() {
        Ok(())
    } else {
        Err(ValidationErrors(errors))
    }
}

/// Validate `contractVersion`, `schemaHash`, and `vocabularyHash` against this
/// build's contract identity.
fn validate_contract_identity(document: &syntax_v1::DocumentAnalysis) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if document.contract_version != CONTRACT_VERSION {
        errors.push(ValidationError::UnsupportedContractVersion {
            path: Path::root().field("contractVersion"),
            found: document.contract_version.clone(),
        });
    }
    let expected_schema = syntax_schema_hash();
    if document.schema_hash != expected_schema {
        errors.push(ValidationError::SchemaHashMismatch {
            path: Path::root().field("schemaHash"),
            expected: expected_schema,
            found: document.schema_hash.clone(),
        });
    }
    let expected_vocab = vocabulary_hash();
    if document.vocabulary_hash != expected_vocab {
        errors.push(ValidationError::VocabularyHashMismatch {
            path: Path::root().field("vocabularyHash"),
            expected: expected_vocab,
            found: document.vocabulary_hash.clone(),
        });
    }
    errors
}

/// Resolved source context every range check needs: the effective length
/// every range is bounded against, and the decoded source text (only when the
/// caller supplied bytes that are valid UTF-8) for char-boundary checks.
struct SourceContext<'a> {
    length: i64,
    text: Option<&'a str>,
}

/// Validate `source.utf8ByteLength` and, given real bytes, `source.contentHash`
/// and UTF-8 validity, then resolve the [`SourceContext`] every range check
/// depends on.
fn validate_source_identity<'a>(
    document: &syntax_v1::DocumentAnalysis,
    source: Option<&'a [u8]>,
) -> (SourceContext<'a>, Vec<ValidationError>) {
    let mut errors = Vec::new();

    // A declared length is meaningful with or without a source; a negative one
    // is never valid and would otherwise be clamped away below.
    if document.source.utf8_byte_length < 0 {
        errors.push(ValidationError::NegativeByteLength {
            path: Path::root().field("source").field("utf8ByteLength"),
            value: document.source.utf8_byte_length,
        });
    }

    let text = match source {
        Some(bytes) => {
            // The byte length is known regardless of UTF-8 validity, so check the
            // length lie before the decode decision — a hostile artifact must not
            // hide a fabricated `utf8ByteLength` behind non-UTF-8 bytes.
            if document.source.utf8_byte_length as i64 != bytes.len() as i64 {
                errors.push(ValidationError::ByteLengthMismatch {
                    path: Path::root().field("source").field("utf8ByteLength"),
                    declared: document.source.utf8_byte_length,
                    actual: bytes.len(),
                });
            }
            match std::str::from_utf8(bytes) {
                Ok(text) => {
                    let expected_hash = sha256_hex(bytes);
                    if document.source.content_hash != expected_hash {
                        errors.push(ValidationError::ContentHashMismatch {
                            path: Path::root().field("source").field("contentHash"),
                            expected: expected_hash,
                            found: document.source.content_hash.clone(),
                        });
                    }
                    Some(text)
                }
                Err(_) => {
                    errors.push(ValidationError::SourceNotUtf8 {
                        path: Path::root().field("source"),
                    });
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

    (SourceContext { length, text }, errors)
}

/// Check one byte range against `ctx`: order, bounds, and (when the source
/// text is known) char-boundary alignment. `path` should point at the
/// `byteRange` field itself; the start/end-specific errors append
/// `.startUtf8`/`.endUtf8`.
fn check_range(
    path: &Path,
    range: &syntax_v1::ByteRange,
    ctx: &SourceContext,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    for (field, value) in [("startUtf8", range.start_utf8), ("endUtf8", range.end_utf8)] {
        if value < 0 {
            errors.push(ValidationError::NegativeOffset {
                path: path.clone().field(field),
                value,
            });
        }
    }
    if range.start_utf8 > range.end_utf8 {
        errors.push(ValidationError::RangeOutOfOrder {
            path: path.clone(),
            start: range.start_utf8,
            end: range.end_utf8,
        });
    }
    if range.end_utf8 as i64 > ctx.length {
        errors.push(ValidationError::RangeOutOfBounds {
            path: path.clone().field("endUtf8"),
            end: range.end_utf8,
            length: ctx.length,
        });
    }
    if let Some(text) = ctx.text {
        for (field, value) in [("startUtf8", range.start_utf8), ("endUtf8", range.end_utf8)] {
            if let Ok(offset) = usize::try_from(value) {
                if offset <= text.len() && !text.is_char_boundary(offset) {
                    errors.push(ValidationError::RangeNotOnCharBoundary {
                        path: path.clone().field(field),
                        offset: value,
                    });
                }
            }
        }
    }
    errors
}

/// Validate token byte ranges (order, bounds, character boundaries,
/// non-emptiness, wire ordering, and non-overlap) and `occurrenceId`
/// uniqueness.
fn validate_token_ranges(
    document: &syntax_v1::DocumentAnalysis,
    ctx: &SourceContext,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    for (i, token) in document.tokens.iter().enumerate() {
        let path = Path::root().field("tokens").index(i);
        errors.extend(check_range(
            &path.clone().field("byteRange"),
            &token.byte_range,
            ctx,
        ));
        if token.byte_range.start_utf8 == token.byte_range.end_utf8 {
            errors.push(ValidationError::EmptyTokenRange {
                path: path.clone().field("byteRange"),
                occurrence_id: token.occurrence_id,
            });
        }
        if let Some((previous_index, previous)) = i.checked_sub(1).and_then(|previous_index| {
            document
                .tokens
                .get(previous_index)
                .map(|previous| (previous_index, previous))
        }) {
            let start_path = path.clone().field("byteRange").field("startUtf8");
            if token.byte_range.start_utf8 < previous.byte_range.start_utf8 {
                errors.push(ValidationError::UnsortedTokenRange {
                    path: start_path,
                    previous_index,
                    previous_start: previous.byte_range.start_utf8,
                    start: token.byte_range.start_utf8,
                });
            } else if token.byte_range.start_utf8 < previous.byte_range.end_utf8 {
                errors.push(ValidationError::OverlappingTokenRange {
                    path: start_path,
                    previous_index,
                    previous_end: previous.byte_range.end_utf8,
                    start: token.byte_range.start_utf8,
                });
            }
        }
        if !seen_ids.insert(token.occurrence_id) {
            errors.push(ValidationError::DuplicateTokenId {
                path,
                occurrence_id: token.occurrence_id,
            });
        }
    }
    errors
}

/// Validate each token's `tokenKind` / `lexicalClass` / `functionKind` /
/// `openClassKind` axis combination.
fn validate_token_axes(document: &syntax_v1::DocumentAnalysis) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    for (i, token) in document.tokens.iter().enumerate() {
        if let Some(detail) = token_axes_violation(token) {
            errors.push(ValidationError::IllegalTokenAxes {
                path: Path::root().field("tokens").index(i),
                occurrence_id: token.occurrence_id,
                detail,
            });
        }
    }
    errors
}

/// Validate the complete outline graph in wire order.
fn validate_structure_graph(
    document: &syntax_v1::DocumentAnalysis,
    ctx: &SourceContext,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    let mut node_indices = std::collections::HashMap::new();

    for (i, node) in document.structure.iter().enumerate() {
        let path = Path::root().field("structure").index(i);
        errors.extend(check_range(
            &path.clone().field("byteRange"),
            &node.byte_range,
            ctx,
        ));
        if !seen_ids.insert(node.node_id) {
            errors.push(ValidationError::DuplicateNodeId {
                path: path.clone(),
                node_id: node.node_id,
            });
        }
        node_indices.entry(node.node_id).or_insert(i);
        let expected = match node.kind {
            syntax_v1::OutlineKind::Paragraph => 0,
            syntax_v1::OutlineKind::Sentence => 1,
        };
        if node.depth != expected {
            errors.push(ValidationError::InvalidOutlineDepth {
                path: path.field("depth"),
                depth: node.depth,
                expected,
            });
        }
    }

    let mut parents = std::collections::HashMap::new();
    for (i, node) in document.structure.iter().enumerate() {
        let path = Path::root().field("structure").index(i);
        for (j, child) in node.child_node_ids.iter().enumerate() {
            let edge_path = path.clone().field("childNodeIds").index(j);
            let Some(&child_index) = node_indices.get(child) else {
                errors.push(ValidationError::DanglingChildRef {
                    path: edge_path,
                    child: *child,
                });
                continue;
            };

            if let Some(&first_parent) = parents.get(child) {
                if first_parent != node.node_id {
                    errors.push(ValidationError::MultipleStructureParents {
                        path: edge_path.clone(),
                        child: *child,
                        first_parent,
                        second_parent: node.node_id,
                    });
                }
            } else {
                parents.insert(*child, node.node_id);
            }

            let child_range = &document.structure[child_index].byte_range;
            if child_range.start_utf8 < node.byte_range.start_utf8
                || child_range.end_utf8 > node.byte_range.end_utf8
            {
                errors.push(ValidationError::ChildRangeOutsideParent {
                    path: edge_path,
                    parent: node.node_id,
                    child: *child,
                });
            }
        }
    }

    // Iterative depth-first search avoids making hostile graph depth consume
    // the process stack. Root and edge iteration preserve wire order.
    let mut colors = vec![0_u8; document.structure.len()];
    for root in 0..document.structure.len() {
        if colors[root] != 0 {
            continue;
        }
        colors[root] = 1;
        let mut stack = vec![(root, 0_usize)];
        while let Some(&(node_index, edge_index)) = stack.last() {
            let node = &document.structure[node_index];
            if edge_index == node.child_node_ids.len() {
                colors[node_index] = 2;
                stack.pop();
                continue;
            }
            stack.last_mut().expect("DFS stack is non-empty").1 += 1;
            let child = node.child_node_ids[edge_index];
            let Some(&child_index) = node_indices.get(&child) else {
                continue;
            };
            match colors[child_index] {
                0 => {
                    colors[child_index] = 1;
                    stack.push((child_index, 0));
                }
                1 => errors.push(ValidationError::StructureCycle {
                    path: Path::root()
                        .field("structure")
                        .index(node_index)
                        .field("childNodeIds")
                        .index(edge_index),
                    parent: node.node_id,
                    child,
                }),
                _ => {}
            }
        }
    }

    errors
}

/// Validate each diagnostic's byte range.
fn validate_diagnostics(
    document: &syntax_v1::DocumentAnalysis,
    ctx: &SourceContext,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    for (i, diagnostic) in document.diagnostics.iter().enumerate() {
        let path = Path::root()
            .field("diagnostics")
            .index(i)
            .field("byteRange");
        errors.extend(check_range(&path, &diagnostic.byte_range, ctx));
    }
    errors
}

/// Validate `derivation`: at least one step must be present, each step's
/// `passId`/`ruleId` must be non-empty, `passId` must be unique across the
/// complete list, and every step's `sourceRanges` are valid byte ranges.
///
/// An empty list is checked explicitly rather than left to the per-step loop,
/// since a loop over zero steps would otherwise vacuously pass every check
/// below. `passId` uniqueness is checked across the complete list, not merely
/// the two steps today's producer happens to emit, so a future third
/// derivation step is covered without changing this check. `ruleId` is
/// required to be non-empty but is *not* checked for uniqueness: two steps
/// naming the same rule family under different pass ids is legitimate.
fn validate_derivation(
    document: &syntax_v1::DocumentAnalysis,
    ctx: &SourceContext,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if document.derivation.is_empty() {
        errors.push(ValidationError::EmptyDerivation {
            path: Path::root().field("derivation"),
        });
    }
    let mut seen_pass_ids = std::collections::HashSet::new();
    for (i, step) in document.derivation.iter().enumerate() {
        let path = Path::root().field("derivation").index(i);
        if step.pass_id.is_empty() || step.rule_id.is_empty() {
            errors.push(ValidationError::MissingDerivationIdentity { path: path.clone() });
        }
        if !seen_pass_ids.insert(step.pass_id.clone()) {
            errors.push(ValidationError::DuplicateDerivationPassId {
                path: path.clone(),
                pass_id: step.pass_id.clone(),
            });
        }
        for (j, range) in step.source_ranges.iter().enumerate() {
            errors.extend(check_range(
                &path.clone().field("sourceRanges").index(j),
                range,
                ctx,
            ));
        }
    }
    errors
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
    fn logical_line_break_count_treats_crlf_as_one_break() {
        assert_eq!(logical_line_break_count(""), 0);
        assert_eq!(logical_line_break_count("\n"), 1);
        assert_eq!(logical_line_break_count("\r"), 1);
        assert_eq!(logical_line_break_count("\r\n"), 1);
        assert_eq!(logical_line_break_count("\n\n"), 2);
        assert_eq!(logical_line_break_count("\r\r"), 2);
        assert_eq!(logical_line_break_count("\r\n\r\n"), 2);
        // A lone \n immediately followed by a \r\n pair: two independent
        // break events, not three -- the \r\n is still one break.
        assert_eq!(logical_line_break_count("\n\r\n"), 2);
    }

    #[test]
    fn is_paragraph_break_requires_only_whitespace_between_the_breaks() {
        assert!(is_paragraph_break("\n\n"));
        assert!(is_paragraph_break("\r\r"));
        assert!(is_paragraph_break("\n  \n"));
        assert!(!is_paragraph_break("\n"));
        // Two breaks with non-whitespace between them is not a blank line,
        // even though the break count alone would say otherwise.
        assert!(!is_paragraph_break("\nx\n"));
    }

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

    #[test]
    fn strip_graphql_descriptions_removes_only_description_lines() {
        let sdl = "\"A description.\"\ntype Foo {\n  bar: Int!\n}\n";
        let stripped = strip_graphql_descriptions(sdl);
        assert!(!stripped.contains("A description."));
        assert!(stripped.contains("type Foo"));
        assert!(stripped.contains("bar: Int!"));
    }

    #[test]
    fn schema_hash_is_unchanged_by_a_description_only_edit() {
        let a = "\"Old description.\"\ntype Foo {\n  bar: Int!\n}\n";
        let b = "\"New, unrelated description.\"\ntype Foo {\n  bar: Int!\n}\n";
        assert_eq!(
            sha256_hex(strip_graphql_descriptions(a).as_bytes()),
            sha256_hex(strip_graphql_descriptions(b).as_bytes()),
            "a description-only edit must not change the normalized schema hash"
        );
    }

    #[test]
    fn schema_hash_changes_when_shape_changes() {
        let a = "\"A description.\"\ntype Foo {\n  bar: Int!\n}\n";
        let b = "\"A description.\"\ntype Foo {\n  bar: Int!\n  baz: String!\n}\n";
        assert_ne!(
            sha256_hex(strip_graphql_descriptions(a).as_bytes()),
            sha256_hex(strip_graphql_descriptions(b).as_bytes()),
            "a real field/type edit must still change the normalized schema hash"
        );
    }
}

#[cfg(test)]
mod integration {
    use super::*;
    use colorful_core::{
        Annotator, ClassificationError, LexicalAnnotator, Parser, ValidatedClassification,
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
            let document: syntax_v1::DocumentAnalysis = serde_json::from_value(value)
                .unwrap_or_else(|error| {
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

    fn malformed_projection_error(
        source: &str,
        tree: &Tree,
        tokens: &[CoreToken],
    ) -> ProjectionError {
        let (_, _, parser_identity, annotator_identity) = projection_parts(source);
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
        validate_document(&aggregate, Some(source.as_bytes()))
            .expect("every successful projection validates against its source");
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
        let token_axes_pos =
            position_of(&|e| matches!(e, ValidationError::IllegalTokenAxes { .. }));
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
}
