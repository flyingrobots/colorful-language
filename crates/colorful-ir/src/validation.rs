use crate::{sha256_hex, syntax_schema_hash, syntax_v1, vocabulary_hash, Path, CONTRACT_VERSION};

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
            pub(crate) const VARIANT_NAMES: &'static [&'static str] = &[
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
/// [`crate::from_classification`] always passes, but an artifact received over a
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
    let node_indices = validate_structure_nodes(document, ctx, &mut errors);
    validate_structure_edges(document, &node_indices, &mut errors);
    validate_structure_cycles(document, &node_indices, &mut errors);
    errors
}

/// Validate each node and build the first-occurrence index used by edge checks.
fn validate_structure_nodes(
    document: &syntax_v1::DocumentAnalysis,
    ctx: &SourceContext,
    errors: &mut Vec<ValidationError>,
) -> std::collections::HashMap<i32, usize> {
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
    node_indices
}

/// Validate parent ownership and range containment for every resolvable edge.
fn validate_structure_edges(
    document: &syntax_v1::DocumentAnalysis,
    node_indices: &std::collections::HashMap<i32, usize>,
    errors: &mut Vec<ValidationError>,
) {
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
}

/// Validate graph acyclicity with an iterative, wire-ordered depth-first search.
fn validate_structure_cycles(
    document: &syntax_v1::DocumentAnalysis,
    node_indices: &std::collections::HashMap<i32, usize>,
    errors: &mut Vec<ValidationError>,
) {
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
    use syntax_v1::TokenKind;
    match token.token_kind {
        TokenKind::Word => word_token_axes_violation(token),
        TokenKind::Number | TokenKind::Punctuation | TokenKind::Quote => {
            non_word_token_axes_violation(token)
        }
    }
}

fn word_token_axes_violation(token: &syntax_v1::Token) -> Option<&'static str> {
    use syntax_v1::LexicalClass;
    match token.lexical_class {
        None => Some("a WORD token must carry a lexicalClass"),
        Some(LexicalClass::Function) => function_word_axes_violation(token),
        Some(LexicalClass::Content) => token
            .function_kind
            .is_some()
            .then_some("only a FUNCTION word may carry a functionKind"),
        Some(LexicalClass::ProperNounCandidate) => proper_noun_axes_violation(token),
    }
}

fn function_word_axes_violation(token: &syntax_v1::Token) -> Option<&'static str> {
    if token.function_kind.is_none() {
        Some("a FUNCTION word must carry a functionKind")
    } else {
        token
            .open_class_kind
            .is_some()
            .then_some("only a CONTENT word may carry an openClassKind")
    }
}

fn proper_noun_axes_violation(token: &syntax_v1::Token) -> Option<&'static str> {
    if token.function_kind.is_some() {
        Some("only a FUNCTION word may carry a functionKind")
    } else {
        token
            .open_class_kind
            .is_some()
            .then_some("only a CONTENT word may carry an openClassKind")
    }
}

fn non_word_token_axes_violation(token: &syntax_v1::Token) -> Option<&'static str> {
    if token.lexical_class.is_some() {
        Some("a non-word token must not carry a lexicalClass")
    } else if token.function_kind.is_some() {
        Some("a non-word token must not carry a functionKind")
    } else {
        token
            .open_class_kind
            .is_some()
            .then_some("a non-word token must not carry an openClassKind")
    }
}
