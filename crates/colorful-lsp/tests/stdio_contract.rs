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

#[test]
fn real_server_completes_the_public_stdio_lifecycle() {
    const URI: &str = "file:///tmp/colorful-lsp-contract.txt";

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
    let initialize = server.receive("initialize response", |message| message["id"] == 1);
    assert_eq!(initialize["result"]["serverInfo"]["name"], "colorful-lsp");
    assert_eq!(
        initialize["result"]["capabilities"]["textDocumentSync"],
        json!(2)
    );
    let legend = initialize["result"]["capabilities"]["semanticTokensProvider"]["legend"]
        ["tokenTypes"]
        .as_array()
        .expect("semantic-token legend array");
    assert!(legend.iter().any(|token_type| token_type == "noun"));

    server.send(json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    }));
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": URI,
                "languageId": "plaintext",
                "version": 1,
                "text": "The cat is really clear."
            }
        }
    }));
    let opened = server.receive("version 1 diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics" && message["params"]["version"] == 1
    });
    assert_eq!(opened["params"]["uri"], URI);
    assert!(opened["params"]["diagnostics"]
        .as_array()
        .is_some_and(|diagnostics| !diagnostics.is_empty()));

    server.send(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "textDocument/semanticTokens/full",
        "params": {"textDocument": {"uri": URI}}
    }));
    let first_tokens = server.receive("first semantic-token response", |message| {
        message["id"] == 2
    });
    let first_data = first_tokens["result"]["data"]
        .as_array()
        .expect("semantic-token data");
    assert_eq!(first_tokens["result"]["resultId"], "1");
    assert!(!first_data.is_empty());
    assert_eq!(first_data.len() % 5, 0);

    server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didChange",
        "params": {
            "textDocument": {"uri": URI, "version": 2},
            "contentChanges": [{
                "range": {
                    "start": {"line": 0, "character": 11},
                    "end": {"line": 0, "character": 17}
                },
                "text": "plain"
            }]
        }
    }));
    let changed = server.receive("version 2 diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics" && message["params"]["version"] == 2
    });
    assert_eq!(changed["params"]["uri"], URI);
    assert_eq!(changed["params"]["diagnostics"], json!([]));

    server.send(json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "textDocument/semanticTokens/full",
        "params": {"textDocument": {"uri": URI}}
    }));
    let changed_tokens = server.receive("changed semantic-token response", |message| {
        message["id"] == 3
    });
    assert_eq!(changed_tokens["result"]["resultId"], "2");
    assert!(changed_tokens["result"]["data"]
        .as_array()
        .is_some_and(|data| !data.is_empty()));

    server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didClose",
        "params": {"textDocument": {"uri": URI}}
    }));
    let closed = server.receive("close diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics"
            && message["params"]["uri"] == URI
            && message["params"]["diagnostics"] == json!([])
            && message["params"].get("version").is_none()
    });
    assert_eq!(closed["params"]["diagnostics"], json!([]));

    server.send(json!({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "shutdown",
        "params": null
    }));
    let shutdown = server.receive("shutdown response", |message| message["id"] == 4);
    assert_eq!(shutdown["result"], Value::Null);
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "exit",
        "params": null
    }));

    assert_eq!(server.finish().code(), Some(0));
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
        "id": 3,
        "method": "shutdown",
        "params": null
    }));
    server.receive("shutdown response", |message| message["id"] == 3);
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "exit",
        "params": null
    }));
    assert_eq!(server.finish().code(), Some(0));
}
