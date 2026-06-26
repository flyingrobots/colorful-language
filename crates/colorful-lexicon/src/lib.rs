//! The closed-class function-word lexicon — a [`Lexicon`] adapter.
//!
//! This crate encodes the project's founding insight: English's closed-class
//! words (articles, prepositions, conjunctions, pronouns, auxiliaries,
//! determiners) form a finite, enumerable set that behaves like
//! programming-language keywords. They are stored in a compile-time perfect-hash
//! map and looked up case-insensitively.
//!
//! [`ClosedClassLexicon`] classifies a word as a [`PosClass::Function`] if it is
//! in the set, a [`PosClass::Number`] if it is numeric, and otherwise leaves it
//! as undifferentiated [`PosClass::Content`]. The proper-noun heuristic is a
//! context-dependent refinement applied by `colorful_core::LexicalAnnotator`,
//! not here.
//!
//! [`SeedOpenClassLexicon`] is a Goalpost 2 adapter that layers a tiny
//! deterministic noun/verb/adjective/adverb seed table behind the same
//! [`Lexicon`] port.
//!
//! [`ContextualOpenClassAnnotator`] composes that lookup with local sentence
//! context for a small ambiguous set. The shipped CLI, LSP, and IR surfaces use
//! it by default to prove the open-class contract without committing to a full
//! dictionary.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use colorful_core::{Annotator, FunctionKind, LexicalAnnotator, Lexicon, OpenClassKind, PosClass};
use colorful_core::{Token, Tree};
use phf::phf_map;

