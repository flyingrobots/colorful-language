//! Deterministic contract checks for the reviewed release-mode LSP evidence.

use std::fs;
use std::path::Path;

use serde_json::Value;
use sha2::{Digest, Sha256};

const SCHEMA_VERSION: &str = "colorful.lsp.envelope/v1";
const SUPPORTED_LIMIT_BYTES: u64 = 5 * 1024 * 1024;
const OPEN_OR_CHANGE_DIAGNOSTICS_MS: u64 = 5_000;
const CACHED_SEMANTIC_TOKENS_MS: u64 = 2_000;
const OVERLOAD_COMPLETION_MS: u64 = 8_000;
const MAX_QUEUE_DELAY_MS: u64 = 250;
const SUPPORTED_PEAK_RSS_BYTES: u64 = 1_536 * 1024 * 1024;
const REFUSAL_DIAGNOSTICS_MS: u64 = 1_000;
const REFUSAL_PEAK_RSS_BYTES: u64 = 512 * 1024 * 1024;
const SCENARIO_BYTES: [u64; 4] = [100 * 1024, 1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024];

fn baseline() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("benchmarks")
        .join("lsp-envelope-baseline.json");
    let source = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    serde_json::from_str(&source)
        .unwrap_or_else(|error| panic!("decode {}: {error}", path.display()))
}

fn measurement_at_most(scenario: &Value, section: &str, name: &str, limit: f64) -> bool {
    scenario[section][name]
        .as_f64()
        .is_some_and(|measurement| measurement <= limit)
}

fn all_counts(scenario: &Value, expected: impl Fn(u64) -> bool) -> bool {
    scenario["overload"]["semanticTokenCounts"]
        .as_array()
        .is_some_and(|counts| {
            counts.len() == 4
                && counts
                    .iter()
                    .all(|count| count.as_u64().is_some_and(&expected))
        })
}

fn semantic_results_are_fresh(scenario: &Value) -> bool {
    let expected = scenario["finalGeneration"]
        .as_u64()
        .map(|version| version.to_string());
    scenario["overload"]["semanticResultIds"]
        .as_array()
        .zip(expected)
        .is_some_and(|(ids, expected)| {
            ids.len() == 4 && ids.iter().all(|id| id.as_str() == Some(&expected))
        })
}

