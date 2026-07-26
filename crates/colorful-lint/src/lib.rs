//! The `v0` prose-linting rule pack: an [`Analyzer`] adapter.
//!
//! [`ProseLinter`] composes a handful of shallow, deterministic rules over the
//! same parsed [`Tree`] and classified [`Token`] stream the colorizer uses. Each
//! rule looks only at structure (sentences) and lexemes — no model, no network —
//! so the same input always yields the same findings, which is what the golden
//! fixtures pin. New rules are added here, never in the core or the surfaces.
//!
//! The pack is intentionally conservative: every rule reports *candidates* a
//! writer can dismiss, and the noisiest heuristic (passive voice) is `Info`, not
//! a warning. Thresholds and the filler-word list live in [`LintConfig`].

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::collections::BTreeMap;

use colorful_core::{
    Analyzer, Finding, FunctionKind, Node, OpenClassKind, PosClass, Rule, Severity, Span, Token,
    Tree,
};

/// `be`-auxiliaries that open a passive-voice construction.
const BE_AUXILIARIES: &[&str] = &["is", "are", "was", "were", "be", "been", "being", "am"];

/// Evidence required before a reviewed participle can become a passive-voice
/// candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParticipleRule {
    /// The reviewed lexeme is sufficiently eventive for a low-severity
    /// candidate without further context.
    Eventive,
    /// The lexeme can also describe a result state, so require a following
    /// lexically classified `by` phrase as local event evidence.
    RequiresByPhrase,
}

/// One reviewed past-participle decision.
#[derive(Debug, Clone, Copy)]
struct ParticipleEvidence {
    lexeme: &'static str,
    rule: ParticipleRule,
}

impl ParticipleEvidence {
    const fn eventive(lexeme: &'static str) -> Self {
        Self {
            lexeme,
            rule: ParticipleRule::Eventive,
        }
    }

    const fn requires_by_phrase(lexeme: &'static str) -> Self {
        Self {
            lexeme,
            rule: ParticipleRule::RequiresByPhrase,
        }
    }
}

/// Conservative, alphabetized participle evidence for the passive-voice rule.
///
/// Absence is deliberate uncertainty, not evidence that a word cannot be a
/// participle. Additions require a reviewed corpus row before this table grows.
const REVIEWED_PARTICIPLES: &[ParticipleEvidence] = &[
    ParticipleEvidence::eventive("approved"),
    ParticipleEvidence::eventive("assigned"),
    ParticipleEvidence::eventive("bought"),
    ParticipleEvidence::requires_by_phrase("broken"),
    ParticipleEvidence::eventive("brought"),
    ParticipleEvidence::eventive("built"),
    ParticipleEvidence::eventive("caught"),
    ParticipleEvidence::eventive("chosen"),
    ParticipleEvidence::eventive("cleaned"),
    ParticipleEvidence::requires_by_phrase("closed"),
    ParticipleEvidence::eventive("completed"),
    ParticipleEvidence::eventive("delivered"),
    ParticipleEvidence::eventive("documented"),
    ParticipleEvidence::eventive("done"),
    ParticipleEvidence::eventive("drawn"),
    ParticipleEvidence::eventive("edited"),
    ParticipleEvidence::eventive("felt"),
    ParticipleEvidence::eventive("found"),
    ParticipleEvidence::eventive("given"),
    ParticipleEvidence::eventive("held"),
    ParticipleEvidence::eventive("implemented"),
    ParticipleEvidence::eventive("kept"),
    ParticipleEvidence::requires_by_phrase("known"),
    ParticipleEvidence::requires_by_phrase("left"),
    ParticipleEvidence::requires_by_phrase("lost"),
    ParticipleEvidence::eventive("made"),
    ParticipleEvidence::eventive("met"),
    ParticipleEvidence::eventive("paid"),
    ParticipleEvidence::eventive("published"),
    ParticipleEvidence::eventive("put"),
    ParticipleEvidence::eventive("rejected"),
    ParticipleEvidence::eventive("repaired"),
    ParticipleEvidence::eventive("reviewed"),
    ParticipleEvidence::eventive("said"),
    ParticipleEvidence::eventive("seen"),
    ParticipleEvidence::eventive("sent"),
    ParticipleEvidence::requires_by_phrase("set"),
    ParticipleEvidence::eventive("shown"),
    ParticipleEvidence::eventive("taken"),
    ParticipleEvidence::eventive("taught"),
    ParticipleEvidence::eventive("tested"),
    ParticipleEvidence::eventive("thought"),
    ParticipleEvidence::eventive("told"),
    ParticipleEvidence::eventive("validated"),
    ParticipleEvidence::eventive("won"),
    ParticipleEvidence::eventive("written"),
];