/// The closed-class word set. Each word is assigned to exactly one
/// [`FunctionKind`]; genuinely ambiguous words (for example `that`, which can be
/// a determiner, pronoun, or conjunction) are assigned their most common role.
/// That coarseness is a known `v0` limitation, recorded in the lexicon topic.
static FUNCTION_WORDS: phf::Map<&'static str, FunctionKind> = phf_map! {
    // Articles
    "a" => FunctionKind::Article,
    "an" => FunctionKind::Article,
    "the" => FunctionKind::Article,

    // Determiners (incl. possessive determiners and quantifiers)
    "this" => FunctionKind::Determiner,
    "that" => FunctionKind::Determiner,
    "these" => FunctionKind::Determiner,
    "those" => FunctionKind::Determiner,
    "each" => FunctionKind::Determiner,
    "every" => FunctionKind::Determiner,
    "either" => FunctionKind::Determiner,
    "neither" => FunctionKind::Determiner,
    "all" => FunctionKind::Determiner,
    "any" => FunctionKind::Determiner,
    "some" => FunctionKind::Determiner,
    "no" => FunctionKind::Determiner,
    "both" => FunctionKind::Determiner,
    "few" => FunctionKind::Determiner,
    "more" => FunctionKind::Determiner,
    "most" => FunctionKind::Determiner,
    "much" => FunctionKind::Determiner,
    "many" => FunctionKind::Determiner,
    "several" => FunctionKind::Determiner,
    "such" => FunctionKind::Determiner,
    "another" => FunctionKind::Determiner,
    "enough" => FunctionKind::Determiner,
    "less" => FunctionKind::Determiner,
    "little" => FunctionKind::Determiner,
    "same" => FunctionKind::Determiner,
    "what" => FunctionKind::Determiner,
    "which" => FunctionKind::Determiner,
    "whose" => FunctionKind::Determiner,
    "whatever" => FunctionKind::Determiner,
    "whichever" => FunctionKind::Determiner,
    "my" => FunctionKind::Determiner,
    "your" => FunctionKind::Determiner,
    "his" => FunctionKind::Determiner,
    "her" => FunctionKind::Determiner,
    "its" => FunctionKind::Determiner,
    "our" => FunctionKind::Determiner,
    "their" => FunctionKind::Determiner,

    // Pronouns
    "i" => FunctionKind::Pronoun,
    "you" => FunctionKind::Pronoun,
    "he" => FunctionKind::Pronoun,
    "she" => FunctionKind::Pronoun,
    "it" => FunctionKind::Pronoun,
    "we" => FunctionKind::Pronoun,
    "they" => FunctionKind::Pronoun,
    "me" => FunctionKind::Pronoun,
    "him" => FunctionKind::Pronoun,
    "us" => FunctionKind::Pronoun,
    "them" => FunctionKind::Pronoun,
    "mine" => FunctionKind::Pronoun,
    "yours" => FunctionKind::Pronoun,
    "hers" => FunctionKind::Pronoun,
    "ours" => FunctionKind::Pronoun,
    "theirs" => FunctionKind::Pronoun,
    "myself" => FunctionKind::Pronoun,
    "yourself" => FunctionKind::Pronoun,
    "himself" => FunctionKind::Pronoun,
    "herself" => FunctionKind::Pronoun,
    "itself" => FunctionKind::Pronoun,
    "ourselves" => FunctionKind::Pronoun,
    "yourselves" => FunctionKind::Pronoun,
    "themselves" => FunctionKind::Pronoun,
    "who" => FunctionKind::Pronoun,
    "whom" => FunctionKind::Pronoun,
    "whoever" => FunctionKind::Pronoun,
    "whomever" => FunctionKind::Pronoun,
    "someone" => FunctionKind::Pronoun,
    "somebody" => FunctionKind::Pronoun,
    "something" => FunctionKind::Pronoun,
    "anyone" => FunctionKind::Pronoun,
    "anybody" => FunctionKind::Pronoun,
    "anything" => FunctionKind::Pronoun,
    "everyone" => FunctionKind::Pronoun,
    "everybody" => FunctionKind::Pronoun,
    "everything" => FunctionKind::Pronoun,
    "nobody" => FunctionKind::Pronoun,
    "nothing" => FunctionKind::Pronoun,
    "none" => FunctionKind::Pronoun,
    "one" => FunctionKind::Pronoun,
    "oneself" => FunctionKind::Pronoun,

    // Prepositions
    "of" => FunctionKind::Preposition,
    "in" => FunctionKind::Preposition,
    "on" => FunctionKind::Preposition,
    "at" => FunctionKind::Preposition,
    "by" => FunctionKind::Preposition,
    "for" => FunctionKind::Preposition,
    "with" => FunctionKind::Preposition,
    "about" => FunctionKind::Preposition,
    "against" => FunctionKind::Preposition,
    "between" => FunctionKind::Preposition,
    "into" => FunctionKind::Preposition,
    "through" => FunctionKind::Preposition,
    "during" => FunctionKind::Preposition,
    "above" => FunctionKind::Preposition,
    "below" => FunctionKind::Preposition,
    "to" => FunctionKind::Preposition,
    "from" => FunctionKind::Preposition,
    "up" => FunctionKind::Preposition,
    "down" => FunctionKind::Preposition,
    "over" => FunctionKind::Preposition,
    "under" => FunctionKind::Preposition,
    "out" => FunctionKind::Preposition,
    "off" => FunctionKind::Preposition,
    "near" => FunctionKind::Preposition,
    "within" => FunctionKind::Preposition,
    "without" => FunctionKind::Preposition,
    "upon" => FunctionKind::Preposition,
    "onto" => FunctionKind::Preposition,
    "toward" => FunctionKind::Preposition,
    "towards" => FunctionKind::Preposition,
    "among" => FunctionKind::Preposition,
    "across" => FunctionKind::Preposition,
    "behind" => FunctionKind::Preposition,
    "beyond" => FunctionKind::Preposition,
    "beside" => FunctionKind::Preposition,
    "besides" => FunctionKind::Preposition,
    "despite" => FunctionKind::Preposition,
    "except" => FunctionKind::Preposition,
    "inside" => FunctionKind::Preposition,
    "outside" => FunctionKind::Preposition,
    "per" => FunctionKind::Preposition,
    "since" => FunctionKind::Preposition,
    "till" => FunctionKind::Preposition,
    "until" => FunctionKind::Preposition,
    "unto" => FunctionKind::Preposition,
    "via" => FunctionKind::Preposition,
    "amid" => FunctionKind::Preposition,
    "around" => FunctionKind::Preposition,
    "atop" => FunctionKind::Preposition,
    "before" => FunctionKind::Preposition,
    "after" => FunctionKind::Preposition,
    "underneath" => FunctionKind::Preposition,
    "throughout" => FunctionKind::Preposition,
    "regarding" => FunctionKind::Preposition,
    "concerning" => FunctionKind::Preposition,

    // Conjunctions
    "and" => FunctionKind::Conjunction,
    "but" => FunctionKind::Conjunction,
    "or" => FunctionKind::Conjunction,
    "nor" => FunctionKind::Conjunction,
    "so" => FunctionKind::Conjunction,
    "yet" => FunctionKind::Conjunction,
    "because" => FunctionKind::Conjunction,
    "although" => FunctionKind::Conjunction,
    "though" => FunctionKind::Conjunction,
    "while" => FunctionKind::Conjunction,
    "whereas" => FunctionKind::Conjunction,
    "if" => FunctionKind::Conjunction,
    "unless" => FunctionKind::Conjunction,
    "whether" => FunctionKind::Conjunction,
    "as" => FunctionKind::Conjunction,
    "lest" => FunctionKind::Conjunction,
    "whilst" => FunctionKind::Conjunction,
    "once" => FunctionKind::Conjunction,
    "when" => FunctionKind::Conjunction,
    "whenever" => FunctionKind::Conjunction,
    "where" => FunctionKind::Conjunction,
    "wherever" => FunctionKind::Conjunction,
    "than" => FunctionKind::Conjunction,

    // Auxiliaries (incl. modals and semi-modals)
    "be" => FunctionKind::Auxiliary,
    "am" => FunctionKind::Auxiliary,
    "is" => FunctionKind::Auxiliary,
    "are" => FunctionKind::Auxiliary,
    "was" => FunctionKind::Auxiliary,
    "were" => FunctionKind::Auxiliary,
    "been" => FunctionKind::Auxiliary,
    "being" => FunctionKind::Auxiliary,
    "have" => FunctionKind::Auxiliary,
    "has" => FunctionKind::Auxiliary,
    "had" => FunctionKind::Auxiliary,
    "having" => FunctionKind::Auxiliary,
    "do" => FunctionKind::Auxiliary,
    "does" => FunctionKind::Auxiliary,
    "did" => FunctionKind::Auxiliary,
    "doing" => FunctionKind::Auxiliary,
    "done" => FunctionKind::Auxiliary,
    "will" => FunctionKind::Auxiliary,
    "would" => FunctionKind::Auxiliary,
    "shall" => FunctionKind::Auxiliary,
    "should" => FunctionKind::Auxiliary,
    "can" => FunctionKind::Auxiliary,
    "could" => FunctionKind::Auxiliary,
    "may" => FunctionKind::Auxiliary,
    "might" => FunctionKind::Auxiliary,
    "must" => FunctionKind::Auxiliary,
    "ought" => FunctionKind::Auxiliary,
    "need" => FunctionKind::Auxiliary,
    "dare" => FunctionKind::Auxiliary,
    "used" => FunctionKind::Auxiliary,

    // Negators
    "not" => FunctionKind::Negator,
    "never" => FunctionKind::Negator,

    // Negative contractions (auxiliary + n't). Keys are lowercase with a
    // straight apostrophe; lookup normalizes a typographic apostrophe to match.
    "don't" => FunctionKind::Auxiliary,
    "doesn't" => FunctionKind::Auxiliary,
    "didn't" => FunctionKind::Auxiliary,
    "isn't" => FunctionKind::Auxiliary,
    "aren't" => FunctionKind::Auxiliary,
    "wasn't" => FunctionKind::Auxiliary,
    "weren't" => FunctionKind::Auxiliary,
    "haven't" => FunctionKind::Auxiliary,
    "hasn't" => FunctionKind::Auxiliary,
    "hadn't" => FunctionKind::Auxiliary,
    "won't" => FunctionKind::Auxiliary,
    "wouldn't" => FunctionKind::Auxiliary,
    "can't" => FunctionKind::Auxiliary,
    "cannot" => FunctionKind::Auxiliary,
    "couldn't" => FunctionKind::Auxiliary,
    "shouldn't" => FunctionKind::Auxiliary,
    "mustn't" => FunctionKind::Auxiliary,
    "mightn't" => FunctionKind::Auxiliary,
    "shan't" => FunctionKind::Auxiliary,
    "needn't" => FunctionKind::Auxiliary,
    "ain't" => FunctionKind::Auxiliary,

    // Pronoun + auxiliary contractions
    "i'm" => FunctionKind::Pronoun,
    "you're" => FunctionKind::Pronoun,
    "we're" => FunctionKind::Pronoun,
    "they're" => FunctionKind::Pronoun,
    "he's" => FunctionKind::Pronoun,
    "she's" => FunctionKind::Pronoun,
    "it's" => FunctionKind::Pronoun,
    "that's" => FunctionKind::Pronoun,
    "there's" => FunctionKind::Pronoun,
    "who's" => FunctionKind::Pronoun,
    "i've" => FunctionKind::Pronoun,
    "you've" => FunctionKind::Pronoun,
    "we've" => FunctionKind::Pronoun,
    "they've" => FunctionKind::Pronoun,
    "i'll" => FunctionKind::Pronoun,
    "you'll" => FunctionKind::Pronoun,
    "we'll" => FunctionKind::Pronoun,
    "they'll" => FunctionKind::Pronoun,
    "he'll" => FunctionKind::Pronoun,
    "she'll" => FunctionKind::Pronoun,
    "it'll" => FunctionKind::Pronoun,
    "i'd" => FunctionKind::Pronoun,
    "you'd" => FunctionKind::Pronoun,
    "he'd" => FunctionKind::Pronoun,
    "she'd" => FunctionKind::Pronoun,
    "we'd" => FunctionKind::Pronoun,
    "they'd" => FunctionKind::Pronoun,
};