fn measured_slo_is_met(scenario: &Value) -> bool {
    let Some(document_bytes) = scenario["documentBytes"].as_u64() else {
        return false;
    };
    let common = scenario["processExitCode"] == 0
        && scenario["stalePublicationCount"] == 0
        && scenario["latestDiagnosticVersion"] == scenario["finalDocumentVersion"]
        && scenario["metrics"]["staleResults"] == 0
        && scenario["metrics"]["analysisFailures"] == 0
        && semantic_results_are_fresh(scenario);
    if !common {
        return false;
    }

    if document_bytes <= SUPPORTED_LIMIT_BYTES {
        scenario["outcomeCategory"] == "analyzed"
            && scenario["diagnosticCode"].is_null()
            && scenario["incremental"]["diagnosticCode"].is_null()
            && scenario["overload"]["diagnosticCode"].is_null()
            && measurement_at_most(
                scenario,
                "open",
                "diagnosticsMs",
                OPEN_OR_CHANGE_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "incremental",
                "diagnosticsMs",
                OPEN_OR_CHANGE_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "open",
                "semanticTokensMs",
                CACHED_SEMANTIC_TOKENS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "incremental",
                "semanticTokensMs",
                CACHED_SEMANTIC_TOKENS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "overload",
                "timeToLatestDiagnosticsMs",
                OVERLOAD_COMPLETION_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "overload",
                "slowestSemanticResponseMs",
                OVERLOAD_COMPLETION_MS as f64,
            )
            && scenario["metrics"]["maxQueueDelayMicros"]
                .as_u64()
                .is_some_and(|delay| delay <= MAX_QUEUE_DELAY_MS * 1_000)
            && scenario["peakRssBytes"]
                .as_u64()
                .is_some_and(|bytes| bytes <= SUPPORTED_PEAK_RSS_BYTES)
            && scenario["open"]["semanticTokenCount"]
                .as_u64()
                .is_some_and(|count| count > 0)
            && scenario["incremental"]["semanticTokenCount"]
                .as_u64()
                .is_some_and(|count| count > 0)
            && all_counts(scenario, |count| count > 0)
    } else {
        scenario["outcomeCategory"] == "document-too-large"
            && scenario["diagnosticCode"] == "colorful/document-too-large"
            && scenario["incremental"]["diagnosticCode"] == "colorful/document-too-large"
            && scenario["overload"]["diagnosticCode"] == "colorful/document-too-large"
            && measurement_at_most(
                scenario,
                "open",
                "diagnosticsMs",
                REFUSAL_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "open",
                "semanticTokensMs",
                REFUSAL_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "incremental",
                "diagnosticsMs",
                REFUSAL_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "incremental",
                "semanticTokensMs",
                REFUSAL_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "overload",
                "timeToLatestDiagnosticsMs",
                REFUSAL_DIAGNOSTICS_MS as f64,
            )
            && measurement_at_most(
                scenario,
                "overload",
                "slowestSemanticResponseMs",
                REFUSAL_DIAGNOSTICS_MS as f64,
            )
            && scenario["peakRssBytes"]
                .as_u64()
                .is_some_and(|bytes| bytes <= REFUSAL_PEAK_RSS_BYTES)
            && scenario["open"]["semanticTokenCount"] == 0
            && scenario["incremental"]["semanticTokenCount"] == 0
            && all_counts(scenario, |count| count == 0)
    }
}

fn claimed_slo_is_consistent(report: &Value) -> bool {
    report["scenarios"].as_array().is_some_and(|scenarios| {
        scenarios.iter().all(|scenario| {
            measured_slo_is_met(scenario)
                && scenario["sloMet"] == true
                && scenario["sloFailures"] == serde_json::json!([])
        })
    })
}

fn claimed_corpus_is_consistent(report: &Value) -> bool {
    let Some(template) = report["corpus"]["template"]
        .as_str()
        .filter(|template| !template.is_empty())
    else {
        return false;
    };
    report["scenarios"].as_array().is_some_and(|scenarios| {
        scenarios.iter().all(|scenario| {
            let Some(byte_count) = scenario["documentBytes"]
                .as_u64()
                .and_then(|count| usize::try_from(count).ok())
            else {
                return false;
            };
            let repetitions = byte_count.div_ceil(template.len());
            let mut corpus = template.repeat(repetitions);
            corpus.truncate(byte_count);
            let expected = format!("{:x}", Sha256::digest(corpus.as_bytes()));
            scenario["corpusBytes"].as_u64() == Some(byte_count as u64)
                && scenario["corpusSha256"].as_str() == Some(&expected)
        })
    })
}

