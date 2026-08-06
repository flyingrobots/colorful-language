//! Executable contracts for the canonical built-in language fixtures.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use colorful_core::{Analyzer, Annotator, Parser, Severity};
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;
use serde_json::Value;

const FIXTURE_NAME: &str = "language-showcase.txt";
const FIXTURE_BYTES: usize = 1_134;
const FIXTURE_SHA256: &str =
    "sha256:8b4031e9d5344db077253455b6fb7567e2d64559540063462ddbdfd43fee3556";
const DEMO_NAME: &str = "colorful-demo.txt";
const DEMO_BYTES: usize = 183;
const DEMO_SHA256: &str = "sha256:28010ec1d4557ab6f8ece30437613bfc8e8c779b6add08cf88c97baa1af1cfe3";
const DEMO_SOURCE: &str = "At 7, Ada writes carefully:\n\
\"The silent river glows slowly below the mountain.\"\n\
\n\
The quick cat connects silently with the careful dog\n\
while Paris quickly renders a structural record.\n";

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(FIXTURE_NAME)
}

fn demo_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(DEMO_NAME)
}

fn run<I, S>(args: I) -> Output
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    Command::new(env!("CARGO_BIN_EXE_colorful"))
        .args(args)
        .env_remove("NO_COLOR")
        .output()
        .expect("spawn the real colorful binary")
}

fn stdout(output: &Output) -> &str {
    std::str::from_utf8(&output.stdout).expect("colorful stdout must be UTF-8")
}

fn stderr(output: &Output) -> &str {
    std::str::from_utf8(&output.stderr).expect("colorful stderr must be UTF-8")
}

fn count_strings<'a>(values: impl Iterator<Item = &'a Value>) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for value in values {
        let value = value.as_str().expect("diagnostic field must be a string");
        *counts.entry(value.to_owned()).or_default() += 1;
    }
    counts
}

fn expected_counts<const N: usize>(pairs: [(&str, usize); N]) -> BTreeMap<String, usize> {
    pairs
        .into_iter()
        .map(|(key, count)| (key.to_owned(), count))
        .collect()
}

fn display_path(path: &Path) -> &str {
    path.to_str().expect("fixture path must be UTF-8")
}

#[test]
fn canonical_showcase_covers_the_complete_builtin_language_surface() {
    let fixture = fixture_path();
    let source = std::fs::read_to_string(&fixture)
        .unwrap_or_else(|error| panic!("read canonical showcase {}: {error}", fixture.display()));
    assert_eq!(source.len(), FIXTURE_BYTES, "canonical fixture byte drift");

    let diagnose = run([
        OsStr::new("diagnose"),
        OsStr::new("--json"),
        fixture.as_os_str(),
    ]);
    assert_eq!(diagnose.status.code(), Some(0));
    assert!(stderr(&diagnose).is_empty(), "{}", stderr(&diagnose));
    let report: Value = serde_json::from_str(stdout(&diagnose)).expect("decode diagnose JSON");

    assert_eq!(report["reportVersion"], "colorful.diagnose/v1");
    assert_eq!(report["source"]["utf8ByteLength"], FIXTURE_BYTES);
    assert_eq!(report["source"]["contentHash"], FIXTURE_SHA256);
    assert_eq!(
        report["summary"],
        serde_json::json!({
            "ansiColoredTokens": 140,
            "diagnostics": 4,
            "graftStyledTokens": 113,
            "lspSemanticTokens": 113,
            "tokens": 223,
        })
    );

    let tokens = report["tokens"]
        .as_array()
        .expect("diagnostic tokens array");
    assert_eq!(
        count_strings(tokens.iter().map(|token| &token["visualRole"])),
        expected_counts([
            ("ADJECTIVE", 7),
            ("ADVERB", 7),
            ("LITERAL", 1),
            ("MUTED", 27),
            ("NOUN", 7),
            ("QUOTED", 6),
            ("STRUCTURAL_KEYWORD", 74),
            ("TYPE_LIKE", 3),
            ("UNSTYLED", 83),
            ("VERB", 8),
        ])
    );
    assert_eq!(
        count_strings(
            tokens
                .iter()
                .map(|token| &token["lspTokenType"])
                .filter(|value| !value.is_null()),
        ),
        expected_counts([
            ("adjective", 7),
            ("adverb", 7),
            ("class", 3),
            ("keyword", 74),
            ("noun", 7),
            ("number", 1),
            ("string", 6),
            ("verb", 8),
        ])
    );

    let ambiguity: Vec<_> = tokens
        .iter()
        .filter(|token| {
            matches!(
                token["text"].as_str(),
                Some("book" | "record" | "lead" | "fast")
            )
        })
        .map(|token| {
            (
                token["text"].as_str().expect("probe text"),
                token["openClassKind"].as_str().expect("probe open class"),
                token["visualRole"].as_str().expect("probe visual role"),
            )
        })
        .collect();
    assert_eq!(
        ambiguity,
        [
            ("book", "NOUN", "NOUN"),
            ("book", "VERB", "VERB"),
            ("record", "NOUN", "NOUN"),
            ("record", "VERB", "VERB"),
            ("lead", "ADJECTIVE", "ADJECTIVE"),
            ("lead", "VERB", "VERB"),
            ("fast", "ADJECTIVE", "ADJECTIVE"),
            ("fast", "ADVERB", "ADVERB"),
        ]
    );

    let lint = run([OsStr::new("lint"), fixture.as_os_str()]);
    assert_eq!(lint.status.code(), Some(1));
    assert!(stderr(&lint).is_empty(), "{}", stderr(&lint));
    let path = display_path(&fixture);
    let expected_lint = format!(
        "{path}:11:27: info [weak-word]: weak word 'really'\n\
         {path}:12:12: info [passive-voice]: passive-voice candidate 'was reviewed'\n\
         {path}:15:1: info [length-outlier]: sentence is 29 words; the document averages 10\n\
         {path}:16:1: warning [run-on]: sentence runs to 50 words\n"
    );
    assert_eq!(stdout(&lint), expected_lint);

    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let tree = parser.parse(&source);
    let classified = annotator.annotate(&source, &tree);
    let findings = ProseLinter::new().analyze(&source, &tree, &classified);
    let actual_findings: Vec<_> = findings
        .iter()
        .map(|finding| {
            let (line, column) = colorful_cli::line_col(&source, finding.span.start);
            (
                finding.rule.code(),
                finding.severity,
                finding.message.as_str(),
                line,
                column,
            )
        })
        .collect();
    assert_eq!(
        actual_findings,
        [
            ("weak-word", Severity::Info, "weak word 'really'", 11, 27),
            (
                "passive-voice",
                Severity::Info,
                "passive-voice candidate 'was reviewed'",
                12,
                12,
            ),
            (
                "length-outlier",
                Severity::Info,
                "sentence is 29 words; the document averages 10",
                15,
                1,
            ),
            (
                "run-on",
                Severity::Warning,
                "sentence runs to 50 words",
                16,
                1,
            ),
        ]
    );
}

