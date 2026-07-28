//! Release-mode, process-level benchmark for the supported LSP envelope.
//!
//! Build the real server first, then run this example in release mode:
//!
//! ```text
//! cargo build --locked --release -p colorful-lsp --bin colorful-lsp
//! cargo run --locked --release -p colorful-lsp --example lsp_envelope
//! ```
//!
//! The JSON report is written to stdout. Cargo progress and scenario progress
//! use stderr, so stdout can be redirected to a candidate report for review.

#![forbid(unsafe_code)]

use std::collections::VecDeque;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(60);
const CORPUS_ID: &str = "colorful-lsp-repeated-prose/v1";
const CORPUS_LINE: &str = "The maintainable documentation explains deterministic interfaces and careful validation for readers working across editors and command-line tools.\n";
const SUPPORTED_LIMIT_BYTES: u64 = 5 * 1024 * 1024;
const SCENARIOS: [(&str, usize); 4] = [
    ("100 KiB", 100 * 1024),
    ("1 MiB", 1024 * 1024),
    ("5 MiB", 5 * 1024 * 1024),
    ("10 MiB", 10 * 1024 * 1024),
];
const OPEN_OR_CHANGE_DIAGNOSTICS_MS: f64 = 5_000.0;
const CACHED_SEMANTIC_TOKENS_MS: f64 = 2_000.0;
const OVERLOAD_COMPLETION_MS: f64 = 8_000.0;
const MAX_QUEUE_DELAY_MS: f64 = 250.0;
const SUPPORTED_PEAK_RSS_BYTES: u64 = 1_536 * 1024 * 1024;
const REFUSAL_DIAGNOSTICS_MS: f64 = 1_000.0;
const REFUSAL_PEAK_RSS_BYTES: u64 = 512 * 1024 * 1024;
const CONCURRENT_SEMANTIC_REQUESTS: usize = 4;
const RAPID_EDIT_COUNT: i64 = 4;

#[derive(Debug)]
struct TimedMessage {
    value: Value,
    received_at: Instant,
}

struct LspProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    messages: Receiver<Result<TimedMessage, String>>,
    pending: VecDeque<TimedMessage>,
    diagnostic_versions: Vec<i64>,
    stdout_reader: Option<JoinHandle<()>>,
    stderr_reader: Option<JoinHandle<String>>,
    time_flavor: TimeFlavor,
}

#[derive(Clone, Copy)]
enum TimeFlavor {
    Darwin,
    Gnu,
}