/// Representative, unambiguous open-class entries for the seed lexicon.
///
/// This is deliberately small. It is executable evidence for the Goalpost 2
/// contract, not an attempt at a production dictionary.
static OPEN_CLASS_WORDS: phf::Map<&'static str, OpenClassKind> = phf_map! {
    "cat" => OpenClassKind::Noun,
    "dog" => OpenClassKind::Noun,
    "mountain" => OpenClassKind::Noun,
    "river" => OpenClassKind::Noun,

    "connects" => OpenClassKind::Verb,
    "glows" => OpenClassKind::Verb,
    "renders" => OpenClassKind::Verb,
    "writes" => OpenClassKind::Verb,

    "careful" => OpenClassKind::Adjective,
    "quick" => OpenClassKind::Adjective,
    "silent" => OpenClassKind::Adjective,
    "structural" => OpenClassKind::Adjective,

    "carefully" => OpenClassKind::Adverb,
    "quickly" => OpenClassKind::Adverb,
    "silently" => OpenClassKind::Adverb,
    "slowly" => OpenClassKind::Adverb,
};

/// Ambiguous words with local context rules for the contextual annotator.
///
/// This is deliberately tiny. It proves the Goalpost 2 port shape and keeps the
/// default behavior deterministic while leaving a production dictionary for a
/// later slice.
static CONTEXTUAL_WORDS: phf::Map<&'static str, &'static [OpenClassKind]> = phf_map! {
    "book" => &[OpenClassKind::Noun, OpenClassKind::Verb],
    "record" => &[OpenClassKind::Noun, OpenClassKind::Verb],
    "lead" => &[OpenClassKind::Noun, OpenClassKind::Verb, OpenClassKind::Adjective],
    "fast" => &[OpenClassKind::Adjective, OpenClassKind::Adverb],
};