/// The default filler / weak words flagged by the [`Rule::WeakWord`] rule.
const DEFAULT_WEAK_WORDS: &[&str] = &[
    "very",
    "really",
    "just",
    "actually",
    "quite",
    "basically",
    "literally",
    "simply",
    "totally",
    "definitely",
];

/// Tunable thresholds and word lists for the rule pack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LintConfig {
    /// A sentence with more than this many words is a [`Rule::RunOn`].
    pub run_on_words: usize,
    /// A sentence is only a [`Rule::LengthOutlier`] if it has at least this many
    /// words (an absolute floor, so short documents are left alone).
    pub outlier_floor: usize,
    /// A sentence is a [`Rule::LengthOutlier`] when its word count is at least
    /// this multiple of the document's mean sentence length.
    pub outlier_ratio: usize,
    /// Lowercase lexemes flagged by [`Rule::WeakWord`].
    pub weak_words: Vec<String>,
}

impl Default for LintConfig {
    fn default() -> Self {
        Self {
            run_on_words: 40,
            outlier_floor: 25,
            outlier_ratio: 2,
            weak_words: DEFAULT_WEAK_WORDS
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
        }
    }
}

/// The `v0` [`Analyzer`]: the default rule pack over a [`LintConfig`].
#[derive(Debug, Default, Clone)]
pub struct ProseLinter {
    config: LintConfig,
}

impl ProseLinter {
    /// Create a linter with the default [`LintConfig`].
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a linter with a custom [`LintConfig`].
    #[must_use]
    pub fn with_config(config: LintConfig) -> Self {
        Self { config }
    }
}

impl Analyzer for ProseLinter {
    fn analyze(&self, source: &str, tree: &Tree, tokens: &[Token]) -> Vec<Finding> {
        let Node::Document(sentences) = &tree.root else {
            return Vec::new();
        };

        let mut findings = Vec::new();
        self.weak_words(source, tokens, &mut findings);
        self.run_on(source, sentences, &mut findings);
        self.length_outlier(sentences, &mut findings);
        self.passive_voice(source, sentences, tokens, &mut findings);

        // Both surfaces want findings in source order; break ties by rule code
        // for a stable, reproducible stream regardless of rule evaluation order.
        findings.sort_by(|a, b| {
            a.span
                .start
                .cmp(&b.span.start)
                .then_with(|| a.rule.code().cmp(b.rule.code()))
        });
        findings
    }
}

impl ProseLinter {
    /// [`Rule::WeakWord`]: flag a lexical content token whose lexeme is in the
    /// filler list. Requiring `Content` or `Open(_)` keeps a capitalized name (a
    /// proper noun) or a quoted word from being mistaken for filler.
    fn weak_words(&self, source: &str, tokens: &[Token], out: &mut Vec<Finding>) {
        for token in tokens {
            if !matches!(token.class, PosClass::Content | PosClass::Open(_)) {
                continue;
            }
            let word = token.span.slice(source).to_ascii_lowercase();
            if self.config.weak_words.contains(&word) {
                out.push(Finding {
                    span: token.span,
                    rule: Rule::WeakWord,
                    severity: Severity::Info,
                    message: format!("weak word '{word}'"),
                });
            }
        }
    }

    /// [`Rule::RunOn`]: flag a sentence with more than `run_on_words` words.
    fn run_on(&self, _source: &str, sentences: &[Node], out: &mut Vec<Finding>) {
        for sentence in sentences {
            let Node::Sentence { span, parts } = sentence else {
                continue;
            };
            let words = word_count(parts);
            if words > self.config.run_on_words {
                out.push(Finding {
                    span: *span,
                    rule: Rule::RunOn,
                    severity: Severity::Warning,
                    message: format!("sentence runs to {words} words"),
                });
            }
        }
    }

