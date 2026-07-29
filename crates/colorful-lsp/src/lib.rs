//! Pure building blocks for the prose language server.
//!
//! The server itself (the `colorful-lsp` binary) is thin glue over these
//! functions: turn a document into one shared [`DocumentAnalysis`], apply an
//! incremental edit to a [`Rope`] mirror ([`apply_change`]), and describe the
//! token legend ([`legend_token_types`]).
//!
//! Keeping this logic here — free of async and transport — is what makes the
//! UTF-16 position arithmetic and the delta encoding unit-testable.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::collections::HashMap;
use std::sync::OnceLock;

use colorful_core::{
    Analyzer, Annotator, ClassificationError, Finding, Parser, PosClass, Severity, Token,
    ValidatedClassification,
};
use ropey::Rope;
use tower_lsp::lsp_types::{
    Diagnostic, DiagnosticSeverity, NumberOrString, Position, Range, SemanticToken,
    SemanticTokenType,
};

/// The source format that determines which document regions contain prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentFormat {
    /// Analyze the complete document.
    PlainText,
    /// Analyze Markdown prose while excluding reviewed syntax regions.
    Markdown,
}

impl DocumentFormat {
    /// Map an LSP language identifier to the supported document format.
    ///
    /// Unknown identifiers deliberately retain the historical Plain Text
    /// behavior rather than silently dropping analysis.
    #[must_use]
    pub fn from_language_id(language_id: &str) -> Self {
        if language_id.eq_ignore_ascii_case("markdown") {
            Self::Markdown
        } else {
            Self::PlainText
        }
    }
}

/// The semantic-token legend, in index order, derived from the
/// `colorful.vocabulary/v1` manifest (the distinct LSP token types its roles
/// project to). The default contextual path is a *skeleton* highlighter: it
/// accentuates structure (function words, proper nouns, numbers, quotes) plus
/// deterministic open-class noun/verb/adjective/adverb decisions, while
/// unlisted content stays unstyled. Every surface stays in lock-step because all
/// three read the same manifest.
#[must_use]
pub fn legend_token_types() -> Vec<SemanticTokenType> {
    colorful_ir::vocabulary::lsp_legend()
        .into_iter()
        .map(SemanticTokenType::new)
        .collect()
}

/// The legend index for a class, or `None` for classes left unstyled.
///
/// The class maps to a `VisualRole`, the manifest projects that role onto an LSP
/// token-type name (or nothing), and the index is that name's position in
/// [`legend_token_types`]. Undifferentiated content words and punctuation project
/// to no token (skeleton mode).
fn token_type_index(class: PosClass) -> Option<u32> {
    static TOKEN_TYPE_INDEX: OnceLock<HashMap<&'static str, u32>> = OnceLock::new();
    let token_type_index = TOKEN_TYPE_INDEX.get_or_init(|| {
        colorful_ir::vocabulary::lsp_legend()
            .into_iter()
            .enumerate()
            .map(|(i, token_type)| (token_type, i as u32))
            .collect()
    });

    let role = colorful_ir::vocabulary::visual_role_for(class);
    let name = token_type_name_for(role.as_ref())?;
    token_type_index.get(name).copied()
}

/// The LSP semantic token-type name for an optional role, or `None` if the
/// role is absent (an uncovered token-axis combination) or itself has no
/// manifest entry (a drifted manifest). Split out of [`token_type_index`] so
/// the "missing role/projection degrades to no token" contract is directly
/// testable.
fn token_type_name_for(
    role: Option<&colorful_ir::vocabulary_v1::VisualRole>,
) -> Option<&'static str> {
    role.and_then(colorful_ir::vocabulary::projection)?
        .lsp_token_type
        .as_deref()
}

/// Maps byte offsets to `(line, UTF-16 column)` positions over a fixed string.
struct LineIndex<'a> {
    text: &'a str,
    /// Byte offset of the start of each line.
    line_starts: Vec<usize>,
}

