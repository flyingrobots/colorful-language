//! Domain types and ports for `colorful-language`.
//!
//! This crate is the pure core of the hexagon: it holds the vocabulary every
//! adapter speaks (spans, parts of speech, the shallow syntax tree) and the
//! load-bearing ports — [`Parser`] (text to structure), [`Lexicon`] (a word in
//! isolation to a part-of-speech class), and [`Annotator`] (a parsed tree to a
//! classified token stream, with context). It performs no I/O.
//!
//! The boundary between *structure* ([`Parser`]), context-free *lexical lookup*
//! ([`Lexicon`]), and context-aware *classification* ([`Annotator`]) is the
//! central design commitment; see `docs/design/0002`.

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

    /// Length of the span in bytes. Saturates to `0` for a malformed (reversed)
    /// span rather than underflowing; a span from [`Parser::parse`] is always
    /// well formed.
    #[must_use]
    pub fn len(self) -> usize {
        self.end.saturating_sub(self.start)
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
    /// `not`, `never`, and the `n't` of negative contractions.
    Negator,
}

/// The broad open-class part of speech for content words.
///
/// Open-class words are the productive content classes that can accept new
/// members over time. Ambiguous words may remain [`PosClass::Content`] until an
/// annotator has enough context to choose one of these kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OpenClassKind {
    /// A common noun.
    Noun,
    /// A lexical verb.
    Verb,
    /// An adjective.
    Adjective,
    /// An adverb.
    Adverb,
}

/// The part-of-speech class assigned to a token.
///
/// [`Content`](PosClass::Content) means an open-class word whose specific kind
/// is still unknown. [`Open`](PosClass::Open) carries an explicit noun, verb,
/// adjective, or adverb decision from a richer dictionary or contextual
/// annotator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PosClass {
    /// A closed-class function word, tagged with its [`FunctionKind`].
    Function(FunctionKind),
    /// An open-class word whose noun/verb/adjective/adverb role is unknown.
    Content,
    /// An open-class word tagged as noun, verb, adjective, or adverb.
    Open(OpenClassKind),
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

/// How serious a [`Finding`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Severity {
    /// A problem worth fixing (a run-on sentence, say).
    Warning,
    /// An advisory observation (a filler word, say).
    Info,
}

/// The rule that produced a [`Finding`].
///
/// Each rule carries a stable [`code`](Rule::code) that both surfaces use
/// verbatim — the CLI prints it as a `[tag]`, the language server sets it as the
/// diagnostic `code` — so a rule is identified the same way everywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Rule {
    /// A weak or filler word (`very`, `really`, `just`, ...).
    WeakWord,
    /// A sentence longer than the run-on threshold.
    RunOn,
    /// A sentence far longer than the document's mean sentence length.
    LengthOutlier,
    /// A passive-voice candidate: a `be`-auxiliary then a past participle.
    PassiveVoice,
}

impl Rule {
    /// The stable, machine-readable code for this rule (e.g. `"run-on"`).
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Rule::WeakWord => "weak-word",
            Rule::RunOn => "run-on",
            Rule::LengthOutlier => "length-outlier",
            Rule::PassiveVoice => "passive-voice",
        }
    }
}

/// A single lint finding: a span of source flagged by a [`Rule`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// The span the finding covers.
    pub span: Span,
    /// The rule that produced the finding.
    pub rule: Rule,
    /// How serious the finding is.
    pub severity: Severity,
    /// A human-readable description of what was flagged.
    pub message: String,
}

/// Port: turn source text into shallow structure. Knows nothing about meaning.
pub trait Parser {
    /// Parse `text` into a [`Tree`]. Implementations must be total: any input,
    /// including malformed or adversarial text, yields a tree without panicking.
    fn parse(&self, text: &str) -> Tree;
}

