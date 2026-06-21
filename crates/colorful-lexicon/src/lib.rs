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
//! context-dependent refinement applied by `colorful_core::classify`, not here.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use colorful_core::{FunctionKind, Lexicon, PosClass};
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

/// Whether `word` is a numeric token: it starts and ends with a digit, and every
/// character is a digit or an internal `.`/`,` separator (`150`, `3.14`, `1,000`,
/// but not `3.`, `.5`, or `.`).
fn is_number(word: &str) -> bool {
    let first_is_digit = word.chars().next().is_some_and(|c| c.is_ascii_digit());
    let last_is_digit = word.chars().next_back().is_some_and(|c| c.is_ascii_digit());
    first_is_digit && last_is_digit && word.chars().all(|c| matches!(c, '0'..='9' | '.' | ','))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(word: &str) -> PosClass {
        ClosedClassLexicon::new().classify(word)
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
}