/// A [`Lexicon`] backed by the closed-class [`FUNCTION_WORDS`] set.
#[derive(Debug, Default, Clone, Copy)]
pub struct ClosedClassLexicon;

impl ClosedClassLexicon {
    /// Create a new lexicon.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// The number of words in the closed-class set.
    #[must_use]
    pub fn word_count() -> usize {
        FUNCTION_WORDS.len()
    }
}

impl Lexicon for ClosedClassLexicon {
    fn classify(&self, word: &str) -> PosClass {
        if let Some(kind) = lookup(word) {
            return PosClass::Function(kind);
        }
        if is_number(word) {
            return PosClass::Number;
        }
        PosClass::Content
    }
}

/// A seed lexicon for Goalpost 2 open-class POS experiments.
///
/// It preserves [`ClosedClassLexicon`] precedence: function words and numbers are
/// classified before the seed noun/verb/adjective/adverb table is considered.
#[derive(Debug, Default, Clone, Copy)]
pub struct SeedOpenClassLexicon;

impl SeedOpenClassLexicon {
    /// Create a new seed lexicon.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// The number of words in the open-class seed table.
    #[must_use]
    pub fn word_count() -> usize {
        OPEN_CLASS_WORDS.len()
    }
}

impl Lexicon for SeedOpenClassLexicon {
    fn classify(&self, word: &str) -> PosClass {
        let closed = ClosedClassLexicon::new().classify(word);
        if closed != PosClass::Content {
            return closed;
        }
        lookup_open_class(word).map_or(PosClass::Content, PosClass::Open)
    }
}

