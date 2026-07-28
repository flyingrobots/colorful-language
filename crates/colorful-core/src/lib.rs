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

/// Return the byte length of the numeric-token prefix at the start of `source`.
///
/// Numeric tokens follow `N+([.,]N+)*`, where `N` is any Unicode numeric
/// character. A separator is consumed only when another numeric character
/// follows it, so malformed separators remain available to the parser as
/// punctuation. The scan is allocation-free.
///
/// ```
/// use colorful_core::numeric_prefix_len;
///
/// assert_eq!(numeric_prefix_len("1,234.56 words"), Some(8));
/// assert_eq!(numeric_prefix_len("1..2"), Some(1));
/// assert_eq!(numeric_prefix_len(".5"), None);
/// ```
#[must_use]
pub fn numeric_prefix_len(source: &str) -> Option<usize> {
    let mut characters = source.char_indices().peekable();
    let (_, first) = characters.next()?;
    if !first.is_numeric() {
        return None;
    }
    let mut end = first.len_utf8();

    loop {
        while let Some(&(index, character)) = characters.peek() {
            if !character.is_numeric() {
                break;
            }
            characters.next();
            end = index + character.len_utf8();
        }

        let Some(&(separator_index, separator)) = characters.peek() else {
            break;
        };
        if !matches!(separator, '.' | ',') {
            break;
        }

        let mut lookahead = characters.clone();
        lookahead.next();
        if !lookahead
            .peek()
            .is_some_and(|(_, character)| character.is_numeric())
        {
            break;
        }

        characters.next();
        end = separator_index + separator.len_utf8();
    }

    Some(end)
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

/// A producer's provenance: which derivation stage it fills (`pass_id`, e.g.
/// `"segment"`, `"classify"`) and which concrete rule implements it (`rule_id`,
/// e.g. `"contextual-open-class-annotator"`).
///
/// `rule_id` names the algorithm family, not a full replayable-implementation
/// digest — this is honest, checkable provenance, not executable historical
/// reconstruction.
///
/// The default (`pass_id: "", rule_id: ""`) is **invalid by construction**: a
/// [`Parser`] or [`Annotator`] that does not override [`Parser::pass_identity`]
/// / [`Annotator::pass_identity`] reports this empty identity rather than a
/// plausible-sounding placeholder, so a projection boundary can reject it
/// instead of recording a lie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PassIdentity {
    /// The derivation stage this identity fills, e.g. `"segment"`, `"classify"`.
    pub pass_id: &'static str,
    /// The concrete rule implementation, e.g. `"prose-segmenter"`.
    pub rule_id: &'static str,
}

impl PassIdentity {
    /// Whether both fields are non-empty, i.e. this is not the invalid-by-
    /// construction default.
    #[must_use]
    pub fn is_present(&self) -> bool {
        !self.pass_id.is_empty() && !self.rule_id.is_empty()
    }
}

/// Port: turn source text into shallow structure. Knows nothing about meaning.
///
/// # Examples
///
/// A parser adapter owns segmentation policy while returning the shared core
/// tree:
///
/// ```
/// # // public-api-doctest: parser
/// use colorful_core::{Node, Parser, Span, Tree};
///
/// struct WholeSourceParser;
///
/// impl Parser for WholeSourceParser {
///     fn parse(&self, text: &str) -> Tree {
///         if text.is_empty() {
///             return Tree::document(Vec::new());
///         }
///         let span = Span::new(0, text.len());
///         Tree::document(vec![Node::Sentence {
///             span,
///             parts: vec![Node::Word { span }],
///         }])
///     }
/// }
///
/// assert_eq!(WholeSourceParser.parse(""), Tree::document(Vec::new()));
/// let source = "colorful";
/// let tree = WholeSourceParser.parse(source);
/// assert_eq!(
///     tree,
///     Tree::document(vec![Node::Sentence {
///         span: Span::new(0, 8),
///         parts: vec![Node::Word {
///             span: Span::new(0, 8),
///         }],
///     }]),
/// );
/// ```
///
/// See the [parsing topic] for the shipped parser's behavior.
///
/// [parsing topic]: https://github.com/flyingrobots/colorful-language/blob/main/docs/topics/parsing/README.md
pub trait Parser {
    /// Parse `text` into a [`Tree`]. Implementations must be total: any input,
    /// including malformed or adversarial text, yields a tree without panicking.
    fn parse(&self, text: &str) -> Tree;

