//! Black-box JSON-RPC lifecycle proof for the real `colorful-lsp` executable.

use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

fn read_message(reader: &mut impl BufRead) -> io::Result<Option<Value>> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        if line == "\r\n" {
            break;
        }
        let (name, value) = line
            .trim_end()
            .split_once(':')
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "malformed LSP header"))?;
        if name.eq_ignore_ascii_case("Content-Length") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
            );
        }
    }

    let length = content_length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length"))?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

struct LspProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    messages: Receiver<Result<Value, String>>,
    pending: VecDeque<Value>,
    reader: Option<JoinHandle<()>>,
}

impl LspProcess {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_colorful-lsp"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn the real colorful-lsp binary");
        let stdin = child.stdin.take().expect("piped colorful-lsp stdin");
        let stdout = child.stdout.take().expect("piped colorful-lsp stdout");
        let (sender, messages) = mpsc::channel();
        let reader = thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                match read_message(&mut stdout) {
                    Ok(Some(message)) => {
                        if sender.send(Ok(message)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });
        Self {
            child,
            stdin: Some(stdin),
            messages,
            pending: VecDeque::new(),
            reader: Some(reader),
        }
    }

    fn send(&mut self, message: Value) {
        let body = serde_json::to_vec(&message).expect("encode JSON-RPC message");
        let stdin = self.stdin.as_mut().expect("open colorful-lsp stdin");
        write!(stdin, "Content-Length: {}\r\n\r\n", body.len()).expect("write LSP header");
        stdin.write_all(&body).expect("write LSP body");
        stdin.flush().expect("flush LSP message");
    }

    fn receive(&mut self, description: &str, predicate: impl Fn(&Value) -> bool) -> Value {
        if let Some(index) = self.pending.iter().position(&predicate) {
            return self.pending.remove(index).expect("pending message exists");
        }

        let deadline = Instant::now() + RESPONSE_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let message = self
                .messages
                .recv_timeout(remaining)
                .unwrap_or_else(|error| panic!("timed out waiting for {description}: {error}"))
                .unwrap_or_else(|error| panic!("failed reading {description}: {error}"));
            if predicate(&message) {
                return message;
            }
            self.pending.push_back(message);
        }
    }

    fn finish(mut self) -> ExitStatus {
        self.stdin.take();
        let deadline = Instant::now() + RESPONSE_TIMEOUT;
        loop {
            if let Some(status) = self.child.try_wait().expect("poll colorful-lsp") {
                if let Some(reader) = self.reader.take() {
                    reader.join().expect("join colorful-lsp stdout reader");
                }
                return status;
            }
            if Instant::now() >= deadline {
                self.child.kill().expect("kill hung colorful-lsp");
                let _ = self.child.wait();
                panic!("colorful-lsp did not exit after the exit notification");
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for LspProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn substitute_placeholders(value: &Value, session: &Value) -> Value {
    match value {
        Value::String(value) if value == "$URI" => session["uri"].clone(),
        Value::String(value) if value == "$LANGUAGE_ID" => session["languageId"].clone(),
        Value::String(value) if value == "$PACKAGE_VERSION" => {
            Value::String(env!("CARGO_PKG_VERSION").to_string())
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .map(|value| substitute_placeholders(value, session))
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), substitute_placeholders(value, session)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn contains_partial(actual: &Value, expected: &Value) -> bool {
    match expected {
        Value::Object(expected) => expected.iter().all(|(key, value)| {
            actual
                .get(key)
                .is_some_and(|actual| contains_partial(actual, value))
        }),
        Value::Array(expected) => actual.as_array().is_some_and(|actual| actual == expected),
        _ => actual == expected,
    }
}

fn transcript_exit_code(fixture: &Value) -> i32 {
    let value = fixture
        .get("exitCode")
        .and_then(Value::as_i64)
        .expect("transcript exitCode must be present and integral");
    i32::try_from(value).expect("transcript exitCode must fit the platform exit-code range")
}

fn replay_transcript_session(fixture: &Value, session: &Value) {
    let mut server = LspProcess::spawn();
    let steps = fixture["steps"].as_array().expect("transcript steps");

    for step in steps {
        if let Some(message) = step.get("send") {
            server.send(substitute_placeholders(message, session));
            continue;
        }

        let receive = step.get("receive").expect("send or receive step");
        let description = receive["description"]
            .as_str()
            .expect("receive description");
        let selector = substitute_placeholders(&receive["where"], session);
        let message = server.receive(description, |message| contains_partial(message, &selector));

        if let Some(equals) = receive.get("equals") {
            for (pointer, expected) in equals.as_object().expect("pointer equality map") {
                let expected = substitute_placeholders(expected, session);
                assert_eq!(
                    message.pointer(pointer),
                    Some(&expected),
                    "{description}: unexpected value at {pointer}: {message}"
                );
            }
        }
        if let Some(paths) = receive.get("arraysContain") {
            for (pointer, expected) in paths.as_object().expect("array containment map") {
                let expected = substitute_placeholders(expected, session);
                assert!(
                    message
                        .pointer(pointer)
                        .and_then(Value::as_array)
                        .is_some_and(|values| values.contains(&expected)),
                    "{description}: {pointer} does not contain {expected}: {message}"
                );
            }
        }
        if let Some(paths) = receive.get("nonEmptyArrays") {
            for pointer in paths.as_array().expect("non-empty array paths") {
                let pointer = pointer.as_str().expect("JSON pointer");
                assert!(
                    message
                        .pointer(pointer)
                        .and_then(Value::as_array)
                        .is_some_and(|values| !values.is_empty()),
                    "{description}: expected non-empty array at {pointer}: {message}"
                );
            }
        }
        if let Some(paths) = receive.get("arrayLengthsMultipleOf") {
            for (pointer, factor) in paths.as_object().expect("array multiple map") {
                let factor = factor.as_u64().expect("positive array factor") as usize;
                let length = message
                    .pointer(pointer)
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or_default();
                assert!(
                    factor > 0 && length > 0 && length.is_multiple_of(factor),
                    "{description}: array length {length} at {pointer} is not a positive multiple \
                     of {factor}: {message}"
                );
            }
        }
        if let Some(paths) = receive.get("absent") {
            for pointer in paths.as_array().expect("absent pointer paths") {
                let pointer = pointer.as_str().expect("JSON pointer");
                assert!(
                    message.pointer(pointer).is_none(),
                    "{description}: expected no value at {pointer}: {message}"
                );
            }
        }
    }

    let expected = transcript_exit_code(fixture);
    let actual = server
        .finish()
        .code()
        .expect("colorful-lsp terminated by signal instead of returning an exit code");
    assert_eq!(actual, expected, "unexpected colorful-lsp exit code");
}

#[test]
fn real_server_completes_the_public_stdio_lifecycle() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/editor_lifecycle_transcript.json"))
            .expect("valid editor transcript fixture");
    assert_eq!(
        fixture["schemaVersion"], "colorful.lsp.transcript/v1",
        "unexpected transcript schema"
    );
    for session in fixture["sessions"].as_array().expect("transcript sessions") {
        replay_transcript_session(&fixture, session);
    }
}

#[test]
fn transcript_exit_code_requires_an_integral_value() {
    for malformed in [
        json!({}),
        json!({"exitCode": null}),
        json!({"exitCode": 0.5}),
    ] {
        assert!(
            std::panic::catch_unwind(|| transcript_exit_code(&malformed)).is_err(),
            "accepted malformed transcript exitCode: {malformed}"
        );
    }
    assert_eq!(transcript_exit_code(&json!({"exitCode": 0})), 0);
}

#[test]
fn server_metrics_use_a_stable_versioned_contract() {
    let mut server = LspProcess::spawn();
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "processId": null,
            "rootUri": null,
            "capabilities": {}
        }
    }));
    server.receive("initialize response", |message| message["id"] == 1);

    server.send(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "colorful/metrics",
        "params": null
    }));
    let metrics = server.receive("server metrics response", |message| message["id"] == 2);
    assert_eq!(
        metrics["result"],
        json!({
            "schemaVersion": "colorful.lsp.metrics/v1",
            "analysisLimitBytes": 5 * 1024 * 1024,
            "activeDocuments": 0,
            "computationsStarted": 0,
            "acceptedResults": 0,
            "cancelledBeforeCompute": 0,
            "staleResults": 0,
            "oversizedResults": 0,
            "analysisFailures": 0,
            "maxQueueDelayMicros": 0
        }),
        "unexpected metrics response: {metrics}"
    );

    server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": "file:///metrics.txt",
                "languageId": "plaintext",
                "version": 1,
                "text": "The clear sentence works."
            }
        }
    }));
    server.receive("version 1 diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics" && message["params"]["version"] == 1
    });
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "colorful/metrics",
        "params": null
    }));
    let active_metrics = server.receive("active server metrics response", |message| {
        message["id"] == 3
    });
    assert_eq!(active_metrics["result"]["activeDocuments"], 1);
    assert!(active_metrics["result"]["computationsStarted"]
        .as_u64()
        .is_some_and(|count| count >= 1));
    assert!(active_metrics["result"]["acceptedResults"]
        .as_u64()
        .is_some_and(|count| count >= 1));

    server.send(json!({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "shutdown",
        "params": null
    }));
    server.receive("shutdown response", |message| message["id"] == 4);
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "exit",
        "params": null
    }));
    assert_eq!(server.finish().code(), Some(0));
}
