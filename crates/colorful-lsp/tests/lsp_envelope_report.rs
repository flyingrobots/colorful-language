//! Deterministic contract checks for the reviewed release-mode LSP evidence.

use std::fs;
use std::path::Path;

use serde_json::Value;

const SCHEMA_VERSION: &str = "colorful.lsp.envelope/v1";
const SUPPORTED_LIMIT_BYTES: u64 = 5 * 1024 * 1024;
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

#[test]
fn baseline_covers_the_reviewed_supported_envelope() {
    let baseline = baseline();
    assert_eq!(baseline["schemaVersion"], SCHEMA_VERSION);
    assert_eq!(baseline["profile"], "release");
    assert_eq!(baseline["corpus"]["id"], "colorful-lsp-repeated-prose/v1");
    assert!(baseline["source"]["gitCommit"]
        .as_str()
        .is_some_and(|commit| commit.len() == 40));

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
            "openOrChangeToDiagnosticsMs": 5_000,
            "cachedSemanticTokensMs": 2_000,
            "overloadCompletionMs": 8_000,
            "maxQueueDelayMs": 250,
            "supportedPeakRssBytes": 1_536_u64 * 1024 * 1024,
            "refusalDiagnosticsMs": 1_000,
            "refusalPeakRssBytes": 512_u64 * 1024 * 1024,
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
        assert!(scenario["corpusSha256"]
            .as_str()
            .is_some_and(|hash| hash.len() == 64));
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
            scenario["latestDiagnosticVersion"],
            scenario["finalDocumentVersion"]
        );
        assert_eq!(scenario["stalePublicationCount"], 0);
        assert_eq!(scenario["sloFailures"], serde_json::json!([]));
        assert_eq!(scenario["sloMet"], true);
    }

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
            .is_some_and(|ids| ids.len() == 4));
    }

    let refused = scenarios.last().expect("10 MiB scenario");
    assert_eq!(refused["outcomeCategory"], "document-too-large");
    assert_eq!(refused["diagnosticCode"], "colorful/document-too-large");
    assert_eq!(refused["open"]["semanticTokenCount"], 0);
    assert_eq!(refused["incremental"]["semanticTokenCount"], 0);
}