    /// This parser's provenance. The default is invalid by construction (see
    /// [`PassIdentity`]) — a production implementation must override it.
    fn pass_identity(&self) -> PassIdentity {
        PassIdentity::default()
    }
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
///
/// # Examples
///
/// An annotator reads parsed structure and emits source-ordered classifications:
///
/// ```
/// # // public-api-doctest: annotator
/// use colorful_core::{Annotator, Node, PosClass, Span, Token, Tree};
///
/// struct FirstWordAnnotator;
///
/// impl Annotator for FirstWordAnnotator {
///     fn annotate(&self, _source: &str, tree: &Tree) -> Vec<Token> {
///         let Node::Document(sentences) = &tree.root else {
///             return Vec::new();
///         };
///         let Some(Node::Sentence { parts, .. }) = sentences.first() else {
///             return Vec::new();
///         };
///         let Some(Node::Word { span }) = parts.first() else {
///             return Vec::new();
///         };
///         vec![Token {
///             span: *span,
///             class: PosClass::Content,
///         }]
///     }
/// }
///
/// let span = Span::new(0, 4);
/// let tree = Tree::document(vec![Node::Sentence {
///     span,
///     parts: vec![Node::Word { span }],
/// }]);
/// let tokens = FirstWordAnnotator.annotate("word", &tree);
/// assert_eq!(tokens[0].class, PosClass::Content);
/// assert_eq!(tokens[0].span.slice("word"), "word");
/// ```
///
/// See the [coloring topic] for the shipped annotator's behavior.
///
/// [coloring topic]: https://github.com/flyingrobots/colorful-language/blob/main/docs/topics/coloring/README.md
pub trait Annotator {
    /// Produce the classified tokens for `source`, given its parsed `tree`, in
    /// source order.
    fn annotate(&self, source: &str, tree: &Tree) -> Vec<Token>;

    /// This annotator's provenance. The default is invalid by construction
    /// (see [`PassIdentity`]) — a production implementation must override it.
    fn pass_identity(&self) -> PassIdentity {
        PassIdentity::default()
    }
}

/// One segment of a [`ClassificationPath`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClassificationPathSegment {
    /// A named field.
    Field(&'static str),
    /// An array index.
    Index(usize),
}

/// A structural path into parser/annotator output.
///
/// Paths use the public core model's field names, for example
/// `tree.root.sentences[0].parts[1].span.start` or `tokens[2].span`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ClassificationPath(Vec<ClassificationPathSegment>);

impl ClassificationPath {
    fn root(field: &'static str) -> Self {
        Self(vec![ClassificationPathSegment::Field(field)])
    }

    fn field(mut self, field: &'static str) -> Self {
        self.0.push(ClassificationPathSegment::Field(field));
        self
    }

    fn index(mut self, index: usize) -> Self {
        self.0.push(ClassificationPathSegment::Index(index));
        self
    }

    /// The path's field and index segments in traversal order.
    #[must_use]
    pub fn segments(&self) -> &[ClassificationPathSegment] {
        &self.0
    }
}

impl core::fmt::Display for ClassificationPath {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for (index, segment) in self.0.iter().enumerate() {
            match segment {
                ClassificationPathSegment::Field(field) => {
                    if index > 0 {
                        write!(f, ".")?;
                    }
                    write!(f, "{field}")?;
                }
                ClassificationPathSegment::Index(index) => write!(f, "[{index}]")?,
            }
        }
        Ok(())
    }
}

