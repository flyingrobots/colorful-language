//! Deterministic contract for the reviewed cross-stage performance evidence.
//!
//! This test validates committed metadata and measurements. It deliberately
//! does not rerun wall-clock benchmarks in correctness CI.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

const REPORT_SCHEMA: &str = "colorful.performance.cross-stage/v1";
const LOCAL_AUTHORITY: &str = "cross-stage-release";
const LOCAL_STAGES: [&str; 6] = [
    "parsing",
    "annotation",
    "lint",
    "ir-projection",
    "ir-serialization",
    "ir-validation",
];
const LINKED_AUTHORITIES: [(&str, &str, &str); 3] = [
    (
        "semantic-tokens",
        "criterion-semantic-tokens",
        "crates/colorful-lsp/benches/semantic_tokens_bench.rs",
    ),
    (
        "incremental-edits",
        "lsp-envelope",
        "crates/colorful-lsp/examples/lsp_envelope.rs",
    ),
    (
        "graft-projection",
        "graft-projection",
        "consumers/graft-projection.test.mjs",
    ),
];

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("canonical workspace root")
}

fn report() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("benchmarks/cross-stage-baseline.json");
    let bytes = std::fs::read(&path)
        .unwrap_or_else(|error| panic!("read benchmark report {}: {error}", path.display()));
    serde_json::from_slice(&bytes)
        .unwrap_or_else(|error| panic!("parse benchmark report {}: {error}", path.display()))
}

fn object_string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} must be a string"))
}

