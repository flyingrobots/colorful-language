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

use colorful_core::{Annotator, Parser, PosClass};
use ropey::Rope;
use tower_lsp::lsp_types::{Position, Range, SemanticToken, SemanticTokenType};

/// The semantic-token legend, in index order. `v0` maps onto standard token
/// types so existing editor themes color prose without extra configuration.
#[must_use]
pub fn legend_token_types() -> Vec<SemanticTokenType> {
    vec![
        SemanticTokenType::KEYWORD,  // 0: function words
        SemanticTokenType::CLASS,    // 1: proper nouns
        SemanticTokenType::VARIABLE, // 2: content words
        SemanticTokenType::NUMBER,   // 3: numbers
        SemanticTokenType::STRING,   // 4: quotes
    ]
}

/// The legend index for a class, or `None` for classes left unstyled
/// (punctuation).
fn token_type_index(class: PosClass) -> Option<u32> {
    Some(match class {
        PosClass::Function(_) => 0,
        PosClass::ProperNoun => 1,
        PosClass::Content => 2,
        PosClass::Number => 3,
        PosClass::Quote => 4,
        PosClass::Punctuation => return None,
    })
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
}

/// The number of UTF-16 code units in `s`.
fn utf16_len(s: &str) -> u32 {
    s.chars().map(|c| c.len_utf16() as u32).sum()
}

/// Compute the delta-encoded LSP semantic tokens for `text`.
///
/// Words are classified through `parser` and `annotator`; punctuation is left
/// unstyled. Token types index into [`legend_token_types`].
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

/// Apply one LSP content change to a [`Rope`] document mirror.
///
/// A change with no range replaces the whole document; otherwise the range
/// (whose columns are UTF-16 code units) is removed and `text` inserted. Out-of
/// range positions are clamped so malformed edits cannot panic.
pub fn apply_change(rope: &mut Rope, range: Option<Range>, text: &str) {
    match range {
        None => *rope = Rope::from_str(text),
        Some(range) => {
            let start = position_to_char(rope, range.start);
            let end = position_to_char(rope, range.end).max(start);
            rope.remove(start..end);
            rope.insert(start, text);
        }
    }
}

/// Convert an LSP [`Position`] (line, UTF-16 column) to a char index in `rope`.
///
/// The line is clamped to the document, and the character is clamped to that
/// line's content length (excluding its line terminator) — per the LSP spec, a
/// character past the line's length clamps to the line's end, never spilling
/// into the next line.
fn position_to_char(rope: &Rope, pos: Position) -> usize {
    let last_line = rope.len_lines().saturating_sub(1);
    let line = (pos.line as usize).min(last_line);
    let line_start_char = rope.line_to_char(line);

    // End of this line's *content*: the line slice minus any trailing line break.
    let line_text = rope.line(line).to_string();
    let content_chars = line_text.trim_end_matches(['\r', '\n']).chars().count();
    let line_end_char = line_start_char + content_chars;

    let line_start_cu = rope.char_to_utf16_cu(line_start_char);
    let line_end_cu = rope.char_to_utf16_cu(line_end_char);
    let target_cu = (line_start_cu + pos.character as usize).min(line_end_cu);
    rope.utf16_cu_to_char(target_cu)
}

#[cfg(test)]
mod tests {
    use super::*;
    use colorful_core::LexicalAnnotator;
    use colorful_lexicon::ClosedClassLexicon;
    use colorful_parse::ProseParser;

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

    #[test]
    fn single_line_tokens_are_delta_encoded() {
        // "The cat is 3." -> keyword, variable, keyword, number ('.' unstyled).
        assert_eq!(
            semantic_tokens("The cat is 3."),
            vec![
                tok(0, 0, 3, 0), // The
                tok(0, 4, 3, 2), // cat
                tok(0, 4, 2, 0), // is
                tok(0, 3, 1, 3), // 3
            ]
        );
    }

    #[test]
    fn newlines_advance_the_line_delta() {
        // Sentence-initial "Hi"/"Go" stay content; terminators are unstyled.
        assert_eq!(
            semantic_tokens("Hi.\nGo."),
            vec![
                tok(0, 0, 2, 2), // Hi (line 0)
                tok(1, 0, 2, 2), // Go (line 1, delta_start resets to absolute)
            ]
        );
    }

    #[test]
    fn columns_count_utf16_code_units_not_bytes() {
        // A leading emoji is 4 bytes but 2 UTF-16 code units; "ok" must report
        // column 3 (emoji=2 + space=1), not byte offset 5.
        assert_eq!(semantic_tokens("\u{1F600} ok"), vec![tok(0, 3, 2, 2)]);
    }

    #[test]
    fn line_index_handles_bare_carriage_return() {
        // A lone '\r' is a line break per the LSP spec, so "2" is on line 1.
        // (Numbers survive skeleton coloring, keeping this assertion stable.)
        assert_eq!(
            semantic_tokens("1.\r2"),
            vec![tok(0, 0, 1, 3), tok(1, 0, 1, 3)]
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