impl<'a> LineIndex<'a> {
    fn new(text: &'a str) -> Self {
        // Recognize the LSP line-ending set: `\n`, `\r\n`, and a bare `\r`.
        let mut line_starts = vec![0usize];
        let bytes = text.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'\n' => {
                    line_starts.push(i + 1);
                    i += 1;
                }
                b'\r' => {
                    let next = if bytes.get(i + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                    line_starts.push(i + next);
                    i += next;
                }
                _ => i += 1,
            }
        }
        Self { text, line_starts }
    }

    /// The `(line, UTF-16 column)` of a byte offset that lies on a char
    /// boundary. Tokens never straddle a newline, so the column is well defined.
    fn position(&self, byte: usize) -> (u32, u32) {
        let line = match self.line_starts.binary_search(&byte) {
            Ok(line) => line,
            Err(next) => next - 1,
        };
        let col_utf16: usize = self.text[self.line_starts[line]..byte]
            .chars()
            .map(char::len_utf16)
            .sum();
        (line as u32, col_utf16 as u32)
    }

    /// The byte offset of an LSP `(line, UTF-16 character)` position, clamped to
    /// the line's content end (excluding its terminator), per the LSP `Position`
    /// contract. Uses the same line model as [`LineIndex::position`].
    fn offset_of(&self, line: u32, character: u32) -> usize {
        let line = (line as usize).min(self.line_starts.len() - 1);
        let line_start = self.line_starts[line];
        let line_end = self
            .line_starts
            .get(line + 1)
            .copied()
            .unwrap_or(self.text.len());
        let content = self.text[line_start..line_end].trim_end_matches(['\r', '\n']);

        let mut utf16 = 0u32;
        for (i, c) in content.char_indices() {
            if utf16 >= character {
                return line_start + i;
            }
            utf16 += c.len_utf16() as u32;
        }
        line_start + content.len()
    }
}

/// The number of UTF-16 code units in `s`.
fn utf16_len(s: &str) -> u32 {
    s.chars().map(|c| c.len_utf16() as u32).sum()
}

/// The transport-ready products derived from one parse and classification.
///
/// A document generation owns one value of this type. The server publishes its
/// diagnostics and answers semantic-token requests from the same cached value,
/// so the two surfaces cannot observe different classifications for one
/// generation.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentAnalysis {
    semantic_tokens: Vec<SemanticToken>,
    diagnostics: Vec<Diagnostic>,
}

impl DocumentAnalysis {
    /// Assemble one analysis from its semantic-token and diagnostic products.
    #[must_use]
    pub fn new(semantic_tokens: Vec<SemanticToken>, diagnostics: Vec<Diagnostic>) -> Self {
        Self {
            semantic_tokens,
            diagnostics,
        }
    }

    /// Degrade an invalid adapter classification into one stable diagnostic.
    ///
    /// No semantic tokens are emitted because even a valid-looking prefix
    /// cannot be trusted once the adapter's aggregate fails validation.
    #[must_use]
    pub fn invalid_classification(error: &ClassificationError) -> Self {
        Self::new(
            vec![],
            vec![Diagnostic {
                range: Range::new(Position::new(0, 0), Position::new(0, 0)),
                severity: Some(DiagnosticSeverity::ERROR),
                code: Some(NumberOrString::String(
                    "colorful/invalid-classification".to_string(),
                )),
                source: Some("colorful".to_string()),
                message: error.to_string(),
                ..Diagnostic::default()
            }],
        )
    }

    /// The delta-encoded semantic tokens for this document generation.
    #[must_use]
    pub fn semantic_tokens(&self) -> &[SemanticToken] {
        &self.semantic_tokens
    }

    /// The diagnostics for this document generation.
    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }
}

/// Parse and classify `text` once, then derive both LSP output surfaces.
///
/// The returned value is suitable for generation-keyed caching by the server.
/// Neither diagnostics nor semantic tokens reparses or reclassifies the source.
///
/// # Errors
///
/// Returns a typed [`ClassificationError`] if the parser or annotator emits
/// malformed public tree/token data.
pub fn analyze_document<P, A, An>(
    text: &str,
    parser: &P,
    annotator: &A,
    analyzer: &An,
) -> Result<DocumentAnalysis, ClassificationError>
where
    P: Parser,
    A: Annotator,
    An: Analyzer,
{
    analyze_document_sources(text, text, parser, annotator, analyzer)
}