/// A deterministic contextual annotator for the Goalpost 2 open-class path.
///
/// It first delegates to [`LexicalAnnotator`] with the supplied [`Lexicon`], so
/// closed-class, number, seed-open-class, punctuation, and proper-noun behavior
/// remain centralized. It then refines only undifferentiated [`PosClass::Content`]
/// tokens whose lexeme appears in the small [`CONTEXTUAL_WORDS`] table.
#[derive(Debug, Clone, Copy)]
pub struct ContextualOpenClassAnnotator<L = SeedOpenClassLexicon> {
    lexicon: L,
}

impl<L> ContextualOpenClassAnnotator<L> {
    /// Create a contextual annotator over `lexicon`.
    #[must_use]
    pub fn new(lexicon: L) -> Self {
        Self { lexicon }
    }
}

impl Default for ContextualOpenClassAnnotator<SeedOpenClassLexicon> {
    fn default() -> Self {
        Self::new(SeedOpenClassLexicon::new())
    }
}

impl<L> Annotator for ContextualOpenClassAnnotator<L>
where
    L: Lexicon + Clone,
{
    fn annotate(&self, source: &str, tree: &Tree) -> Vec<Token> {
        let mut tokens = LexicalAnnotator::new(self.lexicon.clone()).annotate(source, tree);

        for i in 0..tokens.len() {
            if tokens[i].class != PosClass::Content {
                continue;
            }

            let word = tokens[i].span.slice(source);
            let Some(kind) = contextual_kind(
                word,
                context_word(source, &tokens, i.checked_sub(1)),
                context_word(source, &tokens, i.checked_add(1)),
            ) else {
                continue;
            };
            tokens[i].class = PosClass::Open(kind);
        }

        tokens
    }
}

#[derive(Debug, Clone, Copy)]
struct ContextWord<'a> {
    text: &'a str,
    class: PosClass,
}

fn context_word<'a>(
    source: &'a str,
    tokens: &[Token],
    index: Option<usize>,
) -> Option<ContextWord<'a>> {
    let index = index?;
    let token = tokens.get(index)?;
    if matches!(token.class, PosClass::Punctuation | PosClass::Quote) {
        return None;
    }
    Some(ContextWord {
        text: token.span.slice(source),
        class: token.class,
    })
}