#[test]
fn baseline_covers_the_reviewed_supported_envelope() {
    let baseline = baseline();
    assert_eq!(baseline["schemaVersion"], SCHEMA_VERSION);
    assert_eq!(baseline["profile"], "release");
    assert_eq!(baseline["corpus"]["id"], "colorful-lsp-repeated-prose/v1");
    assert_eq!(baseline["source"]["workingTreeDirty"], false);
    assert!(baseline["source"]["gitCommit"].as_str().is_some_and(
        |commit| commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
    ));
    assert_eq!(
        baseline["measurement"]["serverProvenance"],
        "workspace-release-build"
    );
    assert_eq!(
        baseline["measurement"]["serverSourceGitCommit"],
        baseline["source"]["gitCommit"]
    );
    assert_eq!(baseline["measurement"]["runsPerScenario"], 1);
    assert_eq!(
        baseline["measurement"]["measuredPlatform"],
        "darwin-aarch64"
    );
    assert!(baseline["measurement"]["serverSha256"]
        .as_str()
        .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())));

    for key in [
        "operatingSystem",
        "cpu",
        "memoryBytes",
        "rustc",
        "cargo",
        "node",
    ] {
        assert!(
            baseline["environment"][key]
                .as_str()
                .is_some_and(|value| !value.is_empty())
                || baseline["environment"][key]
                    .as_u64()
                    .is_some_and(|value| value > 0),
            "missing environment field {key}"
        );
    }

    assert_eq!(
        baseline["slo"],
        serde_json::json!({
            "supportedLimitBytes": SUPPORTED_LIMIT_BYTES,
            "openOrChangeToDiagnosticsMs": OPEN_OR_CHANGE_DIAGNOSTICS_MS,
            "cachedSemanticTokensMs": CACHED_SEMANTIC_TOKENS_MS,
            "overloadCompletionMs": OVERLOAD_COMPLETION_MS,
            "maxQueueDelayMs": MAX_QUEUE_DELAY_MS,
            "supportedPeakRssBytes": SUPPORTED_PEAK_RSS_BYTES,
            "refusalDiagnosticsMs": REFUSAL_DIAGNOSTICS_MS,
            "refusalPeakRssBytes": REFUSAL_PEAK_RSS_BYTES,
            "concurrentSemanticRequests": 4,
            "rapidEditCount": 4
        })
    );

    let scenarios = baseline["scenarios"].as_array().expect("scenario array");
    assert_eq!(scenarios.len(), SCENARIO_BYTES.len());
    assert_eq!(
        scenarios
            .iter()
            .map(|scenario| scenario["documentBytes"]
                .as_u64()
                .expect("document byte count"))
            .collect::<Vec<_>>(),
        SCENARIO_BYTES
    );

    for scenario in scenarios {
        assert_eq!(scenario["corpusBytes"], scenario["documentBytes"]);
        assert!(scenario["peakRssBytes"].as_u64().is_some());
        assert!(scenario["open"]["dispatchMs"].as_f64().is_some());
        assert!(scenario["open"]["diagnosticsMs"].as_f64().is_some());
        assert!(scenario["open"]["semanticTokensMs"].as_f64().is_some());
        assert!(scenario["incremental"]["dispatchMs"].as_f64().is_some());
        assert!(scenario["incremental"]["diagnosticsMs"].as_f64().is_some());
        assert!(scenario["incremental"]["semanticTokensMs"]
            .as_f64()
            .is_some());
        assert_eq!(scenario["overload"]["rapidEditCount"], 4);
        assert_eq!(scenario["overload"]["concurrentSemanticRequests"], 4);
        assert!(scenario["overload"]["timeToLatestDiagnosticsMs"]
            .as_f64()
            .is_some());
        assert!(scenario["overload"]["slowestSemanticResponseMs"]
            .as_f64()
            .is_some());
        assert!(scenario["metrics"]["maxQueueDelayMicros"]
            .as_u64()
            .is_some());
        assert_eq!(
            scenario["metrics"]["schemaVersion"],
            "colorful.lsp.metrics/v1"
        );
        assert!(scenario["metrics"]["staleResults"].as_u64().is_some());
        assert_eq!(
            scenario["latestDiagnosticVersion"],
            scenario["finalDocumentVersion"]
        );
        assert!(scenario["finalGeneration"].as_u64().is_some());
        assert_eq!(scenario["processExitCode"], 0);
        assert_eq!(scenario["stalePublicationCount"], 0);
        assert_eq!(scenario["sloFailures"], serde_json::json!([]));
        assert_eq!(scenario["sloMet"], true);
    }
    assert!(claimed_corpus_is_consistent(&baseline));
    assert!(claimed_slo_is_consistent(&baseline));

    let accepted = scenarios
        .iter()
        .filter(|scenario| scenario["documentBytes"].as_u64() <= Some(SUPPORTED_LIMIT_BYTES));
    for scenario in accepted {
        assert_eq!(scenario["outcomeCategory"], "analyzed");
        assert!(scenario["open"]["semanticTokenCount"]
            .as_u64()
            .is_some_and(|count| count > 0));
        assert!(scenario["overload"]["semanticResultIds"]
            .as_array()
            .zip(scenario["finalGeneration"].as_u64())
            .is_some_and(|(ids, generation)| {
                let expected = generation.to_string();
                ids.len() == 4 && ids.iter().all(|id| id.as_str() == Some(&expected))
            }));
        assert!(scenario["overload"]["semanticTokenCounts"]
            .as_array()
            .is_some_and(|counts| {
                counts.len() == 4
                    && counts
                        .iter()
                        .all(|count| count.as_u64().is_some_and(|count| count > 0))
            }));
    }

    let refused = scenarios.last().expect("10 MiB scenario");
    assert_eq!(refused["outcomeCategory"], "document-too-large");
    assert_eq!(refused["diagnosticCode"], "colorful/document-too-large");
    assert_eq!(
        refused["incremental"]["diagnosticCode"],
        "colorful/document-too-large"
    );
    assert_eq!(
        refused["overload"]["diagnosticCode"],
        "colorful/document-too-large"
    );
    assert_eq!(refused["open"]["semanticTokenCount"], 0);
    assert!(refused["open"]["throughputBytesPerSecond"].is_null());
    assert_eq!(refused["incremental"]["semanticTokenCount"], 0);
    assert!(refused["overload"]["semanticTokenCounts"]
        .as_array()
        .is_some_and(|counts| { counts.len() == 4 && counts.iter().all(|count| count == 0) }));
}

