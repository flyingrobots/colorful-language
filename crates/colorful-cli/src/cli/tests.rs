use super::args::*;
use super::color::*;
use super::diagnose::*;
use super::format::*;
use super::lint::*;
use std::io;

#[test]
fn passthrough_when_color_disabled() {
    let s = "The cat is 3.\nA second line.";
    assert_eq!(colorize(s, false), s);
}

#[test]
fn markdown_lint_matches_lsp_prose_regions_while_plain_text_stays_whole_document() {
    let source = concat!(
        "The cat is really clear.\n\n",
        "```text\n",
        "The cat is really clear.\n",
        "```\n",
    );
    let mut markdown = Vec::new();
    let mut plain_text = Vec::new();

    assert!(lint_to_writer("fixture.md", source, &mut markdown).unwrap());
    assert!(lint_to_writer("fixture.txt", source, &mut plain_text).unwrap());

    let markdown = String::from_utf8(markdown).expect("UTF-8 lint output");
    let plain_text = String::from_utf8(plain_text).expect("UTF-8 lint output");
    assert_eq!(markdown.lines().count(), 1, "{markdown}");
    assert_eq!(plain_text.lines().count(), 2, "{plain_text}");
    assert!(markdown.starts_with("fixture.md:1:12: info [weak-word]"));
}

#[test]
fn file_format_detection_is_extension_bounded_and_case_insensitive() {
    let source = "Prose.\n\n```text\nThe cat connects.\n```\n";

    for name in ["fixture.md", "fixture.MARKDOWN"] {
        let analysis = analysis_source_for(Some(name), source);
        assert_ne!(analysis, source, "{name}");
        assert!(
            analysis
                .lines()
                .nth(3)
                .expect("fenced content line")
                .chars()
                .all(char::is_whitespace),
            "{name}: {analysis:?}"
        );
    }
    for name in [
        None,
        Some("<stdin>"),
        Some("fixture.txt"),
        Some("fixture.md.txt"),
    ] {
        assert_eq!(analysis_source_for(name, source), source, "{name:?}");
    }
}

#[test]
fn projection_for_none_role_is_none() {
    // sgr() and diagnose_json() both feed visual_role_for()/visual_role()'s
    // Option through projection_for(). Every real PosClass currently has a
    // manifest entry, so a missing role can't arise from production
    // input — this exercises the shared composition directly instead.
    assert!(projection_for(None).is_none());
}

#[test]
fn golden_colored_output() {
    // "The" (function), cat (seed noun), "is" (function), 3 (number),
    // "." (punctuation), with whitespace preserved verbatim.
    let got = colorize("The cat is 3.", true);
    let want = "\x1b[1;35mThe\x1b[0m \x1b[34mcat\x1b[0m \x1b[1;35mis\x1b[0m \x1b[36m3\x1b[0m\x1b[90m.\x1b[0m";
    assert_eq!(got, want);
}

#[test]
fn golden_proper_noun_output() {
    // Mid-sentence capitalized "Paris" becomes a (bold yellow) proper noun.
    let got = colorize("I visited Paris.", true);
    let want = "\x1b[1;35mI\x1b[0m visited \x1b[1;33mParis\x1b[0m\x1b[90m.\x1b[0m";
    assert_eq!(got, want);
}

#[test]
fn default_colorizer_emits_seed_open_class_roles() {
    let got = colorize("cat connects quick silently.", true);
    let want = concat!(
        "\x1b[34mcat\x1b[0m ",
        "\x1b[31mconnects\x1b[0m ",
        "\x1b[33mquick\x1b[0m ",
        "\x1b[35msilently\x1b[0m",
        "\x1b[90m.\x1b[0m",
    );
    assert_eq!(got, want);
}