/// Port: classify a single word's lexeme into a [`PosClass`], **in isolation**.
///
/// A `Lexicon` is a dictionary: it sees one word with no surrounding context, so
/// it can return closed-class words, numbers, unknown content, or an open-class
/// tag for unambiguous entries. Context-dependent decisions — the proper-noun
/// heuristic, and telling ambiguous words such as `book` or `record` apart as a
/// noun or verb — are the job of an [`Annotator`], not a `Lexicon`.
pub trait Lexicon {
    /// Classify `word` in isolation.
    fn classify(&self, word: &str) -> PosClass;
}

/// Port: annotate a parsed [`Tree`] with a classified [`Token`] stream, using
/// whatever context the implementation needs.
///
/// This is the seam that keeps the architecture honest. The `v0`
/// [`LexicalAnnotator`] composes a [`Lexicon`] with shallow heuristics, but a
/// future contextual or machine-learning annotator can replace it behind this
/// port — distinguishing noun from verb using the surrounding [`Tree`] — without
/// touching the parser, the CLI, or the language server.
pub trait Annotator {
    /// Produce the classified tokens for `source`, given its parsed `tree`, in
    /// source order.
    fn annotate(&self, source: &str, tree: &Tree) -> Vec<Token>;
}

/// Port: inspect a classified document and report prose [`Finding`]s.
///
/// An `Analyzer` sees the `source`, its parsed [`Tree`], and the classified
/// [`Token`] stream an [`Annotator`] produced, so a rule can reason about both
/// structure (sentences) and part of speech (auxiliaries, function words)
/// without re-parsing. Like the other ports it performs no I/O; the rule pack
/// that implements it is an adapter (the `colorful-lint` crate), so new rules
/// never touch the parser, the lexicon, or the surfaces.
pub trait Analyzer {
    /// Produce the findings for `source`, given its parsed `tree` and the
    /// classified `tokens`, in source order.
    fn analyze(&self, source: &str, tree: &Tree, tokens: &[Token]) -> Vec<Finding>;
}

/// The `v0` [`Annotator`]: a [`Lexicon`] plus shallow, deterministic heuristics.
///
/// - [`Node::Word`] spans are classified by the lexicon, then a proper-noun
///   heuristic upgrades a capitalized, non-sentence-initial [`PosClass::Content`]
///   word to [`PosClass::ProperNoun`].
/// - [`Node::Punct`] spans are classified structurally as [`PosClass::Quote`] or
///   [`PosClass::Punctuation`].
#[derive(Debug, Default, Clone, Copy)]
pub struct LexicalAnnotator<L> {
    lexicon: L,
}

impl<L: Lexicon> LexicalAnnotator<L> {
    /// Create an annotator over `lexicon`.
    pub fn new(lexicon: L) -> Self {
        Self { lexicon }
    }
}

impl<L: Lexicon> Annotator for LexicalAnnotator<L> {
    fn annotate(&self, source: &str, tree: &Tree) -> Vec<Token> {
        let mut tokens = Vec::new();
        let Node::Document(sentences) = &tree.root else {
            return tokens;
        };
        let mut prev_end = 0usize;
        let mut line_known = false;
        let mut line_is_title = false;
        for sentence in sentences {
            let Node::Sentence { parts, .. } = sentence else {
                continue;
            };
            // A word is "sentence-initial" until the first word of the sentence
            // is seen, and "line-initial" again after a line break.
            let mut seen_word = false;
            for part in parts {
                match part {
                    Node::Word { span } => {
                        let crossed_line = !line_known
                            || source
                                .get(prev_end..span.start)
                                .is_some_and(|gap| gap.contains(['\n', '\r']));
                        if crossed_line {
                            seen_word = false;
                            line_is_title =
                                line_is_title_case(&self.lexicon, line_of(source, span.start));
                            line_known = true;
                        }

                        let text = span.slice(source);
                        let mut class = self.lexicon.classify(text);
                        if matches!(class, PosClass::Content | PosClass::Open(_))
                            && seen_word
                            && !line_is_title
                            && is_capitalized(text)
                        {
                            class = PosClass::ProperNoun;
                        }
                        // Only an alphabetic word makes the next capital
                        // "mid-sentence"; a leading number must not.
                        if text.chars().next().is_some_and(char::is_alphabetic) {
                            seen_word = true;
                        }
                        prev_end = span.end;
                        tokens.push(Token { span: *span, class });
                    }
                    Node::Punct { span } => {
                        let class = if is_quote(span.slice(source)) {
                            PosClass::Quote
                        } else {
                            PosClass::Punctuation
                        };
                        prev_end = span.end;
                        tokens.push(Token { span: *span, class });
                    }
                    _ => {}
                }
            }
        }
        tokens
    }
}

