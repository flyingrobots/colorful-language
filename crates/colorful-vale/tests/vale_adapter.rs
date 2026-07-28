#![cfg(unix)]

use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use colorful_cli::{line_col, lint_report};
use colorful_core::{Analyzer, Severity, ValidatedClassification};
use colorful_ir::canonical_json;
use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
use colorful_lint::ProseLinter;
use colorful_lsp::{analyze_document, compute_diagnostics};
use colorful_parse::ProseParser;
use colorful_projection::build_document;
use colorful_vale::{
    CancellationToken, ValeAnalyzer, ValeConfig, ValeErrorKind, SUPPORTED_VALE_MAJOR,
};
use tower_lsp::lsp_types::{DiagnosticSeverity, NumberOrString, Position};

static FIXTURE_ID: AtomicU64 = AtomicU64::new(0);
static ENVIRONMENT_LOCK: Mutex<()> = Mutex::new(());

const SOURCE: &str = "😀 e\u{301}cho\r\nThis is very clear.\n";

const SUCCESS_JSON: &str = r#"{
  "stdin.txt": [
    {
      "Action": {"Name": "", "Params": null},
      "Span": [9, 12],
      "Check": "Style.Clarity",
      "Description": "Prefer a precise modifier.",
      "Link": "",
      "Message": "Consider replacing 'very'.",
      "Severity": "warning",
      "Match": "very",
      "Line": 2
    },
    {
      "Action": {"Name": "", "Params": null},
      "Span": [3, 7],
      "Check": "Style.Unicode",
      "Description": "Unicode coordinate witness.",
      "Link": "",
      "Message": "Review this word.",
      "Severity": "suggestion",
      "Match": "écho",
      "Line": 1
    }
  ]
}"#;
const VALE_3_14_2_SMOKE_JSON: &str = include_str!("fixtures/vale-3.14.2-smoke.json");

struct FakeVale {
    root: PathBuf,
    executable: PathBuf,
    configuration: PathBuf,
    arguments: PathBuf,
    captured_input: PathBuf,
    marker: PathBuf,
    worker_pid: PathBuf,
}