#[test]
fn default_colorizer_emits_contextual_open_class_roles() {
    let got = colorize("the book I book rooms the fast river connects fast.", true);
    let want = concat!(
        "\x1b[1;35mthe\x1b[0m ",
        "\x1b[34mbook\x1b[0m ",
        "\x1b[1;35mI\x1b[0m ",
        "\x1b[31mbook\x1b[0m ",
        "rooms ",
        "\x1b[1;35mthe\x1b[0m ",
        "\x1b[33mfast\x1b[0m ",
        "\x1b[34mriver\x1b[0m ",
        "\x1b[31mconnects\x1b[0m ",
        "\x1b[35mfast\x1b[0m",
        "\x1b[90m.\x1b[0m",
    );
    assert_eq!(got, want);
}

#[test]
fn ir_uses_default_seed_open_class_roles() {
    use colorful_ir::syntax_v1::OpenClassKind;

    let doc = analyze_ir("fixture.txt", "cat connects quick silently.").unwrap();
    let classes: Vec<_> = doc
        .tokens
        .iter()
        .filter_map(|token| token.open_class_kind.clone())
        .collect();
    assert_eq!(
        classes,
        vec![
            OpenClassKind::Noun,
            OpenClassKind::Verb,
            OpenClassKind::Adjective,
            OpenClassKind::Adverb,
        ]
    );
}

#[test]
fn ir_uses_contextual_open_class_roles() {
    use colorful_ir::syntax_v1::OpenClassKind;

    let source = "the book I book rooms the fast river connects fast.";
    let doc = analyze_ir("fixture.txt", source).unwrap();
    let classes: Vec<_> = doc
        .tokens
        .iter()
        .filter_map(|token| {
            let kind = token.open_class_kind.clone()?;
            let start = token.byte_range.start_utf8 as usize;
            let end = token.byte_range.end_utf8 as usize;
            Some((&source[start..end], kind))
        })
        .collect();

    assert_eq!(
        classes,
        vec![
            ("book", OpenClassKind::Noun),
            ("book", OpenClassKind::Verb),
            ("fast", OpenClassKind::Adjective),
            ("river", OpenClassKind::Noun),
            ("connects", OpenClassKind::Verb),
            ("fast", OpenClassKind::Adverb),
        ]
    );
}