/// Whether the first character of `word` is uppercase.
fn is_capitalized(word: &str) -> bool {
    word.chars().next().is_some_and(char::is_uppercase)
}

/// The line (between line breaks) of `source` containing byte offset `byte`.
fn line_of(source: &str, byte: usize) -> &str {
    let start = source[..byte].rfind(['\n', '\r']).map_or(0, |i| i + 1);
    let end = source[byte..]
        .find(['\n', '\r'])
        .map_or(source.len(), |i| byte + i);
    &source[start..end]
}

/// Whether `line` looks like a title-case header: at least two words, at least
/// two capitalized, and **no lowercase content word** (every lowercase word is a
/// function word, as a title lowercases only short function words). On such a
/// line the proper-noun heuristic is suppressed, so a `# Working Agreement for
/// Agents` header is not painted as a row of proper nouns.
fn line_is_title_case<L: Lexicon + ?Sized>(lexicon: &L, line: &str) -> bool {
    let mut words = 0usize;
    let mut capitalized = 0usize;
    for word in line.split(|c: char| !(c.is_alphabetic() || c == '\'' || c == '\u{2019}')) {
        if word.is_empty() {
            continue;
        }
        words += 1;
        if is_capitalized(word) {
            capitalized += 1;
        } else if !matches!(lexicon.classify(word), PosClass::Function(_)) {
            // A lowercase content word means this is prose, not a title.
            return false;
        }
    }
    words >= 2 && capitalized >= 2
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

    /// A lexicon stub: function words from a tiny table, digits as numbers, else
    /// content. Lets the core test [`LexicalAnnotator`] without the real lexicon.
    struct StubLexicon;

    impl Lexicon for StubLexicon {
        fn classify(&self, word: &str) -> PosClass {
            match word.to_ascii_lowercase().as_str() {
                "the" => PosClass::Function(FunctionKind::Article),
                "and" => PosClass::Function(FunctionKind::Conjunction),
                "for" => PosClass::Function(FunctionKind::Preposition),
                _ if word.chars().all(|c| c.is_ascii_digit()) && !word.is_empty() => {
                    PosClass::Number
                }
                _ => PosClass::Content,
            }
        }
    }

    /// Annotate `tree`/`source` with the stub lexicon.
    fn annotate(tree: &Tree, source: &str) -> Vec<Token> {
        LexicalAnnotator::new(StubLexicon).annotate(source, tree)
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
    fn span_len_is_saturating_on_a_reversed_span() {
        // A hand-built reversed span (bypassing `new`) must not underflow-panic.
        let reversed = Span { start: 5, end: 2 };
        assert_eq!(reversed.len(), 0);
    }

    #[test]
    fn classifies_function_content_and_number() {
        // "The cat ate 3" -> Article, Content, Content, Number
        let src = "The cat ate 3";
        let tree = Tree::document(vec![sentence(
            (0, 13),
            vec![word(0, 3), word(4, 7), word(8, 11), word(12, 13)],
        )]);
        let toks = annotate(&tree, src);
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
        let toks = annotate(&tree, src);
        let classes: Vec<PosClass> = toks.iter().map(|t| t.class).collect();
        assert_eq!(
            classes,
            vec![PosClass::Content, PosClass::Content, PosClass::ProperNoun]
        );
    }

    #[test]
    fn proper_noun_heuristic_upgrades_mid_sentence_open_class_capitals() {
        struct SeedStub;

        impl Lexicon for SeedStub {
            fn classify(&self, word: &str) -> PosClass {
                if word.eq_ignore_ascii_case("cat") {
                    PosClass::Open(OpenClassKind::Noun)
                } else {
                    PosClass::Content
                }
            }
        }

        let src = "we saw Cat";
        let tree = Tree::document(vec![sentence(
            (0, 10),
            vec![word(0, 2), word(3, 6), word(7, 10)],
        )]);
        let toks = LexicalAnnotator::new(SeedStub).annotate(src, &tree);
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
        let toks = annotate(&tree, src);
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
        assert!(annotate(&tree, "").is_empty());
    }

    #[test]
    fn line_break_resets_sentence_initial_guard() {
        // "Hello\nWorld" is one sentence (no terminator); the newline makes
        // "World" line-initial, so it is not upgraded to a proper noun.
        let src = "Hello\nWorld";
        let tree = Tree::document(vec![sentence((0, 11), vec![word(0, 5), word(6, 11)])]);
        assert_eq!(
            annotate(&tree, src)
                .iter()
                .map(|t| t.class)
                .collect::<Vec<_>>(),
            vec![PosClass::Content, PosClass::Content]
        );
    }

    #[test]
    fn a_leading_number_does_not_flip_the_proper_noun_guard() {
        // "3 Apples": the only preceding token is a number, so "Apples" is still
        // line-initial (Content), not a mid-sentence proper noun.
        let src = "3 Apples";
        let tree = Tree::document(vec![sentence((0, 8), vec![word(0, 1), word(2, 8)])]);
        assert_eq!(
            annotate(&tree, src)
                .iter()
                .map(|t| t.class)
                .collect::<Vec<_>>(),
            vec![PosClass::Number, PosClass::Content]
        );
    }

    #[test]
    fn title_case_line_suppresses_proper_nouns() {
        // A title-case header (capitalized content words around a lowercase
        // function word) must not turn every word into a proper noun.
        let src = "Working Agreement for Agents";
        let tree = Tree::document(vec![sentence(
            (0, 28),
            vec![word(0, 7), word(8, 17), word(18, 21), word(22, 28)],
        )]);
        assert_eq!(
            annotate(&tree, src)
                .iter()
                .map(|t| t.class)
                .collect::<Vec<_>>(),
            vec![
                PosClass::Content,
                PosClass::Content,
                PosClass::Function(FunctionKind::Preposition),
                PosClass::Content,
            ]
        );
    }

    #[test]
    fn annotator_port_is_independently_implementable() {
        // Proves the seam is real: a contextual annotator can replace the
        // lexical one behind the `Annotator` port with no lexicon at all. This is
        // exactly what Goalpost 2's noun/verb disambiguation needs.
        struct ContextOnly;
        impl Annotator for ContextOnly {
            fn annotate(&self, _source: &str, tree: &Tree) -> Vec<Token> {
                let Node::Document(sentences) = &tree.root else {
                    return vec![];
                };
                // A stand-in that uses tree position, not the word: first word of
                // each sentence is "Content", the rest "ProperNoun".
                let mut out = Vec::new();
                for sentence in sentences {
                    let Node::Sentence { parts, .. } = sentence else {
                        continue;
                    };
                    let mut first = true;
                    for part in parts {
                        if let Node::Word { span } = part {
                            let class = if first {
                                PosClass::Content
                            } else {
                                PosClass::ProperNoun
                            };
                            first = false;
                            out.push(Token { span: *span, class });
                        }
                    }
                }
                out
            }
        }

        let tree = Tree::document(vec![sentence((0, 9), vec![word(0, 3), word(4, 9)])]);
        let toks = ContextOnly.annotate("abc defgh", &tree);
        assert_eq!(
            toks.iter().map(|t| t.class).collect::<Vec<_>>(),
            vec![PosClass::Content, PosClass::ProperNoun]
        );
    }

    #[test]
    fn open_class_pos_contract_is_representable_by_annotator_port() {
        struct OpenClassOnly;

        impl Annotator for OpenClassOnly {
            fn annotate(&self, _source: &str, tree: &Tree) -> Vec<Token> {
                let Node::Document(sentences) = &tree.root else {
                    return vec![];
                };
                let mut classes = [
                    OpenClassKind::Noun,
                    OpenClassKind::Verb,
                    OpenClassKind::Adjective,
                    OpenClassKind::Adverb,
                ]
                .into_iter();
                let mut out = Vec::new();
                for sentence in sentences {
                    let Node::Sentence { parts, .. } = sentence else {
                        continue;
                    };
                    for part in parts {
                        if let (Node::Word { span }, Some(kind)) = (part, classes.next()) {
                            out.push(Token {
                                span: *span,
                                class: PosClass::Open(kind),
                            });
                        }
                    }
                }
                out
            }
        }

        let source = "cats sprint quick silently";
        let tree = Tree::document(vec![sentence(
            (0, source.len()),
            vec![word(0, 4), word(5, 11), word(12, 17), word(18, 26)],
        )]);

        let tokens = OpenClassOnly.annotate(source, &tree);
        assert_eq!(
            tokens.iter().map(|t| t.class).collect::<Vec<_>>(),
            vec![
                PosClass::Open(OpenClassKind::Noun),
                PosClass::Open(OpenClassKind::Verb),
                PosClass::Open(OpenClassKind::Adjective),
                PosClass::Open(OpenClassKind::Adverb),
            ]
        );
    }

    #[test]
    fn rule_codes_are_stable_and_distinct() {
        let rules = [
            Rule::WeakWord,
            Rule::RunOn,
            Rule::LengthOutlier,
            Rule::PassiveVoice,
        ];
        let codes: Vec<&str> = rules.iter().map(|r| r.code()).collect();
        assert_eq!(
            codes,
            ["weak-word", "run-on", "length-outlier", "passive-voice"]
        );
        // Codes are the public contract both surfaces key on; they must be unique.
        let mut sorted = codes.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes.len());
    }

    #[test]
    fn finding_carries_span_rule_severity_and_message() {
        let f = Finding {
            span: Span::new(0, 4),
            rule: Rule::RunOn,
            severity: Severity::Warning,
            message: "sentence runs to 47 words".to_string(),
        };
        assert_eq!(f.span, Span::new(0, 4));
        assert_eq!(f.rule.code(), "run-on");
        assert_eq!(f.severity, Severity::Warning);
        assert!(f.message.contains("47"));
    }

    #[test]
    fn analyzer_port_is_independently_implementable() {
        // Proves the seam is real: an analyzer can be written against the port
        // alone. This trivial one flags every sentence whose span is non-empty.
        struct EverySentence;
        impl Analyzer for EverySentence {
            fn analyze(&self, _source: &str, tree: &Tree, _tokens: &[Token]) -> Vec<Finding> {
                let Node::Document(sentences) = &tree.root else {
                    return vec![];
                };
                sentences
                    .iter()
                    .filter_map(|node| match node {
                        Node::Sentence { span, .. } if !span.is_empty() => Some(Finding {
                            span: *span,
                            rule: Rule::RunOn,
                            severity: Severity::Warning,
                            message: "stub".to_string(),
                        }),
                        _ => None,
                    })
                    .collect()
            }
        }

        let tree = Tree::document(vec![sentence((0, 5), vec![word(0, 5)])]);
        let findings = EverySentence.analyze("hello", &tree, &[]);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].span, Span::new(0, 5));
    }
}