impl LspProcess {
    fn spawn(server: &Path) -> Self {
        let (time_flavor, time_argument) = match std::env::consts::OS {
            "macos" => (TimeFlavor::Darwin, "-l"),
            "linux" => (TimeFlavor::Gnu, "-v"),
            other => panic!("peak-RSS measurement is unsupported on {other}"),
        };
        let mut child = Command::new("/usr/bin/time")
            .arg(time_argument)
            .arg(server)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|error| {
                panic!("spawn {} through /usr/bin/time: {error}", server.display())
            });
        let stdin = child.stdin.take().expect("piped colorful-lsp stdin");
        let stdout = child.stdout.take().expect("piped colorful-lsp stdout");
        let stderr = child.stderr.take().expect("piped colorful-lsp stderr");
        let (sender, messages) = mpsc::channel();
        let stdout_reader = thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                match read_message(&mut stdout) {
                    Ok(Some(value)) => {
                        let message = TimedMessage {
                            value,
                            received_at: Instant::now(),
                        };
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
        let stderr_reader = thread::spawn(move || {
            let mut source = String::new();
            BufReader::new(stderr)
                .read_to_string(&mut source)
                .expect("read /usr/bin/time stderr");
            source
        });
        Self {
            child,
            stdin: Some(stdin),
            messages,
            pending: VecDeque::new(),
            diagnostic_versions: Vec::new(),
            stdout_reader: Some(stdout_reader),
            stderr_reader: Some(stderr_reader),
            time_flavor,
        }
    }

    fn send(&mut self, message: Value) -> Duration {
        let started = Instant::now();
        let body = serde_json::to_vec(&message).expect("encode JSON-RPC message");
        let stdin = self.stdin.as_mut().expect("open colorful-lsp stdin");
        write!(stdin, "Content-Length: {}\r\n\r\n", body.len()).expect("write LSP header");
        stdin.write_all(&body).expect("write LSP body");
        stdin.flush().expect("flush LSP message");
        started.elapsed()
    }

    fn receive(&mut self, description: &str, predicate: impl Fn(&Value) -> bool) -> TimedMessage {
        if let Some(index) = self
            .pending
            .iter()
            .position(|message| predicate(&message.value))
        {
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
            self.observe(&message.value);
            if predicate(&message.value) {
                return message;
            }
            self.pending.push_back(message);
        }
    }

    fn drain_available(&mut self) {
        loop {
            match self.messages.try_recv() {
                Ok(Ok(message)) => {
                    self.observe(&message.value);
                    self.pending.push_back(message);
                }
                Ok(Err(error)) => panic!("failed reading colorful-lsp output: {error}"),
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
            }
        }
    }

    fn observe(&mut self, message: &Value) {
        if message["method"] == "textDocument/publishDiagnostics" {
            if let Some(version) = message["params"]["version"].as_i64() {
                self.diagnostic_versions.push(version);
            }
        }
    }

    fn shutdown(mut self) -> ProcessEvidence {
        self.send(json!({
            "jsonrpc": "2.0",
            "id": 9_999,
            "method": "shutdown",
            "params": null
        }));
        let shutdown = self.receive("shutdown response", |message| message["id"] == 9_999);
        assert_eq!(shutdown.value["result"], Value::Null);
        self.send(json!({
            "jsonrpc": "2.0",
            "method": "exit",
            "params": null
        }));
        self.stdin.take();

        let status = wait_for_exit(&mut self.child);
        if let Some(reader) = self.stdout_reader.take() {
            reader.join().expect("join colorful-lsp stdout reader");
        }
        let stderr = self
            .stderr_reader
            .take()
            .expect("time stderr reader")
            .join()
            .expect("join /usr/bin/time stderr reader");
        let peak_rss_bytes = parse_peak_rss(&stderr, self.time_flavor);
        ProcessEvidence {
            status,
            peak_rss_bytes,
            diagnostic_versions: self.diagnostic_versions.clone(),
        }
    }
}

impl Drop for LspProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if let Some(reader) = self.stdout_reader.take() {
            let _ = reader.join();
        }
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
    }
}

struct ProcessEvidence {
    status: ExitStatus,
    peak_rss_bytes: u64,
    diagnostic_versions: Vec<i64>,
}

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