struct EnvironmentGuard {
    saved: Vec<(&'static str, Option<OsString>)>,
}

struct DirectoryGuard(PathBuf);

impl EnvironmentGuard {
    fn set(entries: &[(&'static str, &'static str)]) -> Self {
        let saved = entries
            .iter()
            .map(|(name, value)| {
                let previous = std::env::var_os(name);
                std::env::set_var(name, value);
                (*name, previous)
            })
            .collect();
        Self { saved }
    }
}

impl Drop for DirectoryGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

impl Drop for EnvironmentGuard {
    fn drop(&mut self) {
        for (name, value) in self.saved.drain(..).rev() {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
}

impl FakeVale {
    fn new(version: &str, analysis_body: &str) -> Self {
        let root = loop {
            let id = FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
            let candidate = std::env::temp_dir()
                .join(format!("colorful-vale-test-{}-{id}", std::process::id()));
            match fs::create_dir(&candidate) {
                Ok(()) => break candidate,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("create fake Vale root {}: {error}", candidate.display()),
            }
        };
        let executable = root.join("vale");
        let configuration = root.join(".vale.ini");
        let arguments = root.join("arguments.txt");
        let captured_input = root.join("input.txt");
        let marker = root.join("started");
        let worker_pid = root.join("worker.pid");
        let analysis_body = analysis_body
            .replace("{FAKE_VALE_MARKER}", &marker.display().to_string())
            .replace("{FAKE_VALE_WORKER_PID}", &worker_pid.display().to_string());
        fs::write(
            &configuration,
            "StylesPath = styles\n[*.txt]\nBasedOnStyles = Test\n",
        )
        .expect("write fake Vale configuration");
        fs::create_dir(root.join("styles")).expect("create fake styles directory");

        let script = format!(
            r#"#!/bin/sh
if [ "${{VALE_CONFIG_PATH+x}}" = x ] ||
   [ "${{VALE_STYLES_PATH+x}}" = x ] ||
   [ "${{HOME+x}}" = x ] ||
   [ "${{XDG_CONFIG_HOME+x}}" = x ] ||
   [ "${{HTTP_PROXY+x}}" = x ] ||
   [ "${{HTTPS_PROXY+x}}" = x ] ||
   [ "${{NO_PROXY+x}}" = x ]; then
  printf '%s\n' 'ambient environment leaked into adapter' >&2
  exit 91
fi
if [ "${{PATH-}}" != "/usr/bin:/bin" ]; then
  printf '%s\n' 'adapter did not install the reviewed executable PATH' >&2
  exit 93
fi
if [ "${{1-}}" = "--version" ]; then
  if [ "$#" -ne 1 ]; then
    printf '%s\n' 'Vale discovery received unexpected arguments' >&2
    exit 92
  fi
  printf '%s\n' 'vale version {version}'
  exit 0
fi
printf '%s\n' "$@" > '{arguments}'
cat > '{captured_input}'
{analysis_body}
"#,
            arguments = arguments.display(),
            captured_input = captured_input.display(),
        );
        fs::write(&executable, script).expect("write fake Vale executable");
        let mut permissions = fs::metadata(&executable)
            .expect("fake Vale metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).expect("make fake Vale executable");

        Self {
            root,
            executable,
            configuration,
            arguments,
            captured_input,
            marker,
            worker_pid,
        }
    }

    fn config(&self) -> ValeConfig {
        ValeConfig::new(&self.executable, &self.configuration)
    }
}

impl Drop for FakeVale {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn success_fixture() -> FakeVale {
    success_fixture_for("stdin.txt")
}

fn success_fixture_for(source_key: &str) -> FakeVale {
    let json = SUCCESS_JSON.replacen("stdin.txt", source_key, 1);
    FakeVale::new(
        "3.14.2",
        &format!("printf '%s\\n' '{}'", json.replace('\'', "'\\''")),
    )
}

fn classification(source: &str) -> ValidatedClassification<'_> {
    ValidatedClassification::from_ports(
        source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default(),
    )
    .expect("valid production classification")
}

fn error_kind(result: Result<ValeAnalyzer, colorful_vale::ValeError>) -> ValeErrorKind {
    result.expect_err("expected discovery failure").kind()
}

#[test]
fn discovery_is_explicit_versioned_and_ambient_config_free() {
    let _environment_lock = ENVIRONMENT_LOCK.lock().expect("environment lock");
    let _environment = EnvironmentGuard::set(&[
        ("VALE_CONFIG_PATH", "/ambient/config"),
        ("VALE_STYLES_PATH", "/ambient/styles"),
        ("XDG_CONFIG_HOME", "/ambient/xdg"),
        ("HTTP_PROXY", "http://ambient.invalid"),
        ("HTTPS_PROXY", "https://ambient.invalid"),
        ("NO_PROXY", "ambient.invalid"),
    ]);
    let fixture = success_fixture();

    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale v3");

    assert_eq!(SUPPORTED_VALE_MAJOR, 3);
    assert_eq!(analyzer.capabilities().major(), 3);
    assert_eq!(analyzer.capabilities().version(), "3.14.2");
    assert!(analyzer.capabilities().json_output());
    assert!(analyzer.capabilities().stdin_input());
}

#[test]
fn discovery_rejects_missing_config_executable_and_major() {
    let fixture = success_fixture();
    let missing_config = fixture.root.join("missing.ini");
    assert_eq!(
        error_kind(ValeAnalyzer::discover(ValeConfig::new(
            &fixture.executable,
            missing_config,
        ))),
        ValeErrorKind::Configuration
    );
    assert_eq!(
        error_kind(ValeAnalyzer::discover(ValeConfig::new(
            fixture.root.join("missing-vale"),
            &fixture.configuration,
        ))),
        ValeErrorKind::Unavailable
    );

    let incompatible = FakeVale::new("4.0.0", "printf '%s\\n' '{}'");
    assert_eq!(
        error_kind(ValeAnalyzer::discover(incompatible.config())),
        ValeErrorKind::IncompatibleVersion
    );
}

#[test]
fn discovery_distinguishes_malformed_and_incompatible_versions() {
    for version in ["3.0.0-beta1", "3.9.1+build", "99999999999999999999.1.1"] {
        let malformed = FakeVale::new(version, "printf '%s\\n' '{}'");
        assert_eq!(
            error_kind(ValeAnalyzer::discover(malformed.config())),
            ValeErrorKind::UnrecognizedVersion,
            "{version:?}"
        );
    }

    let incompatible = FakeVale::new("4.0.0", "printf '%s\\n' '{}'");
    assert_eq!(
        error_kind(ValeAnalyzer::discover(incompatible.config())),
        ValeErrorKind::IncompatibleVersion
    );
}

#[test]
fn permission_denied_executable_is_unavailable() {
    let fixture = success_fixture();
    let mut permissions = fs::metadata(&fixture.executable)
        .expect("fake Vale metadata")
        .permissions();
    permissions.set_mode(0o644);
    fs::set_permissions(&fixture.executable, permissions).expect("remove execute permission");

    assert_eq!(
        error_kind(ValeAnalyzer::discover(fixture.config())),
        ValeErrorKind::Unavailable
    );
}

#[test]
fn analysis_uses_exact_isolated_stdin_contract() {
    let fixture = success_fixture();
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let prepared = analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect("analyze fixture");

    assert_eq!(fs::read_to_string(&fixture.captured_input).unwrap(), SOURCE);
    let args = fs::read_to_string(&fixture.arguments).unwrap();
    let arguments: Vec<_> = args.lines().collect();
    assert_eq!(arguments[0], "--output=JSON");
    assert_eq!(arguments[1], "--no-exit");
    assert_eq!(arguments[2], "--no-global");
    assert_eq!(
        arguments[3],
        format!("--config={}", fixture.configuration.display())
    );
    assert_eq!(arguments[4], "--ext=.txt");
    assert_eq!(arguments.len(), 5);
    assert_eq!(
        prepared.bind("different source").unwrap_err().kind(),
        ValeErrorKind::SourceMismatch
    );
}

#[test]
fn bound_analyzer_rejects_source_identity_bypass_without_exposing_text() {
    let fixture = success_fixture();
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let prepared = analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect("analyze fixture");
    let bound = prepared.bind(SOURCE).expect("bind source identity");
    let classified = classification(SOURCE);

    let panic = std::panic::catch_unwind(|| {
        bound.analyze(
            "different secret source",
            classified.tree(),
            classified.tokens(),
        )
    })
    .expect_err("source mismatch must panic");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .expect("panic payload must be text");
    assert_eq!(
        message,
        "BoundValeAnalyzer must be used with the source accepted by bind()"
    );
    assert!(!message.contains(SOURCE));
    assert!(!message.contains("different secret source"));
}

#[test]
fn analysis_honors_the_explicit_document_extension() {
    let fixture = success_fixture_for("stdin.md");
    let analyzer = ValeAnalyzer::discover(fixture.config().with_extension(".md"))
        .expect("discover Markdown-configured Vale");
    analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect("analyze Markdown fixture");
    let args = fs::read_to_string(&fixture.arguments).expect("read arguments");
    assert_eq!(args.lines().nth(4), Some("--ext=.md"));

    assert_eq!(
        error_kind(ValeAnalyzer::discover(
            fixture.config().with_extension("md")
        )),
        ValeErrorKind::Configuration
    );
}

#[test]
fn running_process_can_be_cancelled_after_start() {
    let fixture = Arc::new(FakeVale::new(
        "3.14.2",
        r#"(
  trap '' HUP TERM
  while :; do :; done
) >/dev/null 2>&1 &
printf '%s\n' "$!" > '{FAKE_VALE_WORKER_PID}'
: > '{FAKE_VALE_MARKER}'
wait"#,
    ));
    let analyzer =
        Arc::new(ValeAnalyzer::discover(fixture.config()).expect("discover cancellable Vale"));
    let cancellation = CancellationToken::new();
    let worker_cancellation = cancellation.clone();
    let worker_analyzer = Arc::clone(&analyzer);
    let worker = thread::spawn(move || worker_analyzer.analyze(SOURCE, &worker_cancellation));

    let deadline = Instant::now() + Duration::from_secs(2);
    while !fixture.marker.exists() && Instant::now() < deadline {
        thread::yield_now();
    }
    assert!(fixture.marker.exists(), "fake Vale never entered analysis");
    cancellation.cancel();
    let error = worker
        .join()
        .expect("analysis worker")
        .expect_err("cancelled analysis");
    assert_eq!(error.kind(), ValeErrorKind::Cancelled);
    assert_worker_terminated(&fixture);
}

#[test]
fn timeout_and_process_failure_are_distinct() {
    let timeout = FakeVale::new("3.14.2", "while :; do :; done");
    let analyzer = ValeAnalyzer::discover(timeout.config().with_timeout(Duration::from_millis(50)))
        .expect("discover timeout fixture");
    assert_eq!(
        analyzer
            .analyze(SOURCE, &CancellationToken::new())
            .expect_err("timed out analysis")
            .kind(),
        ValeErrorKind::Timeout
    );

    let failed = FakeVale::new("3.14.2", "printf '%s\\n' 'deliberate failure' >&2\nexit 7");
    let analyzer = ValeAnalyzer::discover(failed.config()).expect("discover failure fixture");
    assert_eq!(
        analyzer
            .analyze(SOURCE, &CancellationToken::new())
            .expect_err("failed analysis")
            .kind(),
        ValeErrorKind::ProcessFailure
    );
}

#[test]
fn timeout_terminates_wrapper_process_group() {
    let fixture = FakeVale::new(
        "3.14.2",
        r#"(
  trap '' HUP TERM
  while :; do :; done
) >/dev/null 2>&1 &
printf '%s\n' "$!" > '{FAKE_VALE_WORKER_PID}'
wait"#,
    );
    let analyzer = ValeAnalyzer::discover(fixture.config().with_timeout(Duration::from_millis(50)))
        .expect("discover wrapper fixture");

    let error = analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect_err("wrapper analysis must time out");
    assert_eq!(error.kind(), ValeErrorKind::Timeout);

    assert_worker_terminated(&fixture);
}

#[test]
fn timeout_remains_active_while_descendants_hold_output_pipes() {
    let fixture = FakeVale::new(
        "3.14.2",
        r#"(
  trap '' HUP TERM
  /bin/sleep 0.5
) &
printf '%s\n' "$!" > '{FAKE_VALE_WORKER_PID}'
exit 0"#,
    );
    let analyzer = ValeAnalyzer::discover(fixture.config().with_timeout(Duration::from_millis(50)))
        .expect("discover exited-wrapper fixture");

