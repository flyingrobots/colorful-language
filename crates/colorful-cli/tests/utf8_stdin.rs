//! Process-level proof that invalid UTF-8 arriving over **stdin** is
//! rejected identically to invalid UTF-8 arriving from a file.
//!
//! `crates/colorful-cli/src/lib.rs`'s `invalid_utf8_file_is_rejected_across_
//! every_command` unit test only ever supplies a file path, so it never
//! exercises the separate `io::stdin().read_to_string(...)` branch each
//! command falls into when no `FILE` argument is given. This spawns the
//! real compiled binary and pipes the malformed fixture bytes through its
//! stdin for every single-document command.

use std::io::Write;
use std::process::{Command, Stdio};

const INVALID_UTF8: &[u8] = include_bytes!("../fixtures/invalid-utf8.bin");

fn run_with_stdin(args: &[&str]) -> (bool, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_colorful"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn colorful");

    child
        .stdin
        .take()
        .expect("piped stdin")
        .write_all(INVALID_UTF8)
        .expect("write invalid UTF-8 to stdin");

    let output = child.wait_with_output().expect("wait for colorful");
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    (output.status.success(), stderr)
}

fn assert_rejected(args: &[&str]) {
    let (succeeded, stderr) = run_with_stdin(args);
    assert!(
        !succeeded,
        "colorful {args:?} accepted invalid UTF-8 on stdin instead of rejecting it"
    );
    assert!(
        stderr.contains("stream did not contain valid UTF-8"),
        "colorful {args:?}: expected the UTF-8 rejection message on stderr, got: {stderr:?}"
    );
}

#[test]
fn invalid_utf8_on_stdin_is_rejected_across_every_command() {
    assert_rejected(&[]); // default (color) subcommand
    assert_rejected(&["ir"]);
    assert_rejected(&["diagnose"]);
    assert_rejected(&["lint"]);
}