fn wait_for_exit(child: &mut Child) -> ExitStatus {
    let deadline = Instant::now() + RESPONSE_TIMEOUT;
    loop {
        if let Some(status) = child.try_wait().expect("poll /usr/bin/time") {
            return status;
        }
        if Instant::now() >= deadline {
            child.kill().expect("kill hung benchmark server");
            let _ = child.wait();
            panic!("colorful-lsp did not exit after the exit notification");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn parse_peak_rss(stderr: &str, flavor: TimeFlavor) -> u64 {
    match flavor {
        TimeFlavor::Darwin => stderr
            .lines()
            .find(|line| line.contains("maximum resident set size"))
            .and_then(|line| line.split_whitespace().next())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or_else(|| panic!("parse Darwin peak RSS from /usr/bin/time:\n{stderr}")),
        TimeFlavor::Gnu => stderr
            .lines()
            .find(|line| line.contains("Maximum resident set size"))
            .and_then(|line| line.rsplit_once(':'))
            .map(|(_, value)| value.trim())
            .and_then(|value| value.parse::<u64>().ok())
            .and_then(|kibibytes| kibibytes.checked_mul(1024))
            .unwrap_or_else(|| panic!("parse GNU peak RSS from /usr/bin/time:\n{stderr}")),
    }
}

fn benchmark_server_path() -> PathBuf {
    if let Some(argument) = std::env::args_os().nth(1) {
        return PathBuf::from(argument);
    }
    let executable = std::env::current_exe().expect("current benchmark executable");
    executable
        .parent()
        .and_then(Path::parent)
        .expect("target profile directory")
        .join(format!("colorful-lsp{}", std::env::consts::EXE_SUFFIX))
}

fn corpus(byte_count: usize) -> String {
    let repetitions = byte_count.div_ceil(CORPUS_LINE.len());
    let mut text = CORPUS_LINE.repeat(repetitions);
    text.truncate(byte_count);
    assert_eq!(text.len(), byte_count);
    text
}

fn sha256(source: &[u8]) -> String {
    let digest = Sha256::digest(source);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn milliseconds(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1_000_000.0).round() / 1_000.0
}

fn response_duration(started: Instant, message: &TimedMessage) -> Duration {
    message.received_at.saturating_duration_since(started)
}

fn semantic_token_count(message: &Value) -> u64 {
    let data = message["result"]["data"]
        .as_array()
        .expect("semantic-token data");
    assert_eq!(data.len() % 5, 0);
    u64::try_from(data.len() / 5).expect("semantic-token count fits u64")
}

fn diagnostic_code(message: &Value) -> Option<&str> {
    message["params"]["diagnostics"]
        .as_array()
        .and_then(|diagnostics| diagnostics.first())
        .and_then(|diagnostic| diagnostic["code"].as_str())
}

fn initialize(server: &mut LspProcess) {
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
    assert_eq!(
        initialize.value["result"]["serverInfo"]["name"],
        "colorful-lsp"
    );
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    }));
}

fn replace_first_character(version: i64, replacement: char) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didChange",
        "params": {
            "textDocument": {
                "uri": "file:///tmp/colorful-lsp-envelope.txt",
                "version": version
            },
            "contentChanges": [{
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": {"line": 0, "character": 1}
                },
                "text": replacement.to_string()
            }]
        }
    })
}