#[test]
fn diagnose_json_reports_token_roles_and_lsp_types() {
    let report = diagnose_json("fixture.txt", "The cat connects fast.").unwrap();
    let value: serde_json::Value = serde_json::from_str(&report).unwrap();

    assert_eq!(value["reportVersion"], "colorful.diagnose/v1");
    assert_eq!(value["tool"]["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(
        value["contracts"]["vocabulary"]["lspLegend"],
        serde_json::json!([
            "keyword",
            "class",
            "number",
            "string",
            "noun",
            "verb",
            "adjective",
            "adverb"
        ])
    );
    assert_eq!(value["summary"]["tokens"], 5);
    assert_eq!(value["summary"]["lspSemanticTokens"], 4);
    assert_eq!(value["summary"]["diagnostics"], 0);

    let tokens = value["tokens"].as_array().unwrap();
    assert_eq!(tokens[0]["text"], "The");
    assert_eq!(tokens[0]["lexicalClass"], "FUNCTION");
    assert_eq!(tokens[0]["functionKind"], "ARTICLE");
    assert_eq!(tokens[0]["visualRole"], "STRUCTURAL_KEYWORD");
    assert_eq!(tokens[0]["lspTokenType"], "keyword");
    assert_eq!(tokens[0]["lspTokenTypeIndex"], 0);

    assert_eq!(tokens[1]["text"], "cat");
    assert_eq!(tokens[1]["openClassKind"], "NOUN");
    assert_eq!(tokens[1]["visualRole"], "NOUN");
    assert_eq!(tokens[1]["lspTokenType"], "noun");
    assert_eq!(tokens[1]["lspTokenTypeIndex"], 4);

    assert_eq!(tokens[2]["text"], "connects");
    assert_eq!(tokens[2]["openClassKind"], "VERB");
    assert_eq!(tokens[2]["lspTokenType"], "verb");

    assert_eq!(tokens[3]["text"], "fast");
    assert_eq!(tokens[3]["openClassKind"], "ADVERB");
    assert_eq!(tokens[3]["lspTokenType"], "adverb");

    assert_eq!(tokens[4]["text"], ".");
    assert_eq!(tokens[4]["tokenKind"], "PUNCTUATION");
    assert!(tokens[4]["lspTokenType"].is_null());
    assert!(tokens[4]["lspTokenTypeIndex"].is_null());
}

#[test]
fn diagnose_json_covers_editor_smoke_fixture() {
    let source = include_str!("../../fixtures/editor-smoke-prose.txt");
    let report = diagnose_json("fixtures/editor-smoke-prose.txt", source).unwrap();
    let value: serde_json::Value = serde_json::from_str(&report).unwrap();

    assert_eq!(value["source"]["utf8ByteLength"], 899);
    assert_eq!(
        value["source"]["contentHash"],
        "sha256:94a03286a53a888248512692865d2947ccf48c3c15247c0683f9aa3f76b82a0c"
    );
    assert_eq!(
        value["summary"],
        serde_json::json!({
            "ansiColoredTokens": 102,
            "diagnostics": 0,
            "graftStyledTokens": 75,
            "lspSemanticTokens": 75,
            "tokens": 173,
        })
    );

    let tokens = value["tokens"].as_array().unwrap();
    assert_eq!(
        count_field(tokens, "lspTokenType"),
        [
            ("<null>", 98),
            ("adjective", 5),
            ("adverb", 6),
            ("class", 4),
            ("keyword", 40),
            ("noun", 7),
            ("number", 1),
            ("string", 4),
            ("verb", 8),
        ]
        .into_iter()
        .map(|(key, count)| (key.to_string(), count))
        .collect()
    );
    assert_eq!(
        count_field(tokens, "visualRole"),
        [
            ("ADJECTIVE", 5),
            ("ADVERB", 6),
            ("LITERAL", 1),
            ("MUTED", 27),
            ("NOUN", 7),
            ("QUOTED", 4),
            ("STRUCTURAL_KEYWORD", 40),
            ("TYPE_LIKE", 4),
            ("UNSTYLED", 71),
            ("VERB", 8),
        ]
        .into_iter()
        .map(|(key, count)| (key.to_string(), count))
        .collect()
    );
}

#[test]
fn diagnose_rejects_multiple_file_operands() {
    let err = run_diagnose(["first.txt".to_string(), "second.txt".to_string()]).unwrap_err();

    assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    assert_eq!(err.to_string(), "expected at most one FILE argument");
}

#[test]
fn invalid_utf8_file_is_rejected_across_every_command() {
    // Every single-document command reads its file through
    // std::fs::read_to_string, which is strict about UTF-8 -- a malformed
    // file is rejected with a clear error, never silently lossy-converted
    // into corrupted-but-readable text.
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/invalid-utf8.bin").to_string();

    fn assert_invalid_utf8(err: &io::Error) {
        assert_eq!(err.kind(), io::ErrorKind::InvalidData, "{err}");
        assert_eq!(err.to_string(), "stream did not contain valid UTF-8");
    }

    assert_invalid_utf8(&run_color([path.clone()]).unwrap_err());
    assert_invalid_utf8(&run_ir([path.clone()]).unwrap_err());
    assert_invalid_utf8(&run_diagnose([path.clone()]).unwrap_err());
    assert_invalid_utf8(&run_lint([path]).unwrap_err());
}

#[test]
fn gaps_and_newlines_are_preserved_exactly() {
    // Stripping all ANSI escapes must reproduce the original source.
    let src = "Well,  \t\"quoted\"\n  text—here.";
    let colored = colorize(src, true);
    let stripped = strip_ansi(&colored);
    assert_eq!(stripped, src);
}

#[test]
fn double_dash_allows_dash_prefixed_paths() {
    // After `--`, a leading-dash argument is treated as a path: reading it
    // fails with NotFound, not an "unknown option" InvalidInput.
    let err = run(["--".to_string(), "-weird.txt".to_string()]).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::NotFound);
    // A flag-shaped argument after `--` is a literal path too, not
    // rejected as unknown.
    let err = run(["--".to_string(), "--weird-file".to_string()]).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::NotFound);
    // Without `--`, the same argument is rejected as an unknown option.
    let err = run(["-weird.txt".to_string()]).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn double_dash_then_bare_dash_still_means_stdin() {
    // `-` is a positional sentinel, not a flag: `colorful lint -- -` reads
    // stdin, it does not try to open a file literally named "-".
    match parse_input_args(Command::Lint, ["--".to_string(), "-".to_string()]).unwrap() {
        ParseOutcome::Run(parsed) => assert_eq!(parsed.path, None),
        ParseOutcome::Help => panic!("expected Run, got Help"),
    }
}