/// One typed reason parser/annotator output failed validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClassificationError {
    /// A public tree position contains a node kind that is illegal there.
    UnexpectedNodeKind {
        /// The offending tree position.
        path: ClassificationPath,
        /// The node kind required at this position.
        expected: &'static str,
        /// The node kind the parser produced.
        found: &'static str,
    },
    /// A span starts after it ends.
    ReversedSpan {
        /// The offending `.span`.
        path: ClassificationPath,
        /// The span's start offset.
        start: usize,
        /// The span's end offset.
        end: usize,
    },
    /// A span extends beyond the source.
    SpanOutOfBounds {
        /// The offending `.span.end`.
        path: ClassificationPath,
        /// The span's end offset.
        end: usize,
        /// The source length.
        length: usize,
    },
    /// A span edge splits a UTF-8 code point.
    SpanNotOnCharBoundary {
        /// The offending `.span.start` or `.span.end`.
        path: ClassificationPath,
        /// The invalid byte offset.
        offset: usize,
    },
    /// A sibling or token starts before its predecessor starts.
    UnsortedSpan {
        /// The offending `.span.start`.
        path: ClassificationPath,
        /// The preceding item index in the same list.
        previous_index: usize,
        /// The preceding span's start.
        previous_start: usize,
        /// The offending span's start.
        start: usize,
    },
    /// A sibling or token starts before its predecessor ends.
    OverlappingSpan {
        /// The offending `.span.start`.
        path: ClassificationPath,
        /// The preceding item index in the same list.
        previous_index: usize,
        /// The preceding span's end.
        previous_end: usize,
        /// The offending span's start.
        start: usize,
    },
    /// A sentence part extends outside its sentence.
    ChildSpanOutsideParent {
        /// The offending child `.span`.
        path: ClassificationPath,
        /// The sentence span.
        parent: Span,
        /// The child span.
        child: Span,
    },
    /// The annotator emitted a different number of tokens than tree leaves.
    TreeTokenCountMismatch {
        /// Always `tokens`.
        path: ClassificationPath,
        /// The number of word/punctuation leaves in the tree.
        tree_leaves: usize,
        /// The number of classified tokens.
        tokens: usize,
    },
    /// A classified token does not cover the corresponding tree leaf.
    TreeTokenSpanMismatch {
        /// The offending `tokens[i].span`.
        path: ClassificationPath,
        /// The corresponding tree leaf's `.span` path.
        tree_path: ClassificationPath,
        /// The tree leaf span.
        tree_span: Span,
        /// The classified token span.
        token_span: Span,
    },
}

impl ClassificationError {
    /// The exact public-model path where validation failed.
    #[must_use]
    pub fn path(&self) -> &ClassificationPath {
        match self {
            Self::UnexpectedNodeKind { path, .. }
            | Self::ReversedSpan { path, .. }
            | Self::SpanOutOfBounds { path, .. }
            | Self::SpanNotOnCharBoundary { path, .. }
            | Self::UnsortedSpan { path, .. }
            | Self::OverlappingSpan { path, .. }
            | Self::ChildSpanOutsideParent { path, .. }
            | Self::TreeTokenCountMismatch { path, .. }
            | Self::TreeTokenSpanMismatch { path, .. } => path,
        }
    }
}

impl core::fmt::Display for ClassificationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::UnexpectedNodeKind {
                path,
                expected,
                found,
            } => write!(f, "at {path}: expected {expected}, found {found}"),
            Self::ReversedSpan { path, start, end } => {
                write!(f, "at {path}: start {start} exceeds end {end}")
            }
            Self::SpanOutOfBounds { path, end, length } => {
                write!(f, "at {path}: {end} exceeds source length {length}")
            }
            Self::SpanNotOnCharBoundary { path, offset } => {
                write!(f, "at {path}: {offset} is not a UTF-8 character boundary")
            }
            Self::UnsortedSpan {
                path,
                previous_index,
                previous_start,
                start,
            } => write!(
                f,
                "at {path}: start {start} precedes item {previous_index} start {previous_start}"
            ),
            Self::OverlappingSpan {
                path,
                previous_index,
                previous_end,
                start,
            } => write!(
                f,
                "at {path}: start {start} overlaps item {previous_index} ending at {previous_end}"
            ),
            Self::ChildSpanOutsideParent {
                path,
                parent,
                child,
            } => write!(
                f,
                "at {path}: child {}..{} falls outside parent {}..{}",
                child.start, child.end, parent.start, parent.end
            ),
            Self::TreeTokenCountMismatch {
                path,
                tree_leaves,
                tokens,
            } => write!(
                f,
                "at {path}: tree has {tree_leaves} leaves but annotator emitted {tokens} tokens"
            ),
            Self::TreeTokenSpanMismatch {
                path,
                tree_path,
                tree_span,
                token_span,
            } => write!(
                f,
                "at {path}: token {}..{} does not match {tree_path} {}..{}",
                token_span.start, token_span.end, tree_span.start, tree_span.end
            ),
        }
    }
}

