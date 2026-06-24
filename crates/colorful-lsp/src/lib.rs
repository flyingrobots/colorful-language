//! Pure building blocks for the prose language server.
//!
//! The server itself (the `colorful-lsp` binary) is thin glue over these
//! functions: turn a document into LSP semantic tokens
//! ([`compute_semantic_tokens`]), apply an incremental edit to a [`Rope`] mirror
//! ([`apply_change`]), and describe the token legend ([`legend_token_types`]).
//!
//! Keeping this logic here — free of async and transport — is what makes the
//! UTF-16 position arithmetic and the delta encoding unit-testable.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::collections::HashMap;
use std::sync::OnceLock;

use colorful_core::{Analyzer, Annotator, Parser, PosClass, Severity};
use ropey::Rope;
use tower_lsp::lsp_types::{
    Diagnostic, DiagnosticSeverity, NumberOrString, Position, Range, SemanticToken,
    SemanticTokenType,
};

/// The semantic-token legend, in index order, derived from the
/// `colorful.vocabulary/v1` manifest (the distinct LSP token types its roles
/// project to). `v0` is a *skeleton* highlighter: it accentuates structure
/// (function words, proper nouns, numbers, quotes) and leaves ordinary content
/// unstyled. The types are standard, so existing editor themes color prose with
/// no extra configuration, and they stay in lock-step with the CLI and graft
/// because all three read the same manifest.
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
/// [`legend_token_types`]. Content words and punctuation project to no token
/// (skeleton mode).
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
    let name = colorful_ir::vocabulary::projection(&role)
        .lsp_token_type
        .as_deref()?;
    token_type_index.get(name).copied()
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

/// Compute the delta-encoded LSP semantic tokens for `text`.
///
/// Words are classified through `parser` and `annotator`; content words and
/// punctuation are left unstyled (skeleton mode). Token types index into
/// [`legend_token_types`].
#[must_use]
pub fn compute_semantic_tokens<P, A>(text: &str, parser: &P, annotator: &A) -> Vec<SemanticToken>
where
    P: Parser,
    A: Annotator,
{
    let tree = parser.parse(text);
    let tokens = annotator.annotate(text, &tree);
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
#[must_use]
pub fn compute_diagnostics<P, A, An>(
    text: &str,
    parser: &P,
    annotator: &A,
    analyzer: &An,
) -> Vec<Diagnostic>
where
    P: Parser,
    A: Annotator,
    An: Analyzer,
{
    let tree = parser.parse(text);
    let tokens = annotator.annotate(text, &tree);
    let findings = analyzer.analyze(text, &tree, &tokens);
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
    use colorful_core::LexicalAnnotator;
    use colorful_lexicon::ClosedClassLexicon;
    use colorful_parse::ProseParser;
    use tower_lsp::lsp_types::Position;

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
            &LexicalAnnotator::new(ClosedClassLexicon::new()),
        )
    }

    fn diagnostics(text: &str) -> Vec<Diagnostic> {
        compute_diagnostics(
            text,
            &ProseParser::new(),
            &LexicalAnnotator::new(ClosedClassLexicon::new()),
            &colorful_lint::ProseLinter::new(),
        )
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
        // "The cat is 3." -> keyword, keyword, number. "cat" is content and the
        // '.' is punctuation, so both are unstyled (skeleton mode); the deltas
        // skip over them.
        assert_eq!(
            semantic_tokens("The cat is 3."),
            vec![
                tok(0, 0, 3, 0), // The (keyword)
                tok(0, 8, 2, 0), // is  (keyword; delta over the skipped "cat")
                tok(0, 3, 1, 2), // 3   (number)
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
