//! Black-box public-contract tests for the real `colorful` executable.

use std::ffi::OsStr;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

const FILE_FIXTURE: &str = include_str!("../fixtures/editor-smoke-prose.txt");

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name)
}

fn editor_fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../editors/fixtures")
        .join(name)
}

fn run<I, S>(args: I, stdin: &[u8], no_color: bool) -> Output
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(env!("CARGO_BIN_EXE_colorful"));
    command
        .args(args)
        .env_remove("NO_COLOR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if no_color {
        command.env("NO_COLOR", "1");
    }

    let mut child = command.spawn().expect("spawn the real colorful binary");
    child
        .stdin
        .take()
        .expect("piped colorful stdin")
        .write_all(stdin)
        .expect("write colorful stdin");
    child.wait_with_output().expect("wait for colorful")
}

fn stdout(output: &Output) -> &str {
    std::str::from_utf8(&output.stdout).expect("colorful stdout must be UTF-8")
}

fn stderr(output: &Output) -> &str {
    std::str::from_utf8(&output.stderr).expect("colorful stderr must be UTF-8")
}

#[test]
fn stdin_file_no_color_and_canonical_ir_are_process_contracts() {
    const SOURCE: &str = "The cat connects quickly.\n";

    let no_color_flag = run(["--no-color"], SOURCE.as_bytes(), false);
    assert_eq!(no_color_flag.status.code(), Some(0));
    assert_eq!(stdout(&no_color_flag), SOURCE);
    assert!(stderr(&no_color_flag).is_empty());

    let no_color_env = run(std::iter::empty::<&str>(), SOURCE.as_bytes(), true);
    assert_eq!(no_color_env.status.code(), Some(0));
    assert_eq!(stdout(&no_color_env), SOURCE);
    assert!(stderr(&no_color_env).is_empty());

    let fixture = fixture_path("editor-smoke-prose.txt");
    let file = run([OsStr::new("--no-color"), fixture.as_os_str()], b"", false);
    assert_eq!(file.status.code(), Some(0));
    assert_eq!(stdout(&file), FILE_FIXTURE);
    assert!(stderr(&file).is_empty());

    let ir = run(["ir"], SOURCE.as_bytes(), false);
    assert_eq!(ir.status.code(), Some(0));
    assert!(stderr(&ir).is_empty());
    let encoded = stdout(&ir);
    let document: colorful_ir::syntax_v1::DocumentAnalysis =
        serde_json::from_str(encoded).expect("decode colorful ir stdout");
    let expected = format!(
        "{}\n",
        colorful_ir::canonical_json(&document).expect("re-encode canonical IR")
    );
    assert_eq!(encoded, expected);
    assert_eq!(document.source.unit_id, "stdin");
}

#[test]
fn invalid_input_operands_and_lint_findings_have_stable_process_failures() {
    let invalid_fixture = fixture_path("invalid-utf8.bin");
    let invalid_file = run([OsStr::new("ir"), invalid_fixture.as_os_str()], b"", false);
    assert_eq!(invalid_file.status.code(), Some(1));
    assert!(stdout(&invalid_file).is_empty());
    assert!(
        stderr(&invalid_file).contains("stream did not contain valid UTF-8"),
        "unexpected invalid-UTF-8 stderr: {:?}",
        stderr(&invalid_file)
    );

    let fixture = fixture_path("editor-smoke-prose.txt");
    let multiple = run([fixture.as_os_str(), fixture.as_os_str()], b"", false);
    assert_eq!(multiple.status.code(), Some(1));
    assert!(stdout(&multiple).is_empty());
    assert!(
        stderr(&multiple).contains("expected at most one FILE argument"),
        "unexpected multiple-operand stderr: {:?}",
        stderr(&multiple)
    );

    let clean = run(["lint"], b"Clear prose.\n", false);
    assert_eq!(clean.status.code(), Some(0));
    assert!(stdout(&clean).is_empty());
    assert!(stderr(&clean).is_empty());

    let finding = run(["lint"], b"This is really clear.\n", false);
    assert_eq!(finding.status.code(), Some(1));
    assert!(stdout(&finding).contains("[weak-word]"));
    assert!(stderr(&finding).is_empty());
}

#[test]
fn markdown_file_colorization_excludes_non_prose_regions() {
    let fixture = editor_fixture_path("editor-smoke.md");
    let output = run([fixture.as_os_str()], b"", false);

    assert_eq!(output.status.code(), Some(0));
    assert!(stderr(&output).is_empty());
    let rendered = stdout(&output);
    let lines: Vec<_> = rendered.lines().collect();
    assert!(lines[0].contains("\u{1b}["), "{rendered:?}");
    assert_eq!(&lines[2..5], ["```text", "The cat is really clear.", "```"]);
}