fn benchmark_scenario(server_path: &Path, label: &str, byte_count: usize) -> Value {
    eprintln!("benchmarking {label} ({byte_count} bytes)");
    let text = corpus(byte_count);
    let corpus_sha256 = sha256(text.as_bytes());
    let supported =
        u64::try_from(byte_count).expect("document size fits u64") <= SUPPORTED_LIMIT_BYTES;
    let mut server = LspProcess::spawn(server_path);
    initialize(&mut server);

    let open_started = Instant::now();
    let open_dispatch = server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": "file:///tmp/colorful-lsp-envelope.txt",
                "languageId": "plaintext",
                "version": 1,
                "text": text
            }
        }
    }));
    let open_diagnostics = server.receive("version 1 diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics" && message["params"]["version"] == 1
    });
    let open_diagnostics_ms = milliseconds(response_duration(open_started, &open_diagnostics));
    let first_diagnostic_code = diagnostic_code(&open_diagnostics.value).map(str::to_owned);
    let outcome_category =
        if first_diagnostic_code.as_deref() == Some("colorful/document-too-large") {
            "document-too-large"
        } else {
            "analyzed"
        };

    let open_tokens_started = Instant::now();
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "textDocument/semanticTokens/full",
        "params": {
            "textDocument": {
                "uri": "file:///tmp/colorful-lsp-envelope.txt"
            }
        }
    }));
    let open_tokens = server.receive("open semantic tokens", |message| message["id"] == 2);
    let open_tokens_ms = milliseconds(response_duration(open_tokens_started, &open_tokens));
    let open_token_count = semantic_token_count(&open_tokens.value);

    let incremental_started = Instant::now();
    let incremental_dispatch = server.send(replace_first_character(2, 'A'));
    let incremental_diagnostics = server.receive("version 2 diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics" && message["params"]["version"] == 2
    });
    let incremental_diagnostics_ms = milliseconds(response_duration(
        incremental_started,
        &incremental_diagnostics,
    ));
    let incremental_diagnostic_code =
        diagnostic_code(&incremental_diagnostics.value).map(str::to_owned);

    let incremental_tokens_started = Instant::now();
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "textDocument/semanticTokens/full",
        "params": {
            "textDocument": {
                "uri": "file:///tmp/colorful-lsp-envelope.txt"
            }
        }
    }));
    let incremental_tokens =
        server.receive("incremental semantic tokens", |message| message["id"] == 3);
    let incremental_tokens_ms = milliseconds(response_duration(
        incremental_tokens_started,
        &incremental_tokens,
    ));
    let incremental_token_count = semantic_token_count(&incremental_tokens.value);

    let overload_started = Instant::now();
    for (offset, replacement) in ['B', 'C', 'D', 'E'].into_iter().enumerate() {
        let version = 3 + i64::try_from(offset).expect("rapid edit offset fits i64");
        server.send(replace_first_character(version, replacement));
    }
    let request_ids = [10_i64, 11, 12, 13];
    for id in request_ids {
        server.send(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "textDocument/semanticTokens/full",
            "params": {
                "textDocument": {
                    "uri": "file:///tmp/colorful-lsp-envelope.txt"
                }
            }
        }));
    }
    let latest_diagnostics = server.receive("latest overload diagnostics", |message| {
        message["method"] == "textDocument/publishDiagnostics" && message["params"]["version"] == 6
    });
    let time_to_latest_diagnostics_ms =
        milliseconds(response_duration(overload_started, &latest_diagnostics));
    let overload_diagnostic_code = diagnostic_code(&latest_diagnostics.value).map(str::to_owned);

    let mut semantic_result_ids = Vec::new();
    let mut semantic_token_counts = Vec::new();
    let mut semantic_response_ms = Vec::new();
    for id in request_ids {
        let response = server.receive("overload semantic-token response", |message| {
            message["id"] == id
        });
        semantic_response_ms.push(milliseconds(response_duration(overload_started, &response)));
        let token_count = semantic_token_count(&response.value);
        semantic_token_counts.push(token_count);
        semantic_result_ids.push(
            response.value["result"]["resultId"]
                .as_str()
                .expect("semantic result ID")
                .to_string(),
        );
        if !supported {
            assert_eq!(token_count, 0);
        }
    }
    let slowest_semantic_response_ms = semantic_response_ms.iter().copied().fold(0.0_f64, f64::max);

    server.send(json!({
        "jsonrpc": "2.0",
        "id": 20,
        "method": "colorful/metrics",
        "params": null
    }));
    let metrics_response = server.receive("server metrics", |message| message["id"] == 20);
    let metrics = metrics_response.value["result"].clone();
    assert_eq!(metrics["schemaVersion"], "colorful.lsp.metrics/v1");
    server.drain_available();
    let process = server.shutdown();
    assert_eq!(process.status.code(), Some(0));

    let stale_publication_count = process
        .diagnostic_versions
        .iter()
        .filter(|version| ![1_i64, 2, 6].contains(version))
        .count();
    let max_queue_delay_ms =
        metrics["maxQueueDelayMicros"].as_u64().unwrap_or(u64::MAX) as f64 / 1_000.0;
    let mut slo_failures = Vec::new();
    if stale_publication_count > 0 {
        slo_failures.push(format!(
            "{stale_publication_count} stale diagnostic publications"
        ));
    }
    if semantic_result_ids.iter().any(|result_id| result_id != "6") {
        slo_failures.push("semantic response did not describe version 6".to_string());
    }
    if supported {
        if outcome_category != "analyzed" {
            slo_failures.push(format!("unexpected outcome {outcome_category}"));
        }
        if first_diagnostic_code.is_some()
            || incremental_diagnostic_code.is_some()
            || overload_diagnostic_code.is_some()
        {
            slo_failures.push("supported document emitted a refusal diagnostic".to_string());
        }
        for (name, duration) in [
            ("open diagnostics", open_diagnostics_ms),
            ("incremental diagnostics", incremental_diagnostics_ms),
        ] {
            if duration > OPEN_OR_CHANGE_DIAGNOSTICS_MS {
                slo_failures.push(format!("{name} took {duration:.3} ms"));
            }
        }
        for (name, duration) in [
            ("open semantic tokens", open_tokens_ms),
            ("incremental semantic tokens", incremental_tokens_ms),
        ] {
            if duration > CACHED_SEMANTIC_TOKENS_MS {
                slo_failures.push(format!("{name} took {duration:.3} ms"));
            }
        }
        if time_to_latest_diagnostics_ms > OVERLOAD_COMPLETION_MS {
            slo_failures.push(format!(
                "overload diagnostics took {time_to_latest_diagnostics_ms:.3} ms"
            ));
        }
        if slowest_semantic_response_ms > OVERLOAD_COMPLETION_MS {
            slo_failures.push(format!(
                "overload semantic response took {slowest_semantic_response_ms:.3} ms"
            ));
        }
        if max_queue_delay_ms > MAX_QUEUE_DELAY_MS {
            slo_failures.push(format!("queue delay reached {max_queue_delay_ms:.3} ms"));
        }
        if process.peak_rss_bytes > SUPPORTED_PEAK_RSS_BYTES {
            slo_failures.push(format!("peak RSS reached {} bytes", process.peak_rss_bytes));
        }
    } else {
        if outcome_category != "document-too-large" {
            slo_failures.push(format!("unexpected outcome {outcome_category}"));
        }
        if first_diagnostic_code.as_deref() != Some("colorful/document-too-large")
            || incremental_diagnostic_code.as_deref() != Some("colorful/document-too-large")
            || overload_diagnostic_code.as_deref() != Some("colorful/document-too-large")
        {
            slo_failures.push("refusal diagnostic category changed between phases".to_string());
        }
        if open_token_count != 0
            || incremental_token_count != 0
            || semantic_token_counts.iter().any(|count| *count != 0)
        {
            slo_failures.push("refused document emitted semantic tokens".to_string());
        }
        for (name, duration) in [
            ("refusal open diagnostics", open_diagnostics_ms),
            ("refusal open semantic tokens", open_tokens_ms),
            (
                "refusal incremental diagnostics",
                incremental_diagnostics_ms,
            ),
            ("refusal incremental semantic tokens", incremental_tokens_ms),
            (
                "refusal overload diagnostics",
                time_to_latest_diagnostics_ms,
            ),
            (
                "refusal overload semantic response",
                slowest_semantic_response_ms,
            ),
        ] {
            if duration > REFUSAL_DIAGNOSTICS_MS {
                slo_failures.push(format!("{name} took {duration:.3} ms"));
            }
        }
        if process.peak_rss_bytes > REFUSAL_PEAK_RSS_BYTES {
            slo_failures.push(format!(
                "refusal peak RSS reached {} bytes",
                process.peak_rss_bytes
            ));
        }
    }

    json!({
        "label": label,
        "documentBytes": byte_count,
        "corpusBytes": byte_count,
        "corpusSha256": corpus_sha256,
        "outcomeCategory": outcome_category,
        "diagnosticCode": first_diagnostic_code,
        "open": {
            "dispatchMs": milliseconds(open_dispatch),
            "diagnosticsMs": open_diagnostics_ms,
            "semanticTokensMs": open_tokens_ms,
            "semanticTokenCount": open_token_count,
            "throughputBytesPerSecond": (byte_count as f64 / (open_diagnostics_ms / 1_000.0)).round()
        },
        "incremental": {
            "dispatchMs": milliseconds(incremental_dispatch),
            "diagnosticsMs": incremental_diagnostics_ms,
            "diagnosticCode": incremental_diagnostic_code,
            "semanticTokensMs": incremental_tokens_ms,
            "semanticTokenCount": incremental_token_count
        },
        "overload": {
            "rapidEditCount": RAPID_EDIT_COUNT,
            "concurrentSemanticRequests": CONCURRENT_SEMANTIC_REQUESTS,
            "timeToLatestDiagnosticsMs": time_to_latest_diagnostics_ms,
            "diagnosticCode": overload_diagnostic_code,
            "slowestSemanticResponseMs": slowest_semantic_response_ms,
            "semanticResponseMs": semantic_response_ms,
            "semanticResultIds": semantic_result_ids,
            "semanticTokenCounts": semantic_token_counts
        },
        "peakRssBytes": process.peak_rss_bytes,
        "processExitCode": process.status.code(),
        "metrics": metrics,
        "finalDocumentVersion": 6,
        "latestDiagnosticVersion": 6,
        "stalePublicationCount": stale_publication_count,
        "sloMet": slo_failures.is_empty(),
        "sloFailures": slo_failures
    })
}