#[test]
fn false_green_slo_claim_is_rejected() {
    let mut report = baseline();
    report["scenarios"][2]["open"]["diagnosticsMs"] = serde_json::json!(5_001.0);

    assert!(!claimed_slo_is_consistent(&report));
}

#[test]
fn false_corpus_hash_is_rejected() {
    let mut report = baseline();
    report["scenarios"][2]["corpusSha256"] = serde_json::json!("0".repeat(64));

    assert!(!claimed_corpus_is_consistent(&report));
}

#[test]
fn ordinary_cargo_test_runs_the_harness_unit_tests() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let manifest = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));

    assert!(
        manifest.contains(
            "[[example]]\nname = \"lsp_envelope\"\npath = \"examples/lsp_envelope.rs\"\ntest = true"
        ),
        "the benchmark harness must run its unit tests under ordinary cargo test"
    );
}

#[test]
fn current_reference_quotes_the_reviewed_measurements() {
    let baseline = baseline();
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .join("docs")
        .join("topics")
        .join("coloring")
        .join("README.md");
    let current_reference = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));

    for scenario in baseline["scenarios"].as_array().expect("scenario array") {
        let outcome = match scenario["outcomeCategory"].as_str() {
            Some("document-too-large") => "document too large",
            Some(outcome) => outcome,
            None => panic!("scenario outcome category"),
        };
        let peak_rss_mib = scenario["peakRssBytes"].as_f64().expect("peak RSS") / (1024.0 * 1024.0);
        let row = format!(
            "| {} | {} | {:.1} ms | {:.1} ms | {:.1} ms | {:.1} ms | {:.1} MiB |",
            scenario["label"].as_str().expect("scenario label"),
            outcome,
            scenario["open"]["diagnosticsMs"]
                .as_f64()
                .expect("open diagnostics"),
            scenario["incremental"]["diagnosticsMs"]
                .as_f64()
                .expect("incremental diagnostics"),
            scenario["open"]["semanticTokensMs"]
                .as_f64()
                .expect("cached semantic tokens"),
            scenario["overload"]["slowestSemanticResponseMs"]
                .as_f64()
                .expect("overload response"),
            peak_rss_mib,
        );
        assert!(
            current_reference.contains(&row),
            "{} does not quote reviewed row: {row}",
            path.display()
        );
    }
}