    let error = analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect_err("inherited output pipes must remain under the timeout");
    assert_eq!(error.kind(), ValeErrorKind::Timeout);
    assert_worker_terminated(&fixture);
}

fn assert_worker_terminated(fixture: &FakeVale) {
    let worker_pid: u32 = fs::read_to_string(&fixture.worker_pid)
        .expect("wrapper must record worker PID")
        .trim()
        .parse()
        .expect("worker PID must be numeric");
    let deadline = Instant::now() + Duration::from_secs(2);
    while process_exists(worker_pid) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(2));
    }
    let worker_survived = process_exists(worker_pid);
    if worker_survived {
        kill_process(worker_pid);
    }
    assert!(
        !worker_survived,
        "timed-out analyzer left worker process {worker_pid} alive"
    );
}

fn process_exists(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("probe worker process")
        .success()
}

fn kill_process(pid: u32) {
    let status = Command::new("/bin/kill")
        .args(["-KILL", &pid.to_string()])
        .status()
        .expect("clean up leaked worker process");
    assert!(status.success(), "clean up worker process {pid}");
}

#[test]
fn malformed_outputs_fail_closed_by_category() {
    let fixtures = [
        (
            "printf '\\377'",
            ValeConfig::default_output_limit(),
            ValeErrorKind::InvalidUtf8,
        ),
        (
            "printf '%s' '{'",
            ValeConfig::default_output_limit(),
            ValeErrorKind::MalformedOutput,
        ),
        (
            "printf '%s' '[]'",
            ValeConfig::default_output_limit(),
            ValeErrorKind::MalformedOutput,
        ),
        (
            "printf '%s' '{\"stdin.txt\":[{\"Span\":[1,1]}]}'",
            ValeConfig::default_output_limit(),
            ValeErrorKind::InvalidAlert,
        ),
        (
            "printf '%s\\n' '{\"stdin.txt\":[{\"Action\":{\"Name\":\"\",\"Params\":null},\"Span\":[7,3],\"Check\":\"Style.Bad\",\"Description\":\"\",\"Link\":\"\",\"Message\":\"bad\",\"Severity\":\"warning\",\"Match\":\"bad\",\"Line\":1}]}'",
            ValeConfig::default_output_limit(),
            ValeErrorKind::InvalidAlert,
        ),
        (
            "printf '%s' '0123456789abcdef0123456789abcdef'",
            24,
            ValeErrorKind::OutputTooLarge,
        ),
        (
            "printf '%s' '{\"other.txt\":[]}'",
            ValeConfig::default_output_limit(),
            ValeErrorKind::SourceMismatch,
        ),
    ];

    for (body, limit, expected) in fixtures {
        let fixture = FakeVale::new("3.14.2", body);
        let analyzer = ValeAnalyzer::discover(fixture.config().with_output_limit(limit))
            .expect("discover malformed-output fixture");
        let error = analyzer
            .analyze(SOURCE, &CancellationToken::new())
            .expect_err("reject malformed output");
        assert_eq!(error.kind(), expected);
    }
}