/// Analyze one document according to its source format.
///
/// # Errors
///
/// Returns a typed [`ClassificationError`] if the parser or annotator emits
/// malformed public tree/token data.
pub fn analyze_document_for_format<P, A, An>(
    text: &str,
    format: DocumentFormat,
    parser: &P,
    annotator: &A,
    analyzer: &An,
) -> Result<DocumentAnalysis, ClassificationError>
where
    P: Parser,
    A: Annotator,
    An: Analyzer,
{
    let analysis_text = match format {
        DocumentFormat::PlainText => std::borrow::Cow::Borrowed(text),
        DocumentFormat::Markdown => colorful_parse::markdown::mask_non_prose(text),
    };
    analyze_document_sources(text, &analysis_text, parser, annotator, analyzer)
}

fn analyze_document_sources<P, A, An>(
    source_text: &str,
    analysis_text: &str,
    parser: &P,
    annotator: &A,
    analyzer: &An,
) -> Result<DocumentAnalysis, ClassificationError>
where
    P: Parser,
    A: Annotator,
    An: Analyzer,
{
    let classification = ValidatedClassification::from_ports(analysis_text, parser, annotator)?;
    let semantic_tokens = semantic_tokens_from(source_text, classification.tokens());
    let findings = analyzer.analyze(
        analysis_text,
        classification.tree(),
        classification.tokens(),
    );
    let diagnostics = diagnostics_from(source_text, findings);
    Ok(DocumentAnalysis::new(semantic_tokens, diagnostics))
}

/// Compute the delta-encoded LSP semantic tokens for `text`.
///
/// Words are classified through `parser` and `annotator`; deterministic
/// open-class roles emit semantic tokens, while undifferentiated content words
/// and punctuation are left unstyled (skeleton mode). Token types index into
/// [`legend_token_types`].
///
/// # Errors
///
/// Returns a typed [`ClassificationError`] if the parser or annotator emits
/// malformed public tree/token data.
pub fn compute_semantic_tokens<P, A>(
    text: &str,
    parser: &P,
    annotator: &A,
) -> Result<Vec<SemanticToken>, ClassificationError>
where
    P: Parser,
    A: Annotator,
{
    let classification = ValidatedClassification::from_ports(text, parser, annotator)?;
    Ok(semantic_tokens_from(text, classification.tokens()))
}

fn semantic_tokens_from(text: &str, tokens: &[Token]) -> Vec<SemanticToken> {
    let index = LineIndex::new(text);

    let mut data = Vec::new();
    let mut prev_line = 0u32;
    let mut prev_start = 0u32;
    for token in tokens {
        let Some(token_type) = token_type_index(token.class) else {
            continue;
        };
        let (line, start) = index.position(token.span.start);
        let length = utf16_len(&text[token.span.start..token.span.end]);
        let delta_line = line - prev_line;
        let delta_start = if delta_line == 0 {
            start - prev_start
        } else {
            start
        };
        data.push(SemanticToken {
            delta_line,
            delta_start,
            length,
            token_type,
            token_modifiers_bitset: 0,
        });
        prev_line = line;
        prev_start = start;
    }
    data
}

/// Compute the LSP diagnostics for `text` from the prose linter.
///
/// `text` is parsed and classified through `parser`/`annotator` (the same path
/// the semantic tokens take), then `analyzer` reports the findings, which are
/// mapped to [`Diagnostic`]s: each carries its rule code, a `colorful` source
/// tag, and a severity (warnings as [`DiagnosticSeverity::WARNING`], advisory
/// findings as [`DiagnosticSeverity::INFORMATION`]). Kept transport-free so the
/// position arithmetic is unit-testable.
///
/// # Errors
///
/// Returns a typed [`ClassificationError`] if the parser or annotator emits
/// malformed public tree/token data.
pub fn compute_diagnostics<P, A, An>(
    text: &str,
    parser: &P,
    annotator: &A,
    analyzer: &An,
) -> Result<Vec<Diagnostic>, ClassificationError>
where
    P: Parser,
    A: Annotator,
    An: Analyzer,
{
    let classification = ValidatedClassification::from_ports(text, parser, annotator)?;
    let findings = analyzer.analyze(text, classification.tree(), classification.tokens());
    Ok(diagnostics_from(text, findings))
}