fn contextual_kind(
    word: &str,
    previous: Option<ContextWord<'_>>,
    next: Option<ContextWord<'_>>,
) -> Option<OpenClassKind> {
    let normalized = normalize_ascii(word);
    let senses = CONTEXTUAL_WORDS.get(normalized.as_str())?;

    match normalized.as_str() {
        "fast" => {
            if has_sense(senses, OpenClassKind::Adverb) && previous.is_some_and(is_verb_context) {
                return Some(OpenClassKind::Adverb);
            }
            if has_sense(senses, OpenClassKind::Adjective) && next.is_some_and(is_nounish_context) {
                return Some(OpenClassKind::Adjective);
            }
        }
        "lead" => {
            if has_sense(senses, OpenClassKind::Verb) && previous.is_some_and(is_verb_trigger) {
                return Some(OpenClassKind::Verb);
            }
            if has_sense(senses, OpenClassKind::Adjective)
                && previous.is_some_and(is_nominal_trigger)
                && next.is_some_and(is_nounish_context)
            {
                return Some(OpenClassKind::Adjective);
            }
            if has_sense(senses, OpenClassKind::Noun) && previous.is_some_and(is_nominal_trigger) {
                return Some(OpenClassKind::Noun);
            }
        }
        "book" | "record" => {
            if has_sense(senses, OpenClassKind::Verb) && previous.is_some_and(is_verb_trigger) {
                return Some(OpenClassKind::Verb);
            }
            if has_sense(senses, OpenClassKind::Noun) && previous.is_some_and(is_nominal_trigger) {
                return Some(OpenClassKind::Noun);
            }
        }
        _ => {}
    }

    None
}

fn has_sense(senses: &[OpenClassKind], kind: OpenClassKind) -> bool {
    senses.contains(&kind)
}

fn is_nominal_trigger(word: ContextWord<'_>) -> bool {
    matches!(
        word.class,
        PosClass::Function(FunctionKind::Article)
            | PosClass::Function(FunctionKind::Determiner)
            | PosClass::Function(FunctionKind::Preposition)
            | PosClass::Open(OpenClassKind::Adjective)
    ) && !word.text.eq_ignore_ascii_case("to")
}

fn is_verb_trigger(word: ContextWord<'_>) -> bool {
    word.text.eq_ignore_ascii_case("to")
        || matches!(
            word.class,
            PosClass::Function(FunctionKind::Pronoun)
                | PosClass::Function(FunctionKind::Auxiliary)
                | PosClass::Open(OpenClassKind::Noun)
                | PosClass::ProperNoun
        )
        || (matches!(word.class, PosClass::Content) && looks_plural_subject(word.text))
}

fn is_verb_context(word: ContextWord<'_>) -> bool {
    matches!(word.class, PosClass::Open(OpenClassKind::Verb))
}

fn is_nounish_context(word: ContextWord<'_>) -> bool {
    matches!(
        word.class,
        PosClass::Content | PosClass::Open(OpenClassKind::Noun) | PosClass::ProperNoun
    )
}

fn looks_plural_subject(word: &str) -> bool {
    let normalized = normalize_ascii(word);
    normalized.len() > 1 && normalized.ends_with('s') && !normalized.ends_with("ss")
}

fn normalize_ascii(word: &str) -> String {
    word.to_ascii_lowercase()
}

/// Look a word up in the closed-class set, case-insensitively and tolerant of a
/// typographic apostrophe (U+2019) in contractions.
fn lookup(word: &str) -> Option<FunctionKind> {
    if let Some(kind) = FUNCTION_WORDS.get(word) {
        return Some(*kind);
    }
    // Normalize only when needed: lowercase any ASCII uppercase, and fold a
    // curly apostrophe to a straight one so `don\u{2019}t` matches `don't`.
    if word.bytes().any(|b| b.is_ascii_uppercase()) || word.contains('\u{2019}') {
        let normalized: String = word
            .chars()
            .map(|c| if c == '\u{2019}' { '\'' } else { c })
            .collect::<String>()
            .to_ascii_lowercase();
        return FUNCTION_WORDS.get(normalized.as_str()).copied();
    }
    None
}

/// Look a word up in the open-class seed set, case-insensitively.
fn lookup_open_class(word: &str) -> Option<OpenClassKind> {
    if let Some(kind) = OPEN_CLASS_WORDS.get(word) {
        return Some(*kind);
    }
    if word.bytes().any(|b| b.is_ascii_uppercase()) {
        let normalized = word.to_ascii_lowercase();
        return OPEN_CLASS_WORDS.get(normalized.as_str()).copied();
    }
    None
}

