//! Domain types and ports for `colorful-language`.
//!
//! This crate is the pure core of the hexagon: it holds the vocabulary every
//! adapter speaks (spans, parts of speech, the shallow syntax tree) and the two
//! load-bearing ports — [`Parser`] (text to structure) and [`Tagger`] (a word to
//! a part-of-speech class). It performs no I/O.
//!
//! The boundary between *structure* ([`Parser`]) and *classification*
//! ([`Tagger`]) is the central design commitment; see `docs/design/0002`.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

/// A byte range into a source document: `[start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Span {
    /// Byte offset of the first byte (inclusive).
    pub start: usize,
    /// Byte offset one past the last byte (exclusive).
    pub end: usize,
}

impl Span {
    /// Create a span from a start and end byte offset.
    #[must_use]
    pub fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end, "span start must not exceed end");
        Self { start, end }
    }

    /// Length of the span in bytes.
    #[must_use]
    pub fn len(self) -> usize {
        self.end - self.start
    }

    /// Whether the span is empty.
    #[must_use]
    pub fn is_empty(self) -> bool {
        self.start == self.end
    }

    /// Borrow the slice of `source` this span covers.
    ///
    /// Returns `""` if the span lies outside `source` (a defensive guard; a span
    /// produced by a [`Parser`] over `source` is always in bounds).
    #[must_use]
    pub fn slice(self, source: &str) -> &str {
        source.get(self.start..self.end).unwrap_or("")
    }
}

/// The category of a closed-class ("function") word. These are the finite,
/// enumerable word classes that behave like programming-language keywords.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FunctionKind {
    /// `a`, `an`, `the`.
    Article,
    /// `of`, `in`, `on`, `with`, ...
    Preposition,
    /// `and`, `but`, `or`, `because`, ...
    Conjunction,
    /// `i`, `you`, `they`, `who`, ...
    Pronoun,
    /// `is`, `was`, `have`, `will`, `can`, ...
    Auxiliary,
    /// `this`, `each`, `some`, `my`, ...
    Determiner,
}

/// The part-of-speech class assigned to a token.
///
/// `v0` is deliberately coarse: open-class words are undifferentiated
/// [`Content`](PosClass::Content). Telling nouns from verbs is a later goalpost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PosClass {
    /// A closed-class function word, tagged with its [`FunctionKind`].
    Function(FunctionKind),
    /// An open-class word, undifferentiated in `v0`.
    Content,
    /// A capitalized, mid-sentence word treated as a proper noun (heuristic).
    ProperNoun,
    /// A numeric token.
    Number,
    /// Structural punctuation.
    Punctuation,
    /// A quotation mark.
    Quote,
}

/// A node in the shallow prose syntax tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// The document root: a sequence of sentences.
    Document(Vec<Node>),
    /// A sentence: a run of words and punctuation, optionally terminated.
    Sentence {
        /// The span covering the whole sentence.
        span: Span,
        /// The words and punctuation that make up the sentence, in order.
        parts: Vec<Node>,
    },
    /// A single word (alphabetic run or number). Unclassified at parse time.
    Word {
        /// The span covering the word.
        span: Span,
    },
    /// A single punctuation or quotation token.
    Punct {
        /// The span covering the punctuation.
        span: Span,
    },
}

/// A parsed document: the root [`Node`] plus the conveniences to walk it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tree {
    /// The root node, always [`Node::Document`].
    pub root: Node,
}

impl Tree {
    /// Wrap a sequence of sentence nodes into a document tree.
    #[must_use]
    pub fn document(sentences: Vec<Node>) -> Self {
        Self {
            root: Node::Document(sentences),
        }
    }
}

/// A classified token: a span paired with the part of speech assigned to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Token {
    /// The span the token covers.
    pub span: Span,
    /// The part-of-speech class assigned to the span.
    pub class: PosClass,
}

/// Port: turn source text into shallow structure. Knows nothing about meaning.
pub trait Parser {
    /// Parse `text` into a [`Tree`]. Implementations must be total: any input,
    /// including malformed or adversarial text, yields a tree without panicking.
    fn parse(&self, text: &str) -> Tree;
}

/// Port: classify a single word into a [`PosClass`].
///
/// Implementations classify a word in isolation. Context-dependent refinements
/// (such as the proper-noun heuristic) are applied by [`classify`], not here.
pub trait Tagger {
    /// Classify `word`. Returns one of [`PosClass::Function`],
    /// [`PosClass::Number`], or [`PosClass::Content`].
    fn classify(&self, word: &str) -> PosClass;
}