impl std::error::Error for ClassificationError {}

/// Parser and annotator output proven safe to interpret against one source.
///
/// Construction validates the public tree first, then the token stream, then
/// one-to-one tree-leaf/token correspondence. Fields are private so a
/// successful value cannot be mutated back into an invalid state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedClassification<'source> {
    source: &'source str,
    tree: Tree,
    tokens: Vec<Token>,
}

impl<'source> ValidatedClassification<'source> {
    /// Validate already-produced public tree and token values.
    ///
    /// # Errors
    ///
    /// Returns the first [`ClassificationError`] in deterministic tree, token,
    /// then correspondence order.
    pub fn new(
        source: &'source str,
        tree: Tree,
        tokens: Vec<Token>,
    ) -> Result<Self, ClassificationError> {
        validate_classification(source, &tree, &tokens)?;
        Ok(Self {
            source,
            tree,
            tokens,
        })
    }

    /// Run public parser and annotator ports, then validate their output.
    ///
    /// # Errors
    ///
    /// Returns the first [`ClassificationError`] produced by their combined
    /// output.
    pub fn from_ports<P, A>(
        source: &'source str,
        parser: &P,
        annotator: &A,
    ) -> Result<Self, ClassificationError>
    where
        P: Parser + ?Sized,
        A: Annotator + ?Sized,
    {
        let tree = parser.parse(source);
        let tokens = annotator.annotate(source, &tree);
        Self::new(source, tree, tokens)
    }

    /// The exact source this classification was validated against.
    #[must_use]
    pub fn source(&self) -> &'source str {
        self.source
    }

    /// The validated parse tree.
    #[must_use]
    pub fn tree(&self) -> &Tree {
        &self.tree
    }

    /// The validated classified tokens, in tree-leaf order.
    #[must_use]
    pub fn tokens(&self) -> &[Token] {
        &self.tokens
    }

    /// Consume the aggregate into its validated tree and token values.
    #[must_use]
    pub fn into_parts(self) -> (Tree, Vec<Token>) {
        (self.tree, self.tokens)
    }
}

fn node_kind(node: &Node) -> &'static str {
    match node {
        Node::Document(_) => "Document",
        Node::Sentence { .. } => "Sentence",
        Node::Word { .. } => "Word",
        Node::Punct { .. } => "Punct",
    }
}

fn node_span(node: &Node) -> Option<Span> {
    match node {
        Node::Sentence { span, .. } | Node::Word { span } | Node::Punct { span } => Some(*span),
        Node::Document(_) => None,
    }
}

fn validate_span(
    source: &str,
    path: &ClassificationPath,
    span: Span,
) -> Result<(), ClassificationError> {
    if span.start > span.end {
        return Err(ClassificationError::ReversedSpan {
            path: path.clone(),
            start: span.start,
            end: span.end,
        });
    }
    if span.end > source.len() {
        return Err(ClassificationError::SpanOutOfBounds {
            path: path.clone().field("end"),
            end: span.end,
            length: source.len(),
        });
    }
    if !source.is_char_boundary(span.start) {
        return Err(ClassificationError::SpanNotOnCharBoundary {
            path: path.clone().field("start"),
            offset: span.start,
        });
    }
    if !source.is_char_boundary(span.end) {
        return Err(ClassificationError::SpanNotOnCharBoundary {
            path: path.clone().field("end"),
            offset: span.end,
        });
    }
    Ok(())
}

fn validate_layout(
    path: &ClassificationPath,
    index: usize,
    previous: Span,
    current: Span,
) -> Result<(), ClassificationError> {
    if current.start < previous.start {
        return Err(ClassificationError::UnsortedSpan {
            path: path.clone().field("start"),
            previous_index: index - 1,
            previous_start: previous.start,
            start: current.start,
        });
    }
    if current.start < previous.end {
        return Err(ClassificationError::OverlappingSpan {
            path: path.clone().field("start"),
            previous_index: index - 1,
            previous_end: previous.end,
            start: current.start,
        });
    }
    Ok(())
}