#[test]
fn required_alert_text_precedes_coordinate_validation() {
    let cases = [
        (
            SUCCESS_JSON
                .replacen("\"Span\": [9, 12]", "\"Span\": []", 1)
                .replacen("\"Check\": \"Style.Clarity\"", "\"Check\": \"\"", 1),
            "Vale alert check is empty",
        ),
        (
            SUCCESS_JSON
                .replacen("\"Span\": [9, 12]", "\"Span\": []", 1)
                .replacen(
                    "\"Message\": \"Consider replacing 'very'.\"",
                    "\"Message\": \"\"",
                    1,
                ),
            "Style.Clarity alert message is empty",
        ),
    ];

    for (json, expected_message) in cases {
        let fixture = FakeVale::new(
            "3.14.2",
            &format!("printf '%s\\n' '{}'", json.replace('\'', "'\\''")),
        );
        let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
        let error = analyzer
            .analyze(SOURCE, &CancellationToken::new())
            .expect_err("reject required text before coordinates");
        assert_eq!(error.kind(), ValeErrorKind::InvalidAlert);
        assert_eq!(error.message(), expected_message);
    }
}

#[test]
fn alerts_normalize_to_legal_ordered_colorful_findings() {
    let fixture = success_fixture();
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let prepared = analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect("analyze fixture");
    let bound = prepared.bind(SOURCE).expect("bind source identity");
    let classified = classification(SOURCE);
    let findings = bound.analyze(classified.source(), classified.tree(), classified.tokens());

    assert_eq!(findings.len(), 2);
    assert_eq!(findings[0].span.slice(SOURCE), "e\u{301}cho");
    assert_eq!(findings[0].span.start, 5);
    assert_eq!(findings[0].span.end, 11);
    assert_eq!(findings[0].rule.code(), "vale/Style.Unicode");
    assert_eq!(findings[0].severity, Severity::Info);
    assert_eq!(findings[0].message, "Review this word.");
    assert_eq!(findings[1].span.slice(SOURCE), "very");
    assert_eq!(findings[1].span.start, 21);
    assert_eq!(findings[1].span.end, 25);
    assert_eq!(findings[1].rule.code(), "vale/Style.Clarity");
    assert_eq!(findings[1].severity, Severity::Warning);
    assert_eq!(line_col(SOURCE, findings[0].span.start), (1, 3));
    assert_eq!(line_col(SOURCE, findings[1].span.start), (2, 9));
}