#[test]
fn repeating_a_recognized_flag_is_idempotent() {
    match parse_input_args(
        Command::Diagnose,
        ["--json".to_string(), "--json".to_string()],
    )
    .unwrap()
    {
        ParseOutcome::Run(parsed) => {
            assert!(parsed.has_flag("--json"));
            assert_eq!(parsed.flags.len(), 1);
        }
        ParseOutcome::Help => panic!("expected Run, got Help"),
    }
}

#[test]
fn a_second_file_operand_is_rejected_uniformly_across_subcommands() {
    // Previously only `diagnose` enforced "at most one FILE"; the shared
    // parser enforces it everywhere, before or after `--`.
    for prefix in [Vec::new(), vec!["--".to_string()]] {
        let mut args = prefix;
        args.push("first.txt".to_string());
        args.push("second.txt".to_string());
        let err = run_lint(args.clone()).unwrap_err();
        assert_eq!(err.to_string(), "expected at most one FILE argument");
        let err = run_ir(args).unwrap_err();
        assert_eq!(err.to_string(), "expected at most one FILE argument");
    }
}

#[test]
fn input_args_matrix_has_identical_operand_semantics_across_commands() {
    // Every single-document command must resolve FILE operands, the `-`
    // stdin sentinel, the `--` option terminator, and "too many files"
    // identically -- only which flags each recognizes may differ. This
    // exercises that cross-product directly against parse_input_args,
    // independent of any one command's flags or I/O.
    const COMMANDS: [Command; 4] = [
        Command::Color,
        Command::Ir,
        Command::Diagnose,
        Command::Lint,
    ];
    const TERMINATOR_PREFIXES: [&[&str]; 2] = [&[], &["--"]];

    fn run(command: Command, args: &[&str]) -> io::Result<ParseOutcome> {
        parse_input_args(command, args.iter().map(|a| a.to_string()))
    }

    fn expect_path(outcome: io::Result<ParseOutcome>, want: Option<&str>, ctx: String) {
        match outcome.unwrap_or_else(|e| panic!("{ctx}: unexpected error {e}")) {
            ParseOutcome::Run(parsed) => {
                assert_eq!(parsed.path.as_deref(), want, "{ctx}");
            }
            ParseOutcome::Help => panic!("{ctx}: unexpected help"),
        }
    }

    for command in COMMANDS {
        // Zero files: stdin.
        expect_path(run(command, &[]), None, format!("{command:?} zero files"));

        for prefix in TERMINATOR_PREFIXES {
            let ctx = |what: &str| format!("{command:?} {prefix:?} {what}");

            // One literal file.
            let mut args = prefix.to_vec();
            args.push("file.txt");
            expect_path(run(command, &args), Some("file.txt"), ctx("one file"));

            // The bare `-` stdin sentinel.
            let mut args = prefix.to_vec();
            args.push("-");
            expect_path(run(command, &args), None, ctx("dash sentinel"));

            // Two file operands are rejected.
            let mut args = prefix.to_vec();
            args.extend(["first.txt", "second.txt"]);
            let err = run(command, &args).unwrap_err();
            assert_eq!(
                err.to_string(),
                "expected at most one FILE argument",
                "{}",
                ctx("two files")
            );
        }

        // An unknown flag before `--` is rejected...
        let err = run(command, &["--bogus-flag"]).unwrap_err();
        assert_eq!(
            err.kind(),
            io::ErrorKind::InvalidInput,
            "{command:?} unknown flag before --"
        );

        // ...but the identical flag-shaped argument after `--` is a
        // literal path, not an unknown option.
        expect_path(
            run(command, &["--", "--bogus-flag"]),
            Some("--bogus-flag"),
            format!("{command:?} flag-shaped path after --"),
        );
    }
}