/// Validate borrowed parser and annotator output against one source.
///
/// This is the compatibility boundary for synchronous consumers that already
/// borrow a public [`Tree`] and token slice. Prefer
/// [`ValidatedClassification`] when the proof must travel with the values.
///
/// # Errors
///
/// Returns the first [`ClassificationError`] in deterministic tree, token,
/// then correspondence order.
pub fn validate_classification(
    source: &str,
    tree: &Tree,
    tokens: &[Token],
) -> Result<(), ClassificationError> {
    let root_path = ClassificationPath::root("tree").field("root");
    let Node::Document(sentences) = &tree.root else {
        return Err(ClassificationError::UnexpectedNodeKind {
            path: root_path,
            expected: "Document",
            found: node_kind(&tree.root),
        });
    };

    let mut leaves = Vec::new();
    let mut previous_sentence = None;
    for (sentence_index, sentence) in sentences.iter().enumerate() {
        let sentence_path = root_path.clone().field("sentences").index(sentence_index);
        let Node::Sentence { span, parts } = sentence else {
            return Err(ClassificationError::UnexpectedNodeKind {
                path: sentence_path,
                expected: "Sentence",
                found: node_kind(sentence),
            });
        };
        let span_path = sentence_path.clone().field("span");
        validate_span(source, &span_path, *span)?;
        if let Some(previous) = previous_sentence {
            validate_layout(&span_path, sentence_index, previous, *span)?;
        }
        previous_sentence = Some(*span);

        let mut previous_part = None;
        for (part_index, part) in parts.iter().enumerate() {
            let part_path = sentence_path.clone().field("parts").index(part_index);
            if !matches!(part, Node::Word { .. } | Node::Punct { .. }) {
                return Err(ClassificationError::UnexpectedNodeKind {
                    path: part_path,
                    expected: "Word or Punct",
                    found: node_kind(part),
                });
            }
            let part_span = node_span(part).expect("Word and Punct nodes carry spans");
            let part_span_path = part_path.field("span");
            validate_span(source, &part_span_path, part_span)?;
            if let Some(previous) = previous_part {
                validate_layout(&part_span_path, part_index, previous, part_span)?;
            }
            previous_part = Some(part_span);
            if part_span.start < span.start || part_span.end > span.end {
                return Err(ClassificationError::ChildSpanOutsideParent {
                    path: part_span_path,
                    parent: *span,
                    child: part_span,
                });
            }
            leaves.push((part_span_path, part_span));
        }
    }

    let mut previous_token = None;
    for (token_index, token) in tokens.iter().enumerate() {
        let token_path = ClassificationPath::root("tokens")
            .index(token_index)
            .field("span");
        validate_span(source, &token_path, token.span)?;
        if let Some(previous) = previous_token {
            validate_layout(&token_path, token_index, previous, token.span)?;
        }
        previous_token = Some(token.span);
    }

    if leaves.len() != tokens.len() {
        return Err(ClassificationError::TreeTokenCountMismatch {
            path: ClassificationPath::root("tokens"),
            tree_leaves: leaves.len(),
            tokens: tokens.len(),
        });
    }
    for (index, ((tree_path, tree_span), token)) in leaves.iter().zip(tokens).enumerate() {
        if *tree_span != token.span {
            return Err(ClassificationError::TreeTokenSpanMismatch {
                path: ClassificationPath::root("tokens")
                    .index(index)
                    .field("span"),
                tree_path: tree_path.clone(),
                tree_span: *tree_span,
                token_span: token.span,
            });
        }
    }
    Ok(())
}