    /// [`Rule::LengthOutlier`]: flag a sentence far longer than the document
    /// mean. Sentences already past the run-on threshold are reported as
    /// [`Rule::RunOn`] and skipped here, so the two rules do not double up.
    fn length_outlier(&self, sentences: &[Node], out: &mut Vec<Finding>) {
        let counts: Vec<(Span, usize)> = sentences
            .iter()
            .filter_map(|node| match node {
                Node::Sentence { span, parts } => {
                    let words = word_count(parts);
                    (words > 0).then_some((*span, words))
                }
                _ => None,
            })
            .collect();

        // A mean is only meaningful across several sentences.
        let n = counts.len();
        if n < 2 {
            return;
        }
        let total: usize = counts.iter().map(|(_, w)| w).sum();
        let mean = total / n;

        for (span, words) in counts {
            // `words >= ratio * mean`, via integers: `words * n >= ratio * total`.
            let is_outlier = words >= self.config.outlier_floor
                && words <= self.config.run_on_words
                && words.saturating_mul(n) >= self.config.outlier_ratio.saturating_mul(total);
            if is_outlier {
                out.push(Finding {
                    span,
                    rule: Rule::LengthOutlier,
                    severity: Severity::Info,
                    message: format!("sentence is {words} words; the document averages {mean}"),
                });
            }
        }
    }

    /// [`Rule::PassiveVoice`]: flag a `be`-auxiliary followed by a past
    /// reviewed participle, optionally with one classified or `-ly` adverb
    /// between them (`was carefully written`).
    fn passive_voice(
        &self,
        source: &str,
        sentences: &[Node],
        tokens: &[Token],
        out: &mut Vec<Finding>,
    ) {
        let classes: BTreeMap<(usize, usize), PosClass> = tokens
            .iter()
            .map(|token| ((token.span.start, token.span.end), token.class))
            .collect();

        for sentence in sentences {
            let Node::Sentence { parts, .. } = sentence else {
                continue;
            };
            let words: Vec<(Span, PosClass)> = parts
                .iter()
                .filter_map(|p| match p {
                    Node::Word { span } => classes
                        .get(&(span.start, span.end))
                        .copied()
                        .map(|class| (*span, class)),
                    _ => None,
                })
                .collect();

            for (aux_index, &(aux, aux_class)) in words.iter().enumerate() {
                if !is_be_auxiliary(aux.slice(source), aux_class) {
                    continue;
                }

                let Some(&(next, next_class)) = words.get(aux_index + 1) else {
                    continue;
                };
                let participle_index =
                    aux_index + usize::from(is_adverb(next.slice(source), next_class)) + 1;
                let Some(&(participle, participle_class)) = words.get(participle_index) else {
                    continue;
                };
                let following = words
                    .get(participle_index + 1)
                    .map(|&(span, class)| (span.slice(source), class));

                if is_past_participle(participle.slice(source), participle_class, following) {
                    out.push(Finding {
                        span: Span::new(aux.start, participle.end),
                        rule: Rule::PassiveVoice,
                        severity: Severity::Info,
                        message: format!(
                            "passive-voice candidate '{}'",
                            Span::new(aux.start, participle.end).slice(source)
                        ),
                    });
                }
            }
        }
    }
}

/// The number of [`Node::Word`] children in a sentence's `parts`.
fn word_count(parts: &[Node]) -> usize {
    parts
        .iter()
        .filter(|p| matches!(p, Node::Word { .. }))
        .count()
}

/// Whether `word` is a lexically classified `be` auxiliary.
fn is_be_auxiliary(word: &str, class: PosClass) -> bool {
    if class != PosClass::Function(FunctionKind::Auxiliary) {
        return false;
    }
    let lower = word.to_ascii_lowercase();
    BE_AUXILIARIES.contains(&lower.as_str())
}

/// Whether `word` reads as an adverb for the passive heuristic.
fn is_adverb(word: &str, class: PosClass) -> bool {
    if class == PosClass::Open(OpenClassKind::Adverb) {
        return true;
    }
    if class != PosClass::Content {
        return false;
    }
    let lower = word.to_ascii_lowercase();
    lower.len() > 2 && lower.ends_with("ly")
}