/// Walk a [`Tree`] and produce the classified [`Token`] stream for `source`.
///
/// This is the application service that ties the two ports together:
///
/// - [`Node::Word`] spans are classified by `tagger`, then a proper-noun
///   heuristic upgrades a capitalized, non-sentence-initial [`PosClass::Content`]
///   word to [`PosClass::ProperNoun`].
/// - [`Node::Punct`] spans are classified structurally as [`PosClass::Quote`] or
///   [`PosClass::Punctuation`].
///
/// Tokens are returned in source order.
#[must_use]
pub fn classify<T: Tagger + ?Sized>(tree: &Tree, source: &str, tagger: &T) -> Vec<Token> {
    let mut tokens = Vec::new();
    let Node::Document(sentences) = &tree.root else {
        return tokens;
    };
    for sentence in sentences {
        let Node::Sentence { parts, .. } = sentence else {
            continue;
        };
        let mut seen_word = false;
        for part in parts {
            match part {
                Node::Word { span } => {
                    let text = span.slice(source);
                    let mut class = tagger.classify(text);
                    if class == PosClass::Content && seen_word && is_capitalized(text) {
                        class = PosClass::ProperNoun;
                    }
                    seen_word = true;
                    tokens.push(Token { span: *span, class });
                }
                Node::Punct { span } => {
                    let class = if is_quote(span.slice(source)) {
                        PosClass::Quote
                    } else {
                        PosClass::Punctuation
                    };
                    tokens.push(Token { span: *span, class });
                }
                _ => {}
            }
        }
    }
    tokens
}

/// Whether the first character of `word` is uppercase.
fn is_capitalized(word: &str) -> bool {
    word.chars().next().is_some_and(char::is_uppercase)
}

/// Whether `s` is composed entirely of quotation marks.
fn is_quote(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| {
            matches!(
                c,
                '"' | '\''
                    | '\u{201C}'
                    | '\u{201D}'
                    | '\u{2018}'
                    | '\u{2019}'
                    | '\u{00AB}'
                    | '\u{00BB}'
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tagger stub: function words from a tiny table, digits as numbers, else
    /// content. Lets the core test [`classify`] without the real lexicon.
    struct StubTagger;

    impl Tagger for StubTagger {
        fn classify(&self, word: &str) -> PosClass {
            match word.to_ascii_lowercase().as_str() {
                "the" => PosClass::Function(FunctionKind::Article),
                "and" => PosClass::Function(FunctionKind::Conjunction),
                _ if word.chars().all(|c| c.is_ascii_digit()) && !word.is_empty() => {
                    PosClass::Number
                }
                _ => PosClass::Content,
            }
        }
    }

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

    fn sentence(span: (usize, usize), parts: Vec<Node>) -> Node {
        Node::Sentence {
            span: Span::new(span.0, span.1),
            parts,
        }
    }

    #[test]
    fn span_slice_is_in_bounds_and_oob_safe() {
        let s = "hello";
        assert_eq!(Span::new(0, 5).slice(s), "hello");
        assert_eq!(Span::new(1, 4).slice(s), "ell");
        assert_eq!(Span::new(10, 20).slice(s), "");
        assert_eq!(Span::new(0, 5).len(), 5);
        assert!(Span::new(3, 3).is_empty());
    }

    #[test]
    fn classifies_function_content_and_number() {
        // "The cat ate 3" -> Article, Content, Content, Number
        let src = "The cat ate 3";
        let tree = Tree::document(vec![sentence(
            (0, 13),
            vec![word(0, 3), word(4, 7), word(8, 11), word(12, 13)],
        )]);
        let toks = classify(&tree, src, &StubTagger);
        let classes: Vec<PosClass> = toks.iter().map(|t| t.class).collect();
        assert_eq!(
            classes,
            vec![
                PosClass::Function(FunctionKind::Article),
                PosClass::Content,
                PosClass::Content,
                PosClass::Number,
            ]
        );
    }

    #[test]
    fn proper_noun_heuristic_upgrades_only_mid_sentence_capitals() {
        // "Dogs love Paris" -> sentence-initial "Dogs" stays Content (we cannot
        // tell it from a common noun), but mid-sentence "Paris" becomes ProperNoun.
        let src = "Dogs love Paris";
        let tree = Tree::document(vec![sentence(
            (0, 15),
            vec![word(0, 4), word(5, 9), word(10, 15)],
        )]);
        let toks = classify(&tree, src, &StubTagger);
        let classes: Vec<PosClass> = toks.iter().map(|t| t.class).collect();
        assert_eq!(
            classes,
            vec![PosClass::Content, PosClass::Content, PosClass::ProperNoun]
        );
    }

    #[test]
    fn punctuation_and_quotes_classified_structurally() {
        // `"hi".`  -> Quote, Content, Quote, Punctuation
        let src = "\"hi\".";
        let tree = Tree::document(vec![sentence(
            (0, 5),
            vec![punct(0, 1), word(1, 3), punct(3, 4), punct(4, 5)],
        )]);
        let toks = classify(&tree, src, &StubTagger);
        let classes: Vec<PosClass> = toks.iter().map(|t| t.class).collect();
        assert_eq!(
            classes,
            vec![
                PosClass::Quote,
                PosClass::Content,
                PosClass::Quote,
                PosClass::Punctuation,
            ]
        );
    }

    #[test]
    fn empty_document_yields_no_tokens() {
        let tree = Tree::document(vec![]);
        assert!(classify(&tree, "", &StubTagger).is_empty());
    }
}
