//! The closed-class function-word lexicon — a [`Tagger`] adapter.
//!
//! This crate encodes the project's founding insight: English's closed-class
//! words (articles, prepositions, conjunctions, pronouns, auxiliaries,
//! determiners) form a finite, enumerable set that behaves like
//! programming-language keywords. They are stored in a compile-time perfect-hash
//! map and looked up case-insensitively.
//!
//! [`ClosedClassTagger`] classifies a word as a [`PosClass::Function`] if it is
//! in the set, a [`PosClass::Number`] if it is numeric, and otherwise leaves it
//! as undifferentiated [`PosClass::Content`]. The proper-noun heuristic is a
//! context-dependent refinement applied by `colorful_core::classify`, not here.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use colorful_core::{FunctionKind, PosClass, Tagger};
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
};

/// A [`Tagger`] backed by the closed-class [`FUNCTION_WORDS`] set.
#[derive(Debug, Default, Clone, Copy)]
pub struct ClosedClassTagger;

impl ClosedClassTagger {
    /// Create a new tagger.
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

impl Tagger for ClosedClassTagger {
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

/// Look a word up in the closed-class set, case-insensitively.
fn lookup(word: &str) -> Option<FunctionKind> {
    if let Some(kind) = FUNCTION_WORDS.get(word) {
        return Some(*kind);
    }
    if word.bytes().any(|b| b.is_ascii_uppercase()) {
        return FUNCTION_WORDS
            .get(word.to_ascii_lowercase().as_str())
            .copied();
    }
    None
}

/// Whether `word` is a numeric token: at least one digit, and every character is
/// a digit or an internal `.`/`,` separator (for example `150`, `3.14`, `1,000`).
fn is_number(word: &str) -> bool {
    let mut has_digit = false;
    for c in word.chars() {
        if c.is_ascii_digit() {
            has_digit = true;
        } else if c != '.' && c != ',' {
            return false;
        }
    }
    has_digit
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(word: &str) -> PosClass {
        ClosedClassTagger::new().classify(word)
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
        // Proper-noun detection is the caller's job, not the tagger's.
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
        // A sanity floor; the exact count is documented in the lexicon topic.
        assert!(ClosedClassTagger::word_count() >= 150);
    }
}