#[test]
fn full_spectrum_demo_is_completely_styled_and_lint_clean() {
    let fixture = demo_path();
    let source = std::fs::read_to_string(&fixture)
        .unwrap_or_else(|error| panic!("read full-spectrum demo {}: {error}", fixture.display()));
    assert_eq!(source, DEMO_SOURCE, "canonical demo source drift");
    assert_eq!(source.len(), DEMO_BYTES, "canonical demo byte drift");

    let passthrough = run([OsStr::new("--no-color"), fixture.as_os_str()]);
    assert_eq!(passthrough.status.code(), Some(0));
    assert!(stderr(&passthrough).is_empty(), "{}", stderr(&passthrough));
    assert_eq!(stdout(&passthrough), source);

    let diagnose = run([
        OsStr::new("diagnose"),
        OsStr::new("--json"),
        fixture.as_os_str(),
    ]);
    assert_eq!(diagnose.status.code(), Some(0));
    assert!(stderr(&diagnose).is_empty(), "{}", stderr(&diagnose));
    let report: Value = serde_json::from_str(stdout(&diagnose)).expect("decode diagnose JSON");

    assert_eq!(report["source"]["utf8ByteLength"], DEMO_BYTES);
    assert_eq!(report["source"]["contentHash"], DEMO_SHA256);
    assert_eq!(report["summary"]["tokens"], 35);
    assert_eq!(report["summary"]["ansiColoredTokens"], 35);
    assert_eq!(report["summary"]["graftStyledTokens"], 31);
    assert_eq!(report["summary"]["lspSemanticTokens"], 31);
    assert_eq!(report["summary"]["diagnostics"], 0);

    let tokens = report["tokens"]
        .as_array()
        .expect("diagnostic tokens array");
    assert!(
        tokens.iter().all(|token| token["visualRole"] != "UNSTYLED"),
        "beauty-shot prose must remain completely styled"
    );

    let lsp_types: BTreeSet<_> = tokens
        .iter()
        .filter_map(|token| token["lspTokenType"].as_str())
        .collect();
    assert_eq!(
        lsp_types,
        BTreeSet::from([
            "adjective",
            "adverb",
            "class",
            "keyword",
            "noun",
            "number",
            "string",
            "verb",
        ])
    );

    let open_class: Vec<_> = tokens
        .iter()
        .filter_map(|token| Some((token["text"].as_str()?, token["openClassKind"].as_str()?)))
        .collect();
    assert_eq!(
        open_class,
        [
            ("writes", "VERB"),
            ("carefully", "ADVERB"),
            ("silent", "ADJECTIVE"),
            ("river", "NOUN"),
            ("glows", "VERB"),
            ("slowly", "ADVERB"),
            ("mountain", "NOUN"),
            ("quick", "ADJECTIVE"),
            ("cat", "NOUN"),
            ("connects", "VERB"),
            ("silently", "ADVERB"),
            ("careful", "ADJECTIVE"),
            ("dog", "NOUN"),
            ("quickly", "ADVERB"),
            ("renders", "VERB"),
            ("structural", "ADJECTIVE"),
            ("record", "NOUN"),
        ]
    );

    let lint = run([OsStr::new("lint"), fixture.as_os_str()]);
    assert_eq!(lint.status.code(), Some(0));
    assert!(stdout(&lint).is_empty(), "{}", stdout(&lint));
    assert!(stderr(&lint).is_empty(), "{}", stderr(&lint));
}
