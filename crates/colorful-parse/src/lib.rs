//! The structural prose parser — a [`Parser`] adapter.
//!
//! A `logos` lexer turns text into mechanical tokens (words, numbers, sentence
//! terminators, quotes, punctuation), and a small recursive-descent pass groups
//! them into [`Node::Sentence`] runs. The parser produces *structure only* — it
//! makes no part-of-speech decisions; that is the `Tagger`'s job.
//!
//! Parsing is **total**: any input, including malformed or non-ASCII text,
//! yields a [`Tree`] without panicking. Characters the lexer cannot otherwise
//! classify are emitted as punctuation rather than dropped.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use colorful_core::{Node, Parser, Span, Tree};
use logos::Logos;

/// Mechanical token kinds produced by the lexer.
#[derive(Logos, Debug, PartialEq, Eq)]
#[logos(skip r"[ \t\r\n\u{000C}\u{00A0}]+")]
enum Tok {
    /// An alphabetic word, allowing internal apostrophes and hyphens
    /// (`don't`, `well-being`).
    #[regex(r"\p{L}+(?:['\u{2019}\-]\p{L}+)*")]
    Word,
    /// A numeric token with optional internal separators (`150`, `3.14`,
    /// `1,000`).
    #[regex(r"\p{N}+(?:[.,]\p{N}+)*")]
    Number,
    /// A run of sentence-ending punctuation (`.`, `!`, `?`, `?!`, `...`).
    #[regex(r"[.!?]+")]
    SentenceEnd,
    /// A quotation mark (straight or typographic).
    #[regex(r#"["'\u{201C}\u{201D}\u{2018}\u{2019}\u{00AB}\u{00BB}]"#)]
    Quote,
    /// Other punctuation.
    #[regex(r"[,;:\u{2026}\u{2014}\u{2013}()\[\]{}/\\@#$%^&*+=<>~|_-]")]
    Punct,
}

/// The structural prose parser.
#[derive(Debug, Default, Clone, Copy)]
pub struct ProseParser;