#[test]
fn version_flag_reports_package_version() {
    let want = format!("colorful {}\n", env!("CARGO_PKG_VERSION"));
    assert_eq!(version_output(), want);
    assert!(run(["--version".to_string()]).is_ok());
    assert!(run(["-V".to_string()]).is_ok());
}

#[test]
fn help_text_reports_package_version() {
    let help = help_text();
    assert!(help.starts_with(&format!(
        "colorful {} — color English prose by part of speech\n\n",
        env!("CARGO_PKG_VERSION")
    )));
    assert!(help.contains("-V, --version"));
    assert!(help.contains("colorful diagnose [--json] [FILE]"));
}

#[test]
fn version_flag_rejects_extra_arguments() {
    let err = run(["--version".to_string(), "extra".to_string()]).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn lint_reports_findings_in_compiler_style_and_signals_failure() {
    // "just" is a weak word at column 9; the report names the file, position,
    // severity, rule code, and message, and the writer reports a failure.
    let mut buf = Vec::new();
    let found = lint_to_writer("draft.txt", "This is just wrong.", &mut buf).unwrap();
    assert!(found, "findings should signal a non-zero exit");
    assert_eq!(
        String::from_utf8(buf).unwrap(),
        "draft.txt:1:9: info [weak-word]: weak word 'just'\n"
    );
}

#[test]
fn lint_of_clean_prose_prints_nothing_and_signals_success() {
    let mut buf = Vec::new();
    let found = lint_to_writer("clean.txt", "The cat sat on the mat.", &mut buf).unwrap();
    assert!(!found, "clean prose should signal a zero exit");
    assert!(buf.is_empty(), "clean prose should print nothing");
}

#[test]
fn lint_line_col_tracks_newlines() {
    // A run-on on the third line points at the start of that line's sentence.
    let src = "First line.\nSecond line.\nthird";
    assert_eq!(line_col(src, 0), (1, 1));
    assert_eq!(line_col(src, 12), (2, 1));
    assert_eq!(line_col(src, 25), (3, 1));
}

#[test]
fn lint_line_col_treats_crlf_as_one_break_and_bare_cr_as_a_break() {
    // \r\n is one break, not two.
    let crlf = "First.\r\nThis is just wrong.";
    assert_eq!(line_col(crlf, 8), (2, 1));

    // A bare \r (classic Mac line endings, no \n anywhere) is still a
    // break -- matching colorful_lsp::LineIndex, which treats it the
    // same way, so the CLI and LSP never disagree about the line.
    let bare_cr = "First.\rThis is just wrong.";
    assert_eq!(line_col(bare_cr, 7), (2, 1));
}

#[test]
fn lint_unknown_option_is_rejected() {
    let err = run(["lint".to_string(), "--bogus".to_string()]).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn decide_color_honors_flag_and_env() {
    assert!(decide_color(false, false));
    assert!(!decide_color(true, false));
    assert!(!decide_color(false, true));
    assert!(!decide_color(true, true));
}

/// Remove ANSI SGR sequences (`ESC [ ... m`) for round-trip checks.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Consume through the terminating 'm'.
            for d in chars.by_ref() {
                if d == 'm' {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn count_field(
    tokens: &[serde_json::Value],
    field: &str,
) -> std::collections::BTreeMap<String, usize> {
    let mut counts = std::collections::BTreeMap::new();
    for token in tokens {
        let key = token[field].as_str().unwrap_or("<null>");
        *counts.entry(key.to_string()).or_insert(0) += 1;
    }
    counts
}
