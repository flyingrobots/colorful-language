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

use colorful_core::{Analyzer, Finding, Node, PosClass, Rule, Severity, Span, Token, Tree};

/// `be`-auxiliaries that open a passive-voice construction.
const BE_AUXILIARIES: &[&str] = &["is", "are", "was", "were", "be", "been", "being", "am"];

/// Common irregular past participles, for the passive-voice heuristic — the ones
/// an `-ed` test misses. Kept small and high-frequency on purpose.
const IRREGULAR_PARTICIPLES: &[&str] = &[
    "done", "made", "seen", "taken", "given", "written", "broken", "known", "shown", "gone",
    "found", "held", "told", "built", "brought", "bought", "caught", "taught", "thought", "sent",
    "kept", "left", "felt", "met", "paid", "said", "set", "put", "lost", "won", "drawn", "chosen",
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
        self.passive_voice(source, sentences, &mut findings);

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
    /// [`Rule::WeakWord`]: flag a `Content` token whose lexeme is in the filler
    /// list. Requiring `Content` keeps a capitalized name (a proper noun) or a
    /// quoted word from being mistaken for filler.
    fn weak_words(&self, source: &str, tokens: &[Token], out: &mut Vec<Finding>) {
        for token in tokens {
            if token.class != PosClass::Content {
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
    /// participle (an `-ed` word or a known irregular), optionally with one
    /// `-ly` adverb between them (`was carefully written`).
    fn passive_voice(&self, source: &str, sentences: &[Node], out: &mut Vec<Finding>) {
        for sentence in sentences {
            let Node::Sentence { parts, .. } = sentence else {
                continue;
            };
            let words: Vec<Span> = parts
                .iter()
                .filter_map(|p| match p {
                    Node::Word { span } => Some(*span),
                    _ => None,
                })
                .collect();

            for window in words.windows(2).chain(words.windows(3)) {
                let aux = window[0];
                let participle = window[window.len() - 1];
                if window.len() == 3 && !is_adverb(window[1].slice(source)) {
                    continue;
                }
                if is_be_auxiliary(aux.slice(source))
                    && is_past_participle(participle.slice(source))
                {
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

/// Whether `word` is a `be`-auxiliary (case-insensitive).
fn is_be_auxiliary(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    BE_AUXILIARIES.contains(&lower.as_str())
}

/// Whether `word` reads as an adverb for the passive heuristic: an `-ly` word.
fn is_adverb(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    lower.len() > 2 && lower.ends_with("ly")
}

/// Whether `word` is a past participle: an `-ed` word (longer than the suffix)
/// or a known irregular.
fn is_past_participle(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    (lower.len() > 2 && lower.ends_with("ed")) || IRREGULAR_PARTICIPLES.contains(&lower.as_str())
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
    fn findings_are_returned_in_source_order() {
        let src = "This is just very broken.";
        let starts: Vec<usize> = lint(src).iter().map(|f| f.span.start).collect();
        let mut sorted = starts.clone();
        sorted.sort_unstable();
        assert_eq!(starts, sorted, "findings not in source order");
    }
}