/// Whether lexical class, reviewed vocabulary, and local rule evidence support
/// treating `word` as a past participle.
fn is_past_participle(word: &str, class: PosClass, following: Option<(&str, PosClass)>) -> bool {
    if !matches!(
        class,
        PosClass::Content | PosClass::Open(OpenClassKind::Verb)
    ) {
        return false;
    }

    let lower = word.to_ascii_lowercase();
    let Ok(index) =
        REVIEWED_PARTICIPLES.binary_search_by_key(&lower.as_str(), |entry| entry.lexeme)
    else {
        return false;
    };

    match REVIEWED_PARTICIPLES[index].rule {
        ParticipleRule::Eventive => true,
        ParticipleRule::RequiresByPhrase => following.is_some_and(|(word, class)| {
            class == PosClass::Function(FunctionKind::Preposition)
                && word.eq_ignore_ascii_case("by")
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colorful_core::{Annotator, LexicalAnnotator, Parser};
    use colorful_lexicon::ClosedClassLexicon;
    use colorful_parse::ProseParser;

    /// A sentence body of `n` repeated words.
    fn words(n: usize) -> String {
        std::iter::repeat_n("word", n).collect::<Vec<_>>().join(" ")
    }

    /// Parse, classify, and lint `src` end to end through the real adapters.
    fn lint(src: &str) -> Vec<Finding> {
        let tree = ProseParser::new().parse(src);
        let tokens = LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(src, &tree);
        ProseLinter::new().analyze(src, &tree, &tokens)
    }

    #[test]
    fn clean_prose_has_no_findings() {
        let findings = lint("The cat sat on the mat. A dog ran home.");
        assert!(findings.is_empty(), "clean prose flagged: {findings:?}");
    }

    #[test]
    fn weak_words_are_flagged_as_info() {
        let src = "This is really just very wrong.";
        let findings = lint(src);
        let weak: Vec<&Finding> = findings
            .iter()
            .filter(|f| f.rule == Rule::WeakWord)
            .collect();
        assert_eq!(weak.len(), 3, "{findings:?}");
        assert!(weak.iter().all(|f| f.severity == Severity::Info));
        assert_eq!(
            weak.iter().map(|f| f.span.slice(src)).collect::<Vec<_>>(),
            vec!["really", "just", "very"]
        );
    }

    #[test]
    fn weak_words_still_apply_to_open_class_tokens() {
        let src = "really";
        let tree = Tree::document(vec![]);
        let tokens = vec![Token {
            span: Span::new(0, src.len()),
            class: PosClass::Open(colorful_core::OpenClassKind::Adverb),
        }];
        let findings = ProseLinter::new().analyze(src, &tree, &tokens);
        assert_eq!(findings.len(), 1, "{findings:?}");
        assert_eq!(findings[0].rule, Rule::WeakWord);
        assert_eq!(findings[0].message, "weak word 'really'");
    }

    #[test]
    fn weak_word_message_uses_the_lexeme() {
        let findings = lint("This is just wrong.");
        let just = findings
            .iter()
            .find(|f| f.span.slice("This is just wrong.") == "just");
        assert_eq!(just.unwrap().message, "weak word 'just'");
    }

    #[test]
    fn run_on_sentence_over_threshold_is_a_warning() {
        // 41 words: one past the default run-on threshold of 40.
        let src = format!("{}.", words(41));
        let findings = lint(&src);
        let run_on: Vec<&Finding> = findings.iter().filter(|f| f.rule == Rule::RunOn).collect();
        assert_eq!(run_on.len(), 1, "{findings:?}");
        assert_eq!(run_on[0].severity, Severity::Warning);
        assert_eq!(run_on[0].message, "sentence runs to 41 words");
    }

    #[test]
    fn exactly_forty_words_is_not_a_run_on() {
        let src = format!("{}.", words(40));
        assert!(lint(&src).iter().all(|f| f.rule != Rule::RunOn));
    }

    #[test]
    fn length_outlier_is_relative_to_the_document_mean() {
        // Three tiny sentences and one 30-word sentence: the long one is well
        // over twice the mean and past the floor, but under the run-on cap.
        let src = format!("Short one. Short two. Short three. {}.", words(30));
        let findings = lint(&src);
        let outliers: Vec<&Finding> = findings
            .iter()
            .filter(|f| f.rule == Rule::LengthOutlier)
            .collect();
        assert_eq!(outliers.len(), 1, "{findings:?}");
        assert_eq!(outliers[0].severity, Severity::Info);
        assert!(outliers[0].message.starts_with("sentence is 30 words"));
    }

    #[test]
    fn a_uniform_document_has_no_length_outliers() {
        let src = "Short one here. Short two here. Short three here. Short four here.";
        assert!(lint(src).iter().all(|f| f.rule != Rule::LengthOutlier));
    }

    #[test]
    fn run_on_sentence_is_not_also_a_length_outlier() {
        // A 50-word lone-ish sentence is past the run-on cap, so the outlier rule
        // must defer to run-on rather than double-report.
        let src = format!("Tiny. Tiny. {}.", words(50));
        let findings = lint(&src);
        assert!(findings.iter().any(|f| f.rule == Rule::RunOn));
        assert!(
            findings.iter().all(|f| f.rule != Rule::LengthOutlier),
            "{findings:?}"
        );
    }

    #[test]
    fn passive_voice_regular_participle_is_flagged() {
        let src = "The window was broken by the storm.";
        let findings = lint(src);
        let passive: Vec<&Finding> = findings
            .iter()
            .filter(|f| f.rule == Rule::PassiveVoice)
            .collect();
        assert_eq!(passive.len(), 1, "{findings:?}");
        assert_eq!(passive[0].span.slice(src), "was broken");
        assert_eq!(passive[0].message, "passive-voice candidate 'was broken'");
    }

    #[test]
    fn passive_voice_allows_one_adverb_between() {
        let src = "The report was carefully reviewed.";
        let findings = lint(src);
        let passive: Vec<&Finding> = findings
            .iter()
            .filter(|f| f.rule == Rule::PassiveVoice)
            .collect();
        assert_eq!(passive.len(), 1, "{findings:?}");
        assert_eq!(passive[0].span.slice(src), "was carefully reviewed");
    }

    #[test]
    fn active_voice_is_not_flagged_as_passive() {
        let src = "The storm broke the window.";
        assert!(lint(src).iter().all(|f| f.rule != Rule::PassiveVoice));
    }

    #[test]
    fn explicit_adjective_class_suppresses_a_participle_candidate() {
        let src = "The report was reviewed.";
        let tree = ProseParser::new().parse(src);
        let mut tokens = LexicalAnnotator::new(ClosedClassLexicon::new()).annotate(src, &tree);
        let reviewed = tokens
            .iter_mut()
            .find(|token| token.span.slice(src) == "reviewed")
            .expect("fixture contains reviewed");
        reviewed.class = PosClass::Open(colorful_core::OpenClassKind::Adjective);

        assert!(ProseLinter::new()
            .analyze(src, &tree, &tokens)
            .iter()
            .all(|finding| finding.rule != Rule::PassiveVoice));
    }

    #[test]
    fn reviewed_participle_table_is_sorted_unique_and_covers_both_rules() {
        assert!(
            REVIEWED_PARTICIPLES
                .windows(2)
                .all(|pair| pair[0].lexeme < pair[1].lexeme),
            "binary-searched participle table must be sorted and unique"
        );
        assert!(REVIEWED_PARTICIPLES
            .iter()
            .any(|entry| entry.rule == ParticipleRule::Eventive));
        assert!(REVIEWED_PARTICIPLES
            .iter()
            .any(|entry| entry.rule == ParticipleRule::RequiresByPhrase));
    }

    #[test]
    fn result_state_participle_requires_a_classified_by_phrase() {
        assert!(!is_past_participle("broken", PosClass::Content, None));
        assert!(!is_past_participle(
            "broken",
            PosClass::Content,
            Some(("near", PosClass::Function(FunctionKind::Preposition)))
        ));
        assert!(is_past_participle(
            "broken",
            PosClass::Content,
            Some(("by", PosClass::Function(FunctionKind::Preposition)))
        ));
    }

    #[test]
    fn findings_are_returned_in_source_order() {
        let src = "This is just very broken.";
        let starts: Vec<usize> = lint(src).iter().map(|f| f.span.start).collect();
        let mut sorted = starts.clone();
        sorted.sort_unstable();
        assert_eq!(starts, sorted, "findings not in source order");
    }
}