/// Whether `word` is a numeric token: it starts and ends with a Unicode numeric
/// digit (matching the parser's `\p{N}`), and every character is numeric or an
/// internal `.`/`,` separator (`150`, `3.14`, `1,000`, `\u{0663}`, but not `3.`,
/// `.5`, or `.`).
fn is_number(word: &str) -> bool {
    let first_is_digit = word.chars().next().is_some_and(char::is_numeric);
    let last_is_digit = word.chars().next_back().is_some_and(char::is_numeric);
    first_is_digit && last_is_digit && word.chars().all(|c| c.is_numeric() || c == '.' || c == ',')
}

#[cfg(test)]
mod tests {
    use super::*;
    use colorful_core::{Annotator, Node, Span};

    fn classify(word: &str) -> PosClass {
        ClosedClassLexicon::new().classify(word)
    }

    fn seed_classify(word: &str) -> PosClass {
        SeedOpenClassLexicon::new().classify(word)
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

    fn document(source: &str, spans: &[(usize, usize)]) -> colorful_core::Tree {
        colorful_core::Tree::document(vec![Node::Sentence {
            span: Span::new(0, source.len()),
            parts: spans
                .iter()
                .map(|&(start, end)| {
                    let slice = &source[start..end];
                    if slice.chars().all(|c| c.is_alphanumeric()) {
                        word(start, end)
                    } else {
                        punct(start, end)
                    }
                })
                .collect(),
        }])
    }

    fn contextual_classes(source: &str, spans: &[(usize, usize)]) -> Vec<PosClass> {
        ContextualOpenClassAnnotator::new(SeedOpenClassLexicon::new())
            .annotate(source, &document(source, spans))
            .into_iter()
            .map(|token| token.class)
            .collect()
    }

    #[test]
    fn contextual_annotator_disambiguates_ambiguous_open_class_words() {
        let source = "the book I book rooms the fast river connects fast";
        let spans = [
            (0, 3),
            (4, 8),
            (9, 10),
            (11, 15),
            (16, 21),
            (22, 25),
            (26, 30),
            (31, 36),
            (37, 45),
            (46, 50),
        ];

        assert_eq!(
            contextual_classes(source, &spans),
            vec![
                PosClass::Function(FunctionKind::Article),
                PosClass::Open(OpenClassKind::Noun),
                PosClass::Function(FunctionKind::Pronoun),
                PosClass::Open(OpenClassKind::Verb),
                PosClass::Content,
                PosClass::Function(FunctionKind::Article),
                PosClass::Open(OpenClassKind::Adjective),
                PosClass::Open(OpenClassKind::Noun),
                PosClass::Open(OpenClassKind::Verb),
                PosClass::Open(OpenClassKind::Adverb),
            ]
        );
    }

    #[test]
    fn contextual_annotator_preserves_existing_precedence() {
        let source = "the cat writes 3 unlisted.";
        let spans = [(0, 3), (4, 7), (8, 14), (15, 16), (17, 25), (25, 26)];

        assert_eq!(
            contextual_classes(source, &spans),
            vec![
                PosClass::Function(FunctionKind::Article),
                PosClass::Open(OpenClassKind::Noun),
                PosClass::Open(OpenClassKind::Verb),
                PosClass::Number,
                PosClass::Content,
                PosClass::Punctuation,
            ]
        );
    }

    #[test]
    fn classifies_each_function_kind() {
        assert_eq!(classify("the"), PosClass::Function(FunctionKind::Article));
        assert_eq!(
            classify("of"),
            PosClass::Function(FunctionKind::Preposition)
        );
        assert_eq!(
            classify("and"),
            PosClass::Function(FunctionKind::Conjunction)
        );
        assert_eq!(classify("they"), PosClass::Function(FunctionKind::Pronoun));
        assert_eq!(classify("is"), PosClass::Function(FunctionKind::Auxiliary));
        assert_eq!(
            classify("each"),
            PosClass::Function(FunctionKind::Determiner)
        );
    }

    #[test]
    fn lookup_is_case_insensitive() {
        assert_eq!(classify("The"), PosClass::Function(FunctionKind::Article));
        assert_eq!(
            classify("AND"),
            PosClass::Function(FunctionKind::Conjunction)
        );
    }

    #[test]
    fn content_words_are_undifferentiated() {
        assert_eq!(classify("cat"), PosClass::Content);
        assert_eq!(classify("running"), PosClass::Content);
        // Proper-noun detection is the caller's job, not the lexicon's.
        assert_eq!(classify("Paris"), PosClass::Content);
    }

    #[test]
    fn seed_open_class_lexicon_tags_representative_content_words() {
        assert_eq!(seed_classify("cat"), PosClass::Open(OpenClassKind::Noun));
        assert_eq!(
            seed_classify("connects"),
            PosClass::Open(OpenClassKind::Verb)
        );
        assert_eq!(
            seed_classify("quick"),
            PosClass::Open(OpenClassKind::Adjective)
        );
        assert_eq!(
            seed_classify("silently"),
            PosClass::Open(OpenClassKind::Adverb)
        );
        assert_eq!(seed_classify("CAT"), PosClass::Open(OpenClassKind::Noun));
        assert!(SeedOpenClassLexicon::word_count() >= 12);
    }

    #[test]
    fn seed_open_class_lexicon_preserves_closed_class_and_number_precedence() {
        assert_eq!(
            seed_classify("the"),
            PosClass::Function(FunctionKind::Article)
        );
        assert_eq!(seed_classify("150"), PosClass::Number);
        assert_eq!(seed_classify("unlisted"), PosClass::Content);
    }

    #[test]
    fn numbers_are_recognized() {
        assert_eq!(classify("150"), PosClass::Number);
        assert_eq!(classify("3.14"), PosClass::Number);
        assert_eq!(classify("1,000"), PosClass::Number);
        // A word with letters is content, even if it contains digits.
        assert_eq!(classify("covid19"), PosClass::Content);
        // Bare punctuation is not a number.
        assert_eq!(classify("."), PosClass::Content);
    }

    #[test]
    fn set_is_nonempty_and_reasonably_sized() {
        // A sanity floor; word_count() is the authoritative current size.
        assert!(ClosedClassLexicon::word_count() >= 150);
    }

    #[test]
    fn contractions_are_classified() {
        // Negative contractions are auxiliaries; pronoun+aux contractions are
        // pronouns. These are exactly the everyday words the product must reveal.
        assert_eq!(
            classify("don't"),
            PosClass::Function(FunctionKind::Auxiliary)
        );
        assert_eq!(
            classify("isn't"),
            PosClass::Function(FunctionKind::Auxiliary)
        );
        assert_eq!(
            classify("can't"),
            PosClass::Function(FunctionKind::Auxiliary)
        );
        assert_eq!(classify("I'm"), PosClass::Function(FunctionKind::Pronoun));
        assert_eq!(
            classify("they're"),
            PosClass::Function(FunctionKind::Pronoun)
        );
        assert_eq!(classify("we've"), PosClass::Function(FunctionKind::Pronoun));
        assert_eq!(classify("it's"), PosClass::Function(FunctionKind::Pronoun));
    }

    #[test]
    fn negation_is_its_own_kind() {
        assert_eq!(classify("not"), PosClass::Function(FunctionKind::Negator));
        assert_eq!(classify("never"), PosClass::Function(FunctionKind::Negator));
    }

    #[test]
    fn curly_apostrophe_contractions_match() {
        // A typographic apostrophe (U+2019) normalizes to a straight one.
        assert_eq!(
            classify("don\u{2019}t"),
            PosClass::Function(FunctionKind::Auxiliary)
        );
        assert_eq!(
            classify("I\u{2019}m"),
            PosClass::Function(FunctionKind::Pronoun)
        );
    }

    #[test]
    fn malformed_numbers_are_not_numbers() {
        // A numeric token must start and end with a digit.
        assert_eq!(classify("3."), PosClass::Content);
        assert_eq!(classify(".5"), PosClass::Content);
        assert_eq!(classify("3.."), PosClass::Content);
    }

    #[test]
    fn unicode_numerals_are_numbers() {
        // The parser's `\p{N}` accepts non-ASCII digits, so the lexicon must too,
        // or the pipeline disagrees with itself.
        assert_eq!(classify("\u{0663}"), PosClass::Number); // Arabic-Indic three
        assert_eq!(classify("\u{FF13}"), PosClass::Number); // full-width three
    }
}