impl ProseParser {
    /// Create a new parser.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Parser for ProseParser {
    fn parse(&self, text: &str) -> Tree {
        let mut sentences: Vec<Node> = Vec::new();
        let mut parts: Vec<Node> = Vec::new();
        let mut sent_start: usize = 0;
        let mut sent_end: usize = 0;

        let mut lexer = Tok::lexer(text);
        while let Some(result) = lexer.next() {
            let range = lexer.span();
            let span = Span::new(range.start, range.end);
            if parts.is_empty() {
                sent_start = span.start;
            }
            sent_end = span.end;

            let (node, ends_sentence) = match result {
                Ok(Tok::Word | Tok::Number) => (Node::Word { span }, false),
                Ok(Tok::SentenceEnd) => (Node::Punct { span }, true),
                // Quotes, other punctuation, and any unrecognized character all
                // become punctuation nodes — parsing stays total.
                Ok(Tok::Quote | Tok::Punct) | Err(()) => (Node::Punct { span }, false),
            };
            parts.push(node);

            if ends_sentence {
                sentences.push(Node::Sentence {
                    span: Span::new(sent_start, sent_end),
                    parts: std::mem::take(&mut parts),
                });
            }
        }

        // Flush a trailing, unterminated sentence.
        if !parts.is_empty() {
            sentences.push(Node::Sentence {
                span: Span::new(sent_start, sent_end),
                parts,
            });
        }

        Tree::document(sentences)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colorful_core::Node;

    fn word(start: usize, end: usize) -> Node {
        Node::Word {
            span: Span::new(start, end),
        }
    }

    fn punct(start: usize, end: usize) -> Node {
        Node::Punct {
            span: Span::new(start, end),
        }
    }

    fn sentence(start: usize, end: usize, parts: Vec<Node>) -> Node {
        Node::Sentence {
            span: Span::new(start, end),
            parts,
        }
    }

    fn parse(text: &str) -> Vec<Node> {
        let Node::Document(sentences) = ProseParser::new().parse(text).root else {
            unreachable!("root is always a document");
        };
        sentences
    }

    #[test]
    fn single_sentence_words_and_terminator() {
        // "The cat sat."
        assert_eq!(
            parse("The cat sat."),
            vec![sentence(
                0,
                12,
                vec![word(0, 3), word(4, 7), word(8, 11), punct(11, 12)],
            )]
        );
    }

    #[test]
    fn splits_on_sentence_terminators() {
        // "Hi. Go!"
        assert_eq!(
            parse("Hi. Go!"),
            vec![
                sentence(0, 3, vec![word(0, 2), punct(2, 3)]),
                sentence(4, 7, vec![word(4, 6), punct(6, 7)]),
            ]
        );
    }

    #[test]
    fn unterminated_text_is_one_sentence() {
        // "hello world" (no terminator) flushes as a single sentence.
        assert_eq!(
            parse("hello world"),
            vec![sentence(0, 11, vec![word(0, 5), word(6, 11)])]
        );
    }

    #[test]
    fn contractions_and_hyphens_stay_one_word() {
        assert_eq!(parse("don't"), vec![sentence(0, 5, vec![word(0, 5)])]);
        assert_eq!(
            parse("well-being"),
            vec![sentence(0, 10, vec![word(0, 10)])]
        );
    }

    #[test]
    fn quotes_are_separate_punctuation() {
        // "hi" -> quote, word, quote
        assert_eq!(
            parse("\"hi\""),
            vec![sentence(0, 4, vec![punct(0, 1), word(1, 3), punct(3, 4)])]
        );
    }

    #[test]
    fn numbers_are_word_nodes() {
        // "I have 3.5" -> three word nodes (the number is a word node).
        assert_eq!(
            parse("I have 3.5"),
            vec![sentence(0, 10, vec![word(0, 1), word(2, 6), word(7, 10)])]
        );
    }

    #[test]
    fn non_ascii_letters_join_words() {
        // "café" is a single word (é is a Unicode letter); 5 bytes.
        assert_eq!(parse("café"), vec![sentence(0, 5, vec![word(0, 5)])]);
    }

    #[test]
    fn empty_input_is_empty_document() {
        assert_eq!(parse(""), Vec::<Node>::new());
        assert_eq!(parse("   \n\t "), Vec::<Node>::new());
    }

    /// Collect the leaf (word/punct) spans of a parsed tree in order.
    fn leaf_spans(text: &str) -> Vec<Span> {
        let mut spans = Vec::new();
        let Node::Document(sentences) = ProseParser::new().parse(text).root else {
            unreachable!();
        };
        for sentence in sentences {
            let Node::Sentence { parts, .. } = sentence else {
                continue;
            };
            for part in parts {
                match part {
                    Node::Word { span } | Node::Punct { span } => spans.push(span),
                    _ => {}
                }
            }
        }
        spans
    }

    #[test]
    fn parsing_is_total_and_spans_are_well_formed() {
        // `logos` lowers its lexer to a loop only with optimizations; in debug
        // builds it recurses once per character, so a pathologically long single
        // token can exhaust a small default test stack. Shipped binaries are
        // release (no such recursion), so run the property on a generous stack to
        // exercise long tokens honestly in debug too.
        std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(check_total_and_well_formed)
            .expect("spawn checker thread")
            .join()
            .expect("parser must not panic on adversarial input");
    }

    fn check_total_and_well_formed() {
        // Adversarial inputs must not panic, and every leaf span must be
        // non-empty, in bounds, and strictly ordered (no overlaps).
        let long_word = "a".repeat(10_000);
        let inputs: [&str; 10] = [
            "",
            "?!?!?!",
            "\u{1F600}\u{1F4A9}", // emoji
            long_word.as_str(),
            "no terminator here",
            "Mix3d 1,000 things\u{2014}and \u{00AB}quotes\u{00BB}.",
            "\t\n  \u{00A0}",
            "don''t",
            "....",
            "He said \u{201C}hi\u{201D} to O'Brien.",
        ];
        for &input in &inputs {
            let spans = leaf_spans(input);
            let mut prev_end = 0usize;
            for span in spans {
                assert!(span.start < span.end, "empty span in {input:?}");
                assert!(span.end <= input.len(), "out-of-bounds span in {input:?}");
                assert!(span.start >= prev_end, "overlapping spans in {input:?}");
                assert!(
                    input.is_char_boundary(span.start) && input.is_char_boundary(span.end),
                    "span not on char boundary in {input:?}"
                );
                prev_end = span.end;
            }
        }
    }
}