/// Port: inspect a classified document and report prose [`Finding`]s.
///
/// An `Analyzer` sees the `source`, its parsed [`Tree`], and the classified
/// [`Token`] stream an [`Annotator`] produced, so a rule can reason about both
/// structure (sentences) and part of speech (auxiliaries, function words)
/// without re-parsing. Like the other ports it performs no I/O; the rule pack
/// that implements it is an adapter (the `colorful-lint` crate), so new rules
/// never touch the parser, the lexicon, or the surfaces.
///
/// # Examples
///
/// An analyzer can implement one deterministic rule without depending on I/O:
///
/// ```
/// # // public-api-doctest: analyzer
/// use colorful_core::{
///     Analyzer, Finding, Node, PosClass, Rule, Severity, Span, Token, Tree,
///     ValidatedClassification,
/// };
///
/// struct FlagFirstToken;
///
/// impl Analyzer for FlagFirstToken {
///     fn analyze(&self, _source: &str, _tree: &Tree, tokens: &[Token]) -> Vec<Finding> {
///         tokens
///             .first()
///             .map(|token| Finding {
///                 span: token.span,
///                 rule: Rule::WeakWord,
///                 severity: Severity::Info,
///                 message: "review the first token".to_owned(),
///             })
///             .into_iter()
///             .collect()
///     }
/// }
///
/// let span = Span::new(0, 4);
/// let token = Token {
///     span,
///     class: PosClass::Content,
/// };
/// let tree = Tree::document(vec![Node::Sentence {
///     span,
///     parts: vec![Node::Word { span }],
/// }]);
/// let classification = ValidatedClassification::new(
///     "word",
///     tree,
///     vec![token],
/// )
/// .unwrap();
/// let findings = FlagFirstToken.analyze(
///     classification.source(),
///     classification.tree(),
///     classification.tokens(),
/// );
/// assert_eq!(findings[0].rule.code(), "weak-word");
/// assert_eq!(findings[0].severity, Severity::Info);
/// assert_eq!(findings[0].span, Span::new(0, 4));
/// ```
///
/// See the [linting topic] for the shipped analyzer and rule behavior.
///
/// [linting topic]: https://github.com/flyingrobots/colorful-language/blob/main/docs/topics/linting/README.md
pub trait Analyzer {
    /// Produce the findings for `source`, given its parsed `tree` and the
    /// classified `tokens`, in source order.
    fn analyze(&self, source: &str, tree: &Tree, tokens: &[Token]) -> Vec<Finding>;
}