#[test]
fn vale_v3_inclusive_rune_endpoints_and_severities_are_preserved() {
    let source = "one 😀 three";
    let json = r#"{
  "stdin.txt": [
    {
      "Action": {"Name": "", "Params": null},
      "Span": [1, 3],
      "Check": "Style.Info",
      "Description": "",
      "Link": "",
      "Message": "Suggestion.",
      "Severity": "suggestion",
      "Match": "one",
      "Line": 1
    },
    {
      "Action": {"Name": "", "Params": null},
      "Span": [5, 5],
      "Check": "Style.Error",
      "Description": "",
      "Link": "",
      "Message": "Error.",
      "Severity": "error",
      "Match": "😀",
      "Line": 1
    },
    {
      "Action": {"Name": "", "Params": null},
      "Span": [7, 11],
      "Check": "Style.Warning",
      "Description": "",
      "Link": "",
      "Message": "Warning.",
      "Severity": "warning",
      "Match": "three",
      "Line": 1
    }
  ]
}"#;
    let fixture = FakeVale::new(
        "3.14.2",
        &format!("printf '%s\\n' '{}'", json.replace('\'', "'\\''")),
    );
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let findings = analyzer
        .analyze(source, &CancellationToken::new())
        .expect("normalize authoritative span fixture")
        .findings()
        .to_vec();

    assert_eq!(
        findings
            .iter()
            .map(|finding| finding.span.slice(source))
            .collect::<Vec<_>>(),
        ["one", "😀", "three"]
    );
    assert_eq!(
        findings
            .iter()
            .map(|finding| finding.severity)
            .collect::<Vec<_>>(),
        [Severity::Info, Severity::Warning, Severity::Warning]
    );
}