fn diagnostics_from(text: &str, findings: Vec<Finding>) -> Vec<Diagnostic> {
    let index = LineIndex::new(text);

    findings
        .into_iter()
        .map(|finding| {
            let (start_line, start_col) = index.position(finding.span.start);
            let (end_line, end_col) = index.position(finding.span.end);
            let severity = match finding.severity {
                Severity::Warning => DiagnosticSeverity::WARNING,
                Severity::Info => DiagnosticSeverity::INFORMATION,
            };
            Diagnostic {
                range: Range {
                    start: Position::new(start_line, start_col),
                    end: Position::new(end_line, end_col),
                },
                severity: Some(severity),
                code: Some(NumberOrString::String(finding.rule.code().to_string())),
                source: Some("colorful".to_string()),
                message: finding.message,
                ..Diagnostic::default()
            }
        })
        .collect()
}

/// Apply one LSP content change to a [`Rope`] document mirror.
///
/// A change with no range replaces the whole document; otherwise the range
/// (whose columns are UTF-16 code units) is removed and `text` inserted. Out-of
/// range positions are clamped so malformed edits cannot panic.
pub fn apply_change(rope: &mut Rope, range: Option<Range>, text: &str) {
    match range {
        None => *rope = Rope::from_str(text),
        Some(range) => {
            // Map LSP positions to byte offsets using the *same* line model as
            // the semantic-token path (LSP: `\n`, `\r\n`, `\r`). Ropey's own line
            // APIs also split on NEL/LS/PS, which the LSP spec does not, so using
            // them here would make edits and tokens disagree about line numbers.
            let snapshot = rope.to_string();
            let index = LineIndex::new(&snapshot);
            let start = index.offset_of(range.start.line, range.start.character);
            let end = index
                .offset_of(range.end.line, range.end.character)
                .max(start);
            let start_char = rope.byte_to_char(start);
            let end_char = rope.byte_to_char(end);
            rope.remove(start_char..end_char);
            rope.insert(start_char, text);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colorful_core::{ClassificationError, Finding, PosClass, Span, Token, Tree};
    use colorful_lexicon::ContextualOpenClassAnnotator;
    use colorful_lint::ProseLinter;
    use colorful_parse::ProseParser;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower_lsp::lsp_types::Position;

    struct CountingParser<'a> {
        calls: &'a AtomicUsize,
    }

    impl Parser for CountingParser<'_> {
        fn parse(&self, text: &str) -> Tree {
            self.calls.fetch_add(1, Ordering::SeqCst);
            ProseParser::new().parse(text)
        }
    }

    struct CountingAnnotator<'a> {
        calls: &'a AtomicUsize,
    }

    impl Annotator for CountingAnnotator<'_> {
        fn annotate(&self, source: &str, tree: &Tree) -> Vec<Token> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            ContextualOpenClassAnnotator::default().annotate(source, tree)
        }
    }

    struct CountingAnalyzer<'a> {
        calls: &'a AtomicUsize,
    }

    impl Analyzer for CountingAnalyzer<'_> {
        fn analyze(&self, source: &str, tree: &Tree, tokens: &[Token]) -> Vec<Finding> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            ProseLinter::new().analyze(source, tree, tokens)
        }
    }

    #[test]
    fn one_analysis_parses_and_classifies_once_for_both_lsp_surfaces() {
        let parser_calls = AtomicUsize::new(0);
        let annotator_calls = AtomicUsize::new(0);
        let analyzer_calls = AtomicUsize::new(0);

        let analysis = analyze_document(
            "The cat is very calm.",
            &CountingParser {
                calls: &parser_calls,
            },
            &CountingAnnotator {
                calls: &annotator_calls,
            },
            &CountingAnalyzer {
                calls: &analyzer_calls,
            },
        )
        .expect("built-in adapters produce a valid classification");

        assert!(!analysis.semantic_tokens().is_empty());
        assert_eq!(
            analysis.diagnostics()[0].code,
            Some(NumberOrString::String("weak-word".to_string()))
        );
        assert_eq!(parser_calls.load(Ordering::SeqCst), 1);
        assert_eq!(annotator_calls.load(Ordering::SeqCst), 1);
        assert_eq!(analyzer_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn markdown_analysis_excludes_fenced_code_from_both_lsp_surfaces() {
        let source = concat!(
            "The cat is really clear.\n\n",
            "```text\n",
            "The cat is really clear. 😀\n",
            "```\n\n",
            "The cat connects.\n",
        );
        let analysis = analyze_document_for_format(
            source,
            DocumentFormat::Markdown,
            &ProseParser::new(),
            &ContextualOpenClassAnnotator::default(),
            &colorful_lint::ProseLinter::new(),
        )
        .expect("built-in Markdown analysis is valid");

        assert_eq!(analysis.diagnostics().len(), 1, "{analysis:?}");
        assert_eq!(
            analysis.diagnostics()[0].range,
            Range::new(Position::new(0, 11), Position::new(0, 17))
        );

        let mut line = 0u32;
        let mut start = 0u32;
        let decoded: Vec<_> = analysis
            .semantic_tokens()
            .iter()
            .map(|token| {
                if token.delta_line == 0 {
                    start += token.delta_start;
                } else {
                    line += token.delta_line;
                    start = token.delta_start;
                }
                (line, start, token.length, token.token_type)
            })
            .collect();
        assert!(
            decoded.iter().all(|(line, ..)| !(2..=4).contains(line)),
            "fenced code emitted semantic tokens: {decoded:?}"
        );
        assert!(
            decoded.contains(&(6, 4, 3, 4)),
            "the noun after the fence lost its source coordinate: {decoded:?}"
        );
    }

    #[test]
    fn markdown_blocks_separate_surrounding_prose_contexts() {
        let source = concat!(
            "The report is\n\n",
            "```text\n",
            "x.\n",
            "```\n\n",
            "reviewed.\n",
        );
        let analysis = analyze_document_for_format(
            source,
            DocumentFormat::Markdown,
            &ProseParser::new(),
            &ContextualOpenClassAnnotator::default(),
            &colorful_lint::ProseLinter::new(),
        )
        .expect("built-in Markdown analysis is valid");

        assert!(
            analysis.diagnostics().iter().all(|diagnostic| {
                diagnostic.code != Some(NumberOrString::String("passive-voice".to_string()))
            }),
            "{analysis:?}"
        );
    }

    #[test]
    fn incompatible_analysis_coordinates_fail_closed_before_projection() {
        let analysis = analyze_document_sources(
            "é is",
            "aa is",
            &ProseParser::new(),
            &ContextualOpenClassAnnotator::default(),
            &colorful_lint::ProseLinter::new(),
        )
        .expect("coordinate incompatibility degrades to a stable analysis");

        assert!(analysis.semantic_tokens().is_empty());
        assert_eq!(analysis.diagnostics().len(), 1);
        assert_eq!(
            analysis.diagnostics()[0].code,
            Some(NumberOrString::String(
                "colorful/invalid-source-view".to_string()
            ))
        );
    }

    struct OverlappingAnnotator;

    impl Annotator for OverlappingAnnotator {
        fn annotate(&self, _source: &str, _tree: &Tree) -> Vec<Token> {
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
    fn analyze_document_propagates_a_custom_annotators_typed_span_error() {
        let error = analyze_document(
            "cat runs",
            &ProseParser::new(),
            &OverlappingAnnotator,
            &ProseLinter::new(),
        )
        .unwrap_err();

        assert!(matches!(
            &error,
            ClassificationError::OverlappingSpan {
                path,
                previous_index: 0,
                ..
            } if path.to_string() == "tokens[1].span.start"
        ));

        let analysis = DocumentAnalysis::invalid_classification(&error);
        assert!(analysis.semantic_tokens().is_empty());
        assert_eq!(analysis.diagnostics().len(), 1);
        assert_eq!(
            analysis.diagnostics()[0].code,
            Some(NumberOrString::String(
                "colorful/invalid-classification".to_string()
            ))
        );
        assert_eq!(analysis.diagnostics()[0].message, error.to_string());
    }

    #[test]
    fn token_type_name_for_none_role_is_none() {
        // token_type_index() feeds visual_role_for()'s Option through
        // token_type_name_for(). Every real PosClass currently has a manifest
        // entry, so a missing role can't arise from production input — this
        // exercises the composition directly instead.
        assert!(token_type_name_for(None).is_none());
    }

    fn tok(delta_line: u32, delta_start: u32, length: u32, token_type: u32) -> SemanticToken {
        SemanticToken {
            delta_line,
            delta_start,
            length,
            token_type,
            token_modifiers_bitset: 0,
        }
    }

    fn semantic_tokens(text: &str) -> Vec<SemanticToken> {
        compute_semantic_tokens(
            text,
            &ProseParser::new(),
            &ContextualOpenClassAnnotator::default(),
        )
        .expect("built-in adapters produce a valid classification")
    }

    fn diagnostics(text: &str) -> Vec<Diagnostic> {
        compute_diagnostics(
            text,
            &ProseParser::new(),
            &ContextualOpenClassAnnotator::default(),
            &colorful_lint::ProseLinter::new(),
        )
        .expect("built-in adapters produce a valid classification")
    }

    #[test]
    fn diagnostic_carries_range_severity_code_and_source() {
        // "just" is a weak word on line 0, columns 8..12.
        let diags = diagnostics("This is just wrong.");
        assert_eq!(diags.len(), 1, "{diags:?}");
        let d = &diags[0];
        assert_eq!(d.range.start, Position::new(0, 8));
        assert_eq!(d.range.end, Position::new(0, 12));
        assert_eq!(d.severity, Some(DiagnosticSeverity::INFORMATION));
        assert_eq!(
            d.code,
            Some(NumberOrString::String("weak-word".to_string()))
        );
        assert_eq!(d.source.as_deref(), Some("colorful"));
        assert_eq!(d.message, "weak word 'just'");
    }

    #[test]
    fn run_on_diagnostic_is_a_warning() {
        let body = std::iter::repeat_n("word", 41)
            .collect::<Vec<_>>()
            .join(" ");
        let diags = diagnostics(&format!("{body}."));
        let run_on = diags
            .iter()
            .find(|d| d.code == Some(NumberOrString::String("run-on".to_string())))
            .expect("a run-on diagnostic");
        assert_eq!(run_on.severity, Some(DiagnosticSeverity::WARNING));
    }

    #[test]
    fn clean_prose_yields_no_diagnostics() {
        assert!(diagnostics("The cat sat on the mat.").is_empty());
    }

    #[test]
    fn diagnostic_range_uses_utf16_columns() {
        // A multibyte em-dash before the weak word shifts byte offsets but the
        // LSP column is UTF-16, so the weak word's column counts code units.
        let diags = diagnostics("Café — this is just wrong.");
        let weak = diags
            .iter()
            .find(|d| d.code == Some(NumberOrString::String("weak-word".to_string())))
            .expect("a weak-word diagnostic");
        // "Café — this is " is 15 UTF-16 units before "just".
        assert_eq!(weak.range.start, Position::new(0, 15));
        assert_eq!(weak.range.end, Position::new(0, 19));
    }

    #[test]
    fn single_line_tokens_are_delta_encoded() {
        // "The cat is 3." -> keyword, noun, keyword, number. The '.' is
        // punctuation, so it is unstyled in LSP output.
        assert_eq!(
            semantic_tokens("The cat is 3."),
            vec![
                tok(0, 0, 3, 0), // The (keyword)
                tok(0, 4, 3, 4), // cat (noun)
                tok(0, 4, 2, 0), // is  (keyword)
                tok(0, 3, 1, 2), // 3   (number)
            ]
        );
    }

    #[test]
    fn quote_marks_are_string_role_and_enclosed_words_keep_their_own_role() {
        // `"The cat is 3."` -- the quote marks pin to the `string` role
        // (index 3), and the enclosed words keep their own distinct roles
        // (keyword, noun, keyword, number) exactly as the unquoted sentence
        // does in `single_line_tokens_are_delta_encoded`: the whole quoted
        // span is never collapsed into one `string` token.
        assert_eq!(
            semantic_tokens("\"The cat is 3.\""),
            vec![
                tok(0, 0, 1, 3), // opening " (string)
                tok(0, 1, 3, 0), // The     (keyword)
                tok(0, 4, 3, 4), // cat     (noun)
                tok(0, 4, 2, 0), // is      (keyword)
                tok(0, 3, 1, 2), // 3       (number)
                tok(0, 2, 1, 3), // closing " (string)
            ]
        );
    }

    #[test]
    fn unlisted_content_and_punctuation_are_unstyled() {
        // "zebra" is not in the seed lexicon, and punctuation never emits an LSP
        // semantic token.
        assert_eq!(
            semantic_tokens("The zebra is 3."),
            vec![
                tok(0, 0, 3, 0),  // The (keyword)
                tok(0, 10, 2, 0), // is  (keyword; delta skips "zebra")
                tok(0, 3, 1, 2),  // 3   (number)
            ]
        );
    }

    #[test]
    fn seed_open_class_tokens_use_manifest_legend_tail() {
        // Existing closed-class token indices stay at the front of the legend;
        // open-class noun/verb/adjective/adverb roles append after them.
        let tail = &legend_token_types()[4..8];
        assert_eq!(
            tail,
            vec![
                SemanticTokenType::new("noun"),
                SemanticTokenType::new("verb"),
                SemanticTokenType::new("adjective"),
                SemanticTokenType::new("adverb"),
            ]
        );
    }

    #[test]
    fn default_semantic_tokens_emit_seed_open_class_roles() {
        assert_eq!(
            semantic_tokens("cat connects quick silently."),
            vec![
                tok(0, 0, 3, 4), // noun
                tok(0, 4, 8, 5), // verb
                tok(0, 9, 5, 6), // adjective
                tok(0, 6, 8, 7), // adverb
            ]
        );
    }

    #[test]
    fn default_semantic_tokens_emit_contextual_open_class_roles() {
        assert_eq!(
            semantic_tokens("the book I book rooms the fast river connects fast."),
            vec![
                tok(0, 0, 3, 0),  // the (keyword)
                tok(0, 4, 4, 4),  // book (noun)
                tok(0, 5, 1, 0),  // I (keyword)
                tok(0, 2, 4, 5),  // book (verb)
                tok(0, 11, 3, 0), // the (keyword; delta skips "rooms")
                tok(0, 4, 4, 6),  // fast (adjective)
                tok(0, 5, 5, 4),  // river (noun)
                tok(0, 6, 8, 5),  // connects (verb)
                tok(0, 9, 4, 7),  // fast (adverb)
            ]
        );
    }

    #[test]
    fn newlines_advance_the_line_delta() {
        // Function words survive skeleton mode, so this exercises the line delta:
        // "is" (auxiliary) on line 0, "not" (negator) on line 1.
        assert_eq!(
            semantic_tokens("is\nnot"),
            vec![
                tok(0, 0, 2, 0), // is  (line 0)
                tok(1, 0, 3, 0), // not (line 1, delta_start resets to absolute)
            ]
        );
    }

    #[test]
    fn columns_count_utf16_code_units_not_bytes() {
        // A leading emoji is 4 bytes but 2 UTF-16 code units; "is" must report
        // column 3 (emoji=2 + space=1), not byte offset 5.
        assert_eq!(semantic_tokens("\u{1F600} is"), vec![tok(0, 3, 2, 0)]);
    }

    #[test]
    fn line_index_handles_bare_carriage_return() {
        // A lone '\r' is a line break per the LSP spec, so "2" is on line 1.
        // (Numbers survive skeleton coloring; number is token type 2.)
        assert_eq!(
            semantic_tokens("1.\r2"),
            vec![tok(0, 0, 1, 2), tok(1, 0, 1, 2)]
        );
    }

    #[test]
    fn apply_change_clamps_overlong_char_to_line_end_not_next_line() {
        // An over-long character offset on line 0 must clamp to the end of line 0,
        // not spill into line 1 (LSP: clamp to the line's length).
        let mut rope = Rope::from_str("ab\ncd");
        let range = Range {
            start: Position::new(0, 99),
            end: Position::new(0, 99),
        };
        apply_change(&mut rope, Some(range), "X");
        assert_eq!(rope.to_string(), "abX\ncd");
    }

    #[test]
    fn chaotic_unicode_keeps_offsets_consistent() {
        // Combining marks, ZWJ/ZWSP, RTL overrides, and "Zalgo" stacks must not
        // panic, must yield valid delta-encoded tokens, and must round-trip
        // byte-faithfully through the edit path.
        let corpus = [
            "cafe\u{0301} test 12",
            "a\u{200D}b\u{200B}c word 3",
            "\u{202E}rtl\u{202C} here 9",
            "z\u{0300}\u{0301}\u{0302}\u{0303}i Zalgo 4",
            "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} family 7",
        ];
        for text in corpus {
            // Decoding the delta stream must stay ordered (non-decreasing line,
            // then non-decreasing column within a line).
            let mut prev_line = 0u32;
            let mut prev_start = 0u32;
            for (i, t) in semantic_tokens(text).into_iter().enumerate() {
                let (line, start) = if t.delta_line > 0 {
                    (prev_line + t.delta_line, t.delta_start)
                } else {
                    (prev_line, prev_start + t.delta_start)
                };
                assert!(t.length >= 1, "empty token in {text:?}");
                if i > 0 {
                    assert!(
                        line > prev_line || start >= prev_start,
                        "out-of-order token in {text:?}"
                    );
                }
                prev_line = line;
                prev_start = start;
            }
            // A whole-document replace and a clamped no-op edit are byte-faithful.
            let mut rope = Rope::from_str(text);
            apply_change(&mut rope, None, text);
            let range = Range {
                start: Position::new(0, u32::MAX),
                end: Position::new(0, u32::MAX),
            };
            apply_change(&mut rope, Some(range), "");
            assert_eq!(rope.to_string(), text, "round-trip changed {text:?}");
        }
    }

    #[test]
    fn edit_uses_lsp_line_model_not_ropey_unicode_breaks() {
        // U+2028 (line separator) is not an LSP line break, so the document is
        // one line for both tokens and edits. Replacing "is" at its token
        // coordinates must hit "is" — Ropey alone over-splits on U+2028 and would
        // clamp the edit to the wrong line.
        let mut rope = Rope::from_str("ab\u{2028}is");
        let range = Range {
            start: Position::new(0, 3),
            end: Position::new(0, 5),
        };
        apply_change(&mut rope, Some(range), "X");
        assert_eq!(rope.to_string(), "ab\u{2028}X");
    }

    #[test]
    fn apply_change_full_replace() {
        let mut rope = Rope::from_str("abc");
        apply_change(&mut rope, None, "xyz");
        assert_eq!(rope.to_string(), "xyz");
    }

    #[test]
    fn apply_change_incremental_edit() {
        let mut rope = Rope::from_str("hello world");
        let range = Range {
            start: Position::new(0, 6),
            end: Position::new(0, 11),
        };
        apply_change(&mut rope, Some(range), "there");
        assert_eq!(rope.to_string(), "hello there");
    }

    #[test]
    fn apply_change_handles_utf16_surrogate_columns() {
        // "😀x": the emoji is 1 char but 2 UTF-16 code units. Replacing the 'x'
        // at UTF-16 column 2 must map to the correct char index.
        let mut rope = Rope::from_str("\u{1F600}x");
        let range = Range {
            start: Position::new(0, 2),
            end: Position::new(0, 3),
        };
        apply_change(&mut rope, Some(range), "Y");
        assert_eq!(rope.to_string(), "\u{1F600}Y");
    }

    #[test]
    fn apply_change_clamps_out_of_range_positions() {
        let mut rope = Rope::from_str("hi");
        let range = Range {
            start: Position::new(9, 9),
            end: Position::new(9, 20),
        };
        // Must not panic; clamps to end-of-document (a no-op insert of "!").
        apply_change(&mut rope, Some(range), "!");
        assert_eq!(rope.to_string(), "hi!");
    }
}