fn command_output(program: &str, arguments: &[&str]) -> String {
    let output = Command::new(program)
        .args(arguments)
        .output()
        .unwrap_or_else(|error| panic!("run {program}: {error}"));
    assert!(
        output.status.success(),
        "{program} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("command output is UTF-8")
        .trim()
        .to_string()
}

fn memory_bytes() -> u64 {
    match std::env::consts::OS {
        "macos" => command_output("sysctl", &["-n", "hw.memsize"])
            .parse()
            .expect("parse Darwin memory size"),
        "linux" => fs::read_to_string("/proc/meminfo")
            .expect("read /proc/meminfo")
            .lines()
            .find_map(|line| {
                line.strip_prefix("MemTotal:")
                    .and_then(|value| value.split_whitespace().next())
                    .and_then(|value| value.parse::<u64>().ok())
                    .and_then(|kibibytes| kibibytes.checked_mul(1024))
            })
            .expect("parse Linux memory size"),
        other => panic!("memory discovery is unsupported on {other}"),
    }
}

fn cpu_name() -> String {
    match std::env::consts::OS {
        "macos" => command_output("sysctl", &["-n", "machdep.cpu.brand_string"]),
        "linux" => fs::read_to_string("/proc/cpuinfo")
            .expect("read /proc/cpuinfo")
            .lines()
            .find_map(|line| {
                line.strip_prefix("model name")
                    .and_then(|value| value.split_once(':'))
                    .map(|(_, value)| value.trim().to_string())
            })
            .unwrap_or_else(|| "unknown Linux CPU".to_string()),
        other => format!("unknown CPU on {other}"),
    }
}

fn operating_system() -> String {
    match std::env::consts::OS {
        "macos" => format!(
            "{} {} ({})",
            command_output("sw_vers", &["-productName"]),
            command_output("sw_vers", &["-productVersion"]),
            command_output("uname", &["-m"])
        ),
        "linux" => {
            let distribution = fs::read_to_string("/etc/os-release")
                .ok()
                .and_then(|source| {
                    source.lines().find_map(|line| {
                        line.strip_prefix("PRETTY_NAME=")
                            .map(|value| value.trim_matches('"').to_string())
                    })
                })
                .unwrap_or_else(|| "Linux".to_string());
            format!(
                "{} {} ({})",
                distribution,
                command_output("uname", &["-r"]),
                command_output("uname", &["-m"])
            )
        }
        other => format!("{other} ({})", command_output("uname", &["-m"])),
    }
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf()
}

fn git_output(root: &Path, arguments: &[&str]) -> String {
    let root = root.to_str().expect("UTF-8 repository root");
    let mut command_arguments = vec!["-C", root];
    command_arguments.extend_from_slice(arguments);
    command_output("git", &command_arguments)
}

fn main() {
    let server_path = benchmark_server_path();
    assert!(
        server_path.is_file(),
        "release server does not exist at {}; build it first",
        server_path.display()
    );
    let root = repository_root();
    let source_commit = git_output(&root, &["rev-parse", "HEAD"]);
    let working_tree_dirty = !git_output(&root, &["status", "--porcelain"]).is_empty();
    let server_executable = server_path
        .file_name()
        .and_then(|name| name.to_str())
        .expect("UTF-8 server executable filename");
    let scenarios = SCENARIOS
        .into_iter()
        .map(|(label, byte_count)| benchmark_scenario(&server_path, label, byte_count))
        .collect::<Vec<_>>();
    let report = json!({
        "schemaVersion": "colorful.lsp.envelope/v1",
        "generatedAt": command_output("date", &["-u", "+%Y-%m-%dT%H:%M:%SZ"]),
        "profile": "release",
        "source": {
            "gitCommit": source_commit,
            "workingTreeDirty": working_tree_dirty
        },
        "environment": {
            "operatingSystem": operating_system(),
            "cpu": cpu_name(),
            "memoryBytes": memory_bytes(),
            "rustc": command_output("rustc", &["-Vv"]),
            "cargo": command_output("cargo", &["-V"]),
            "node": command_output("node", &["--version"]),
            "pinnedNode": fs::read_to_string(root.join(".node-version"))
                .expect("read .node-version")
                .trim()
        },
        "corpus": {
            "id": CORPUS_ID,
            "template": CORPUS_LINE,
            "sizes": SCENARIOS.map(|(_, bytes)| bytes)
        },
        "slo": {
            "supportedLimitBytes": SUPPORTED_LIMIT_BYTES,
            "openOrChangeToDiagnosticsMs": OPEN_OR_CHANGE_DIAGNOSTICS_MS as u64,
            "cachedSemanticTokensMs": CACHED_SEMANTIC_TOKENS_MS as u64,
            "overloadCompletionMs": OVERLOAD_COMPLETION_MS as u64,
            "maxQueueDelayMs": MAX_QUEUE_DELAY_MS as u64,
            "supportedPeakRssBytes": SUPPORTED_PEAK_RSS_BYTES,
            "refusalDiagnosticsMs": REFUSAL_DIAGNOSTICS_MS as u64,
            "refusalPeakRssBytes": REFUSAL_PEAK_RSS_BYTES,
            "concurrentSemanticRequests": CONCURRENT_SEMANTIC_REQUESTS,
            "rapidEditCount": RAPID_EDIT_COUNT
        },
        "measurement": {
            "serverExecutable": server_executable,
            "peakRssTool": "/usr/bin/time",
            "timingClock": "std::time::Instant",
            "wallClockGatesCorrectnessCi": false
        },
        "scenarios": scenarios
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("encode benchmark report")
    );
    if report["scenarios"]
        .as_array()
        .expect("scenario array")
        .iter()
        .any(|scenario| scenario["sloMet"] != true)
    {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{corpus, parse_peak_rss, TimeFlavor, CORPUS_LINE};

    #[test]
    fn corpus_generation_is_exact_and_deterministic() {
        assert_eq!(corpus(0), "");
        assert_eq!(corpus(CORPUS_LINE.len()), CORPUS_LINE);
        assert_eq!(corpus(CORPUS_LINE.len() + 3), format!("{CORPUS_LINE}The"));
    }

    #[test]
    fn peak_rss_parser_covers_supported_time_flavors() {
        assert_eq!(
            parse_peak_rss("  123456  maximum resident set size\n", TimeFlavor::Darwin),
            123_456
        );
        assert_eq!(
            parse_peak_rss(
                "Maximum resident set size (kbytes): 654321\n",
                TimeFlavor::Gnu
            ),
            654_321 * 1024
        );
    }
}