/// The `v0` [`Annotator`]: a [`Lexicon`] plus shallow, deterministic heuristics.
///
/// - [`Node::Word`] spans are classified by the lexicon, then a proper-noun
///   heuristic upgrades a capitalized, non-sentence-initial
///   [`PosClass::Content`] or [`PosClass::Open`] word to [`PosClass::ProperNoun`].
///   Sentence- or line-initial words keep the class the lexicon returned.
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
    fn pass_identity(&self) -> PassIdentity {
        PassIdentity {
            pass_id: "classify",
            rule_id: "lexical-annotator",
        }
    }

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
///
/// Total: an out-of-range or off-char-boundary `byte` (from a malformed
/// upstream span) yields `""` rather than panicking. A span from
/// [`Parser::parse`] is always in bounds and on a boundary, so this defends
/// against a future producer's bug, not today's.
fn line_of(source: &str, byte: usize) -> &str {
    let byte = byte.min(source.len());
    if !source.is_char_boundary(byte) {
        return "";
    }
    let start = source[..byte].rfind(['\n', '\r']).map_or(0, |i| i + 1);
    let end = source[byte..]
        .find(['\n', '\r'])
        .map_or(source.len(), |i| byte + i);
    source.get(start..end).unwrap_or("")
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

    fn valid_classification() -> (&'static str, Tree, Vec<Token>) {
        let source = "cat runs.";
        let tree = Tree::document(vec![sentence(
            (0, source.len()),
            vec![word(0, 3), word(4, 8), punct(8, 9)],
        )]);
        let tokens = vec![
            Token {
                span: Span::new(0, 3),
                class: PosClass::Content,
            },
            Token {
                span: Span::new(4, 8),
                class: PosClass::Content,
            },
            Token {
                span: Span::new(8, 9),
                class: PosClass::Punctuation,
            },
        ];
        (source, tree, tokens)
    }

    struct FixedParser(Tree);

    impl Parser for FixedParser {
        fn parse(&self, _text: &str) -> Tree {
            self.0.clone()
        }
    }

    struct FixedAnnotator(Vec<Token>);

    impl Annotator for FixedAnnotator {
        fn annotate(&self, _source: &str, _tree: &Tree) -> Vec<Token> {
            self.0.clone()
        }
    }

    fn classification_error(
        source: &'static str,
        tree: Tree,
        tokens: Vec<Token>,
    ) -> ClassificationError {
        ValidatedClassification::from_ports(source, &FixedParser(tree), &FixedAnnotator(tokens))
            .unwrap_err()
    }

    #[test]
    fn validated_classification_preserves_valid_built_in_shape() {
        let (source, tree, tokens) = valid_classification();
        let validated = ValidatedClassification::new(source, tree.clone(), tokens.clone()).unwrap();

        assert_eq!(validated.source(), source);
        assert_eq!(validated.tree(), &tree);
        assert_eq!(validated.tokens(), tokens);
        assert_eq!(validated.into_parts(), (tree, tokens));
    }

    #[test]
    fn validated_classification_rejects_an_unexpected_root_kind() {
        let (source, _, tokens) = valid_classification();
        let tree = Tree { root: word(0, 3) };
        let error = classification_error(source, tree, tokens);

        assert!(matches!(
            error,
            ClassificationError::UnexpectedNodeKind { ref path, .. }
                if path.to_string() == "tree.root"
        ));
    }

    #[test]
    fn validated_classification_rejects_a_reversed_tree_span() {
        let (source, mut tree, tokens) = valid_classification();
        let Node::Document(sentences) = &mut tree.root else {
            unreachable!()
        };
        let Node::Sentence { parts, .. } = &mut sentences[0] else {
            unreachable!()
        };
        let Node::Word { span } = &mut parts[0] else {
            unreachable!()
        };
        *span = Span { start: 3, end: 0 };

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::ReversedSpan {
                ref path,
                start: 3,
                end: 0,
            } if path.to_string() == "tree.root.sentences[0].parts[0].span"
        ));
    }

    #[test]
    fn validated_classification_rejects_an_out_of_bounds_tree_span() {
        let (source, mut tree, tokens) = valid_classification();
        let Node::Document(sentences) = &mut tree.root else {
            unreachable!()
        };
        let Node::Sentence { parts, .. } = &mut sentences[0] else {
            unreachable!()
        };
        let Node::Punct { span } = &mut parts[2] else {
            unreachable!()
        };
        span.end = source.len() + 1;

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::SpanOutOfBounds {
                ref path,
                end,
                length,
            } if path.to_string() == "tree.root.sentences[0].parts[2].span.end"
                && end == source.len() + 1
                && length == source.len()
        ));
    }

    #[test]
    fn validated_classification_rejects_an_unsorted_tree_sibling() {
        let (source, mut tree, tokens) = valid_classification();
        let Node::Document(sentences) = &mut tree.root else {
            unreachable!()
        };
        let Node::Sentence { parts, .. } = &mut sentences[0] else {
            unreachable!()
        };
        parts.swap(0, 1);

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::UnsortedSpan {
                ref path,
                previous_index: 0,
                ..
            } if path.to_string() == "tree.root.sentences[0].parts[1].span.start"
        ));
    }

    #[test]
    fn validated_classification_rejects_an_overlapping_tree_sibling() {
        let (source, mut tree, tokens) = valid_classification();
        let Node::Document(sentences) = &mut tree.root else {
            unreachable!()
        };
        let Node::Sentence { parts, .. } = &mut sentences[0] else {
            unreachable!()
        };
        let Node::Word { span } = &mut parts[1] else {
            unreachable!()
        };
        span.start = 2;

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::OverlappingSpan {
                ref path,
                previous_index: 0,
                ..
            } if path.to_string() == "tree.root.sentences[0].parts[1].span.start"
        ));
    }

    #[test]
    fn validated_classification_rejects_a_child_outside_its_sentence() {
        let (source, mut tree, tokens) = valid_classification();
        let Node::Document(sentences) = &mut tree.root else {
            unreachable!()
        };
        let Node::Sentence { span, .. } = &mut sentences[0] else {
            unreachable!()
        };
        span.end -= 1;

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::ChildSpanOutsideParent { ref path, .. }
                if path.to_string() == "tree.root.sentences[0].parts[2].span"
        ));
    }

    #[test]
    fn validated_classification_rejects_a_mid_code_point_token_span() {
        let source = "é ok";
        let tree = Tree::document(vec![sentence(
            (0, source.len()),
            vec![word(0, 2), word(3, 5)],
        )]);
        let tokens = vec![
            Token {
                span: Span { start: 1, end: 2 },
                class: PosClass::Content,
            },
            Token {
                span: Span::new(3, 5),
                class: PosClass::Content,
            },
        ];

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::SpanNotOnCharBoundary {
                ref path,
                offset: 1,
            } if path.to_string() == "tokens[0].span.start"
        ));
    }

    #[test]
    fn validated_classification_rejects_an_unsorted_token() {
        let (source, tree, mut tokens) = valid_classification();
        tokens.swap(0, 1);

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::UnsortedSpan {
                ref path,
                previous_index: 0,
                ..
            } if path.to_string() == "tokens[1].span.start"
        ));
    }

    #[test]
    fn validated_classification_rejects_an_overlapping_token() {
        let (source, tree, mut tokens) = valid_classification();
        tokens[1].span.start = 2;

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::OverlappingSpan {
                ref path,
                previous_index: 0,
                ..
            } if path.to_string() == "tokens[1].span.start"
        ));
    }

    #[test]
    fn validated_classification_rejects_a_tree_token_count_mismatch() {
        let (source, tree, mut tokens) = valid_classification();
        tokens.pop();

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::TreeTokenCountMismatch {
                ref path,
                tree_leaves: 3,
                tokens: 2,
            } if path.to_string() == "tokens"
        ));
    }

    #[test]
    fn validated_classification_rejects_a_tree_token_span_mismatch() {
        let (source, tree, mut tokens) = valid_classification();
        tokens[0].span.start = 1;

        let error = classification_error(source, tree, tokens);
        assert!(matches!(
            error,
            ClassificationError::TreeTokenSpanMismatch {
                ref path,
                tree_span: Span { start: 0, end: 3 },
                token_span: Span { start: 1, end: 3 },
                ..
            } if path.to_string() == "tokens[0].span"
        ));
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
    fn sentence_initial_open_class_seed_keeps_open_class() {
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

        let src = "Cat sleeps";
        let tree = Tree::document(vec![sentence((0, 10), vec![word(0, 3), word(4, 10)])]);
        let toks = LexicalAnnotator::new(SeedStub).annotate(src, &tree);
        let classes: Vec<PosClass> = toks.iter().map(|t| t.class).collect();
        assert_eq!(
            classes,
            vec![PosClass::Open(OpenClassKind::Noun), PosClass::Content]
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
    fn line_of_clamps_an_out_of_range_byte_instead_of_panicking() {
        let src = "one\ntwo";
        // Past the end of the source entirely.
        assert_eq!(line_of(src, 100), "two");
        // Exactly at the end.
        assert_eq!(line_of(src, src.len()), "two");
    }

    #[test]
    fn line_of_returns_empty_for_an_off_char_boundary_byte_instead_of_panicking() {
        // 'é' is two bytes (0xC3 0xA9); byte 1 splits it.
        let src = "é ok";
        assert_eq!(line_of(src, 1), "");
    }

    #[test]
    fn malformed_word_span_off_a_char_boundary_stays_content_not_proper_noun() {
        // A hand-built span (bypassing Parser::parse, which never produces this)
        // starting mid-character in "é ok". Pins the exact downgrade: the word
        // must remain PosClass::Content, not panic, and not be upgraded to
        // PosClass::ProperNoun — line_of's malformed-input path (via
        // line_is_title_case) returning "" must not silently grant "sentence
        // start" status that lets the capitalization check through differently
        // than a well-formed empty case would.
        let src = "é ok";
        let tree = Tree::document(vec![sentence(
            (0, 4),
            vec![Node::Word {
                span: Span { start: 1, end: 4 },
            }],
        )]);
        let tokens = annotate(&tree, src);
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].class, PosClass::Content);
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