#[test]
fn pinned_real_vale_v3_smoke_shape_remains_admitted() {
    let fixture = FakeVale::new(
        "3.14.2",
        &format!(
            "printf '%s\\n' '{}'",
            VALE_3_14_2_SMOKE_JSON.replace('\'', "'\\''")
        ),
    );
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let prepared = analyzer
        .analyze("This is very clear.\n", &CancellationToken::new())
        .expect("admit pinned Vale output");
    assert_eq!(prepared.findings().len(), 1);
    assert_eq!(prepared.findings()[0].rule.code(), "vale/Test.Very");
    assert_eq!(prepared.findings()[0].span.start, 8);
    assert_eq!(prepared.findings()[0].span.end, 12);
    assert_eq!(prepared.findings()[0].severity, Severity::Warning);
}

#[test]
fn built_in_and_vale_findings_have_cli_lsp_parity_without_ir_drift() {
    let fixture = success_fixture();
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let prepared = analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect("analyze fixture");
    let bound = prepared.bind(SOURCE).expect("bind source identity");
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::<SeedOpenClassLexicon>::default();
    let classified = classification(SOURCE);
    let findings = bound.analyze(classified.source(), classified.tree(), classified.tokens());
    let diagnostics =
        compute_diagnostics(SOURCE, &parser, &annotator, &bound).expect("Vale diagnostics");

    assert_eq!(
        lint_report("fixture.txt", SOURCE, &findings),
        "fixture.txt:1:3: info [vale/Style.Unicode]: Review this word.\n\
         fixture.txt:2:9: warning [vale/Style.Clarity]: Consider replacing 'very'.\n"
    );
    assert_eq!(diagnostics.len(), findings.len());
    for (finding, diagnostic) in findings.iter().zip(&diagnostics) {
        assert_eq!(
            diagnostic.code,
            Some(NumberOrString::String(finding.rule.code().to_string()))
        );
        assert_eq!(diagnostic.message, finding.message);
        assert_eq!(
            diagnostic.severity,
            Some(match finding.severity {
                Severity::Info => DiagnosticSeverity::INFORMATION,
                Severity::Warning => DiagnosticSeverity::WARNING,
            })
        );
    }
    assert_eq!(diagnostics[0].range.start, Position::new(0, 3));
    assert_eq!(diagnostics[0].range.end, Position::new(0, 8));
    assert_eq!(diagnostics[1].range.start, Position::new(1, 8));
    assert_eq!(diagnostics[1].range.end, Position::new(1, 12));

    let built_in = ProseLinter::new();
    let built_in_analysis =
        analyze_document(SOURCE, &parser, &annotator, &built_in).expect("built-in analysis");
    let vale_analysis =
        analyze_document(SOURCE, &parser, &annotator, &bound).expect("Vale analysis");
    assert_eq!(
        built_in_analysis.semantic_tokens(),
        vale_analysis.semantic_tokens()
    );

    let ir_before = build_document("fixture.txt", SOURCE, &parser, &annotator)
        .expect("IR before external analysis");
    let _ = bound.analyze(classified.source(), classified.tree(), classified.tokens());
    let ir_after = build_document("fixture.txt", SOURCE, &parser, &annotator)
        .expect("IR after external analysis");
    assert_eq!(
        canonical_json(&ir_before.document).unwrap(),
        canonical_json(&ir_after.document).unwrap()
    );
}