#[test]
fn cross_stage_benchmark_report_is_complete_and_advisory() {
    let manifest_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let manifest_source = std::fs::read_to_string(&manifest_path).expect("read CLI manifest");
    let manifest: toml::Value = toml::from_str(&manifest_source).expect("parse CLI manifest");
    let examples = manifest
        .get("example")
        .and_then(toml::Value::as_array)
        .expect("CLI manifest must declare examples");
    let harness = examples
        .iter()
        .find(|example| example["name"].as_str() == Some("cross_stage_benchmark"))
        .expect("CLI manifest must declare the cross_stage_benchmark example");
    assert_eq!(
        harness["path"].as_str(),
        Some("examples/cross_stage_benchmark.rs")
    );
    assert_eq!(harness["test"].as_bool(), Some(true));
    let allocation_probe = examples
        .iter()
        .find(|example| example["name"].as_str() == Some("cross_stage_allocations"))
        .expect("CLI manifest must declare the cross_stage_allocations example");
    assert_eq!(
        allocation_probe["path"].as_str(),
        Some("examples/cross_stage_allocations.rs")
    );
    assert_eq!(allocation_probe["test"].as_bool(), Some(true));
    assert_eq!(
        manifest["dev-dependencies"]["stats_alloc"]["workspace"].as_bool(),
        Some(true),
        "the allocation probe must use the reviewed workspace profiler"
    );
    assert!(
        manifest["dev-dependencies"].get("dhat").is_none(),
        "dhat pulls thousands 0.2.0, whose deprecated license expression is rejected by dependency review"
    );

    let report = report();
    assert_eq!(report["schemaVersion"], REPORT_SCHEMA);
    let root = workspace_root();

    let metadata = &report["measurement"];
    assert_eq!(metadata["profile"], "release");
    assert_eq!(metadata["timingSamplesPerStage"].as_u64(), Some(9));
    assert_eq!(metadata["allocationSamplesPerStage"].as_u64(), Some(1));
    assert_eq!(metadata["allocationCounter"], "stats_alloc 0.1.10");
    assert_eq!(metadata["throughputBasis"], "source-utf8-bytes");
    assert!(
        metadata["totalMemoryBytes"]
            .as_u64()
            .is_some_and(|bytes| bytes > 0),
        "measurement.totalMemoryBytes must be a positive integer"
    );
    for field in [
        "generatedAt",
        "hardware",
        "operatingSystem",
        "rustc",
        "sourceCommit",
    ] {
        assert!(
            !object_string(metadata, field).trim().is_empty(),
            "measurement.{field} must not be empty"
        );
    }
    let source_commit = object_string(metadata, "sourceCommit");
    assert_eq!(source_commit.len(), 40, "sourceCommit must be a full SHA");
    assert!(
        source_commit.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "sourceCommit must be hexadecimal"
    );
    let generated_at = object_string(metadata, "generatedAt");
    assert_eq!(
        generated_at.len(),
        20,
        "generatedAt must use YYYY-MM-DDTHH:MM:SSZ"
    );
    for (index, byte) in generated_at.bytes().enumerate() {
        let valid = match index {
            4 | 7 => byte == b'-',
            10 => byte == b'T',
            13 | 16 => byte == b':',
            19 => byte == b'Z',
            _ => byte.is_ascii_digit(),
        };
        assert!(valid, "generatedAt has an invalid byte at index {index}");
    }

    let readme =
        std::fs::read_to_string(root.join("docs/topics/coloring/README.md")).expect("read README");
    assert!(
        readme.contains(source_commit),
        "performance reference must identify the measured source commit"
    );

    let policy = &report["regressionPolicy"];
    assert_eq!(policy["enforcement"], "advisory");
    assert_eq!(policy["latencyTolerancePercent"].as_u64(), Some(25));
    assert_eq!(policy["allocationTolerancePercent"].as_u64(), Some(10));
    assert_eq!(policy["correctnessCiTimingGate"], false);

    let corpus_values = report["corpora"]
        .as_array()
        .expect("corpora must be an array");
    assert_eq!(corpus_values.len(), 2);
    let mut corpora = BTreeMap::new();
    for corpus in corpus_values {
        let id = object_string(corpus, "id");
        let relative_path = object_string(corpus, "path");
        let bytes = std::fs::read(root.join(relative_path))
            .unwrap_or_else(|error| panic!("read corpus {relative_path}: {error}"));
        assert_eq!(
            corpus["byteCount"].as_u64(),
            u64::try_from(bytes.len()).ok()
        );
        assert_eq!(
            object_string(corpus, "sha256"),
            colorful_ir::sha256_hex(&bytes)
        );
        assert!(
            corpora.insert(id, bytes.len()).is_none(),
            "duplicate corpus id {id}"
        );
    }
    assert_eq!(
        corpora,
        BTreeMap::from([("small", 899_usize), ("medium", 44_999_usize)])
    );

    let authority_values = report["authorities"]
        .as_array()
        .expect("authorities must be an array");
    assert_eq!(
        authority_values.len(),
        LOCAL_STAGES.len() + LINKED_AUTHORITIES.len()
    );
    let mut authorities = BTreeMap::new();
    for authority in authority_values {
        let stage = object_string(authority, "stage");
        let name = object_string(authority, "authority");
        let evidence = object_string(authority, "evidence");
        assert!(
            root.join(evidence).is_file(),
            "authority evidence does not exist: {evidence}"
        );
        assert!(
            authorities.insert(stage, (name, evidence)).is_none(),
            "duplicate authority for {stage}"
        );
    }
    for stage in LOCAL_STAGES {
        assert_eq!(
            authorities.get(stage),
            Some(&(
                LOCAL_AUTHORITY,
                "crates/colorful-cli/examples/cross_stage_benchmark.rs"
            )),
            "wrong local authority for {stage}"
        );
    }
    for (stage, authority, evidence) in LINKED_AUTHORITIES {
        assert_eq!(
            authorities.get(stage),
            Some(&(authority, evidence)),
            "wrong linked authority for {stage}"
        );
    }

    let measurements = report["measurements"]
        .as_array()
        .expect("measurements must be an array");
    assert_eq!(measurements.len(), LOCAL_STAGES.len() * corpora.len());
    let mut measured_pairs = BTreeSet::new();
    for measurement in measurements {
        let stage = object_string(measurement, "stage");
        let corpus = object_string(measurement, "corpus");
        assert!(LOCAL_STAGES.contains(&stage), "unexpected stage {stage}");
        let input_bytes = *corpora
            .get(corpus)
            .unwrap_or_else(|| panic!("unknown corpus {corpus}"));
        assert_eq!(
            measurement["inputBytes"].as_u64(),
            u64::try_from(input_bytes).ok()
        );
        let median_ns = measurement["medianNanoseconds"]
            .as_u64()
            .expect("medianNanoseconds must be an integer");
        let throughput = measurement["throughputBytesPerSecond"]
            .as_u64()
            .expect("throughputBytesPerSecond must be an integer");
        let allocation_count = measurement["allocationCount"]
            .as_u64()
            .expect("allocationCount must be an integer");
        let allocated_bytes = measurement["allocatedBytes"]
            .as_u64()
            .expect("allocatedBytes must be an integer");
        assert!(median_ns > 0);
        assert!(throughput > 0);
        assert!(allocation_count > 0);
        assert!(allocated_bytes > 0);

        let expected_throughput = (u128::try_from(input_bytes).expect("input fits")
            * 1_000_000_000)
            / u128::from(median_ns);
        assert_eq!(
            u128::from(throughput),
            expected_throughput,
            "throughput must be derived from bytes and median duration"
        );
        assert!(
            measured_pairs.insert((stage, corpus)),
            "duplicate measurement for {stage}/{corpus}"
        );
    }
    let expected_pairs = LOCAL_STAGES
        .into_iter()
        .flat_map(|stage| corpora.keys().copied().map(move |corpus| (stage, corpus)))
        .collect::<BTreeSet<_>>();
    assert_eq!(measured_pairs, expected_pairs);
}