#[test]
fn invalid_coordinate_matrix_is_rejected_without_panicking() {
    for alert in [
        r#"{"Span":[0,1],"Line":1}"#,
        r#"{"Span":[2,1],"Line":1}"#,
        r#"{"Span":[1,99],"Line":1}"#,
        r#"{"Span":[1,1],"Line":0}"#,
        r#"{"Span":[1],"Line":1}"#,
    ] {
        let alert = alert
            .trim_start_matches('{')
            .trim_end_matches('}')
            .to_string();
        let body = format!(
            "printf '%s\\n' '{{\"stdin.txt\":[{{\"Action\":{{\"Name\":\"\",\"Params\":null}},{alert},\"Check\":\"Style.Bad\",\"Description\":\"\",\"Link\":\"\",\"Message\":\"bad\",\"Severity\":\"warning\",\"Match\":\"bad\"}}]}}'"
        );
        let fixture = FakeVale::new("3.14.2", &body);
        let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
        assert_eq!(
            analyzer
                .analyze(SOURCE, &CancellationToken::new())
                .expect_err("invalid coordinate")
                .kind(),
            ValeErrorKind::InvalidAlert
        );
    }
}

#[test]
fn pre_cancelled_analysis_does_not_start_a_process() {
    let fixture = success_fixture();
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover Vale");
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    assert_eq!(
        analyzer
            .analyze(SOURCE, &cancellation)
            .expect_err("pre-cancelled analysis")
            .kind(),
        ValeErrorKind::Cancelled
    );
    assert!(!fixture.arguments.exists());
    assert!(!fixture.captured_input.exists());
}

#[test]
fn fixture_paths_are_absolute_and_shell_safe() {
    let fixture = success_fixture();
    for path in [
        &fixture.root,
        &fixture.executable,
        &fixture.configuration,
        &fixture.arguments,
        &fixture.captured_input,
        &fixture.marker,
    ] {
        assert!(Path::new(path).is_absolute());
        assert!(!path.to_string_lossy().contains('\''));
    }
}

#[test]
fn fixture_paths_with_shell_metacharacters_are_supported() {
    let _environment_lock = ENVIRONMENT_LOCK.lock().expect("environment lock");
    let quoted_parent = loop {
        let id = FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
        let candidate = std::env::temp_dir().join(format!(
            "colorful-vale-quoted-'path-{}-{id}",
            std::process::id()
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => break candidate,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => panic!(
                "create quoted temporary parent {}: {error}",
                candidate.display()
            ),
        }
    };
    let _quoted_parent = DirectoryGuard(quoted_parent.clone());
    let previous = std::env::var_os("TMPDIR");
    std::env::set_var("TMPDIR", &quoted_parent);
    let _environment = EnvironmentGuard {
        saved: vec![("TMPDIR", previous)],
    };

    let fixture = success_fixture();
    assert!(fixture.root.starts_with(&quoted_parent));
    let analyzer = ValeAnalyzer::discover(fixture.config()).expect("discover quoted-path Vale");
    analyzer
        .analyze(SOURCE, &CancellationToken::new())
        .expect("analyze quoted-path fixture");
    assert_eq!(
        fs::read_to_string(&fixture.captured_input).expect("captured quoted-path input"),
        SOURCE
    );
}
