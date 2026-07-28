//! Deterministic contract for the reviewed cross-stage performance evidence.
//!
//! This test validates committed metadata and measurements. It deliberately
//! does not rerun wall-clock benchmarks in correctness CI.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

const REPORT_SCHEMA: &str = "colorful.performance.cross-stage/v1";
const GRAFT_REPORT_SCHEMA: &str = "colorful.performance.graft-projection/v1";
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
        "graft-projection-release",
        "consumers/graft-projection.benchmark.mjs",
    ),
];

fn workspace_root() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .ok()?;
    root.join("docs/topics/coloring/README.md")
        .is_file()
        .then_some(root)
}

fn evidence_path(workspace_root: Option<&Path>, relative_path: &str) -> Option<PathBuf> {
    if let Some(root) = workspace_root {
        return Some(root.join(relative_path));
    }
    let crate_relative = relative_path.strip_prefix("crates/colorful-cli/")?;
    Some(Path::new(env!("CARGO_MANIFEST_DIR")).join(crate_relative))
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

fn grouped_integer(value: u64) -> String {
    let digits = value.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, byte) in digits.bytes().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(char::from(byte));
    }
    grouped
}

fn display_duration(nanoseconds: u64) -> String {
    if nanoseconds < 100_000 {
        format!("{:.1} µs", nanoseconds as f64 / 1_000.0)
    } else if nanoseconds < 1_000_000 {
        format!("{:.0} µs", nanoseconds as f64 / 1_000.0)
    } else {
        format!("{:.2} ms", nanoseconds as f64 / 1_000_000.0)
    }
}

fn display_throughput(bytes_per_second: u64) -> String {
    format!("{:.1} MB/s", bytes_per_second as f64 / 1_000_000.0)
}

fn display_bytes(bytes: u64) -> String {
    const MEBIBYTE: u64 = 1024 * 1024;
    if bytes >= MEBIBYTE {
        format!("{:.2} MiB", bytes as f64 / MEBIBYTE as f64)
    } else {
        format!("{:.1} KiB", bytes as f64 / 1024.0)
    }
}

fn report_measurement<'a>(measurements: &'a [Value], stage: &str, corpus: &str) -> &'a Value {
    measurements
        .iter()
        .find(|measurement| {
            measurement["stage"].as_str() == Some(stage)
                && measurement["corpus"].as_str() == Some(corpus)
        })
        .unwrap_or_else(|| panic!("missing report measurement for {stage}/{corpus}"))
}

fn readme_report_mismatch(readme: &str, report: &Value) -> Option<String> {
    let metadata = &report["measurement"];
    let generated_at = object_string(metadata, "generatedAt");
    let rustc = object_string(metadata, "rustc");
    let rustc_summary = rustc
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");
    let node = object_string(metadata, "node")
        .strip_prefix('v')
        .unwrap_or_else(|| object_string(metadata, "node"));
    let hardware = object_string(metadata, "hardware");
    let (processor, architecture) = hardware
        .rsplit_once("; ")
        .unwrap_or_else(|| panic!("hardware must end in a semicolon-delimited architecture"));
    let gibibytes = metadata["totalMemoryBytes"]
        .as_u64()
        .expect("totalMemoryBytes must be an integer") as f64
        / (1024_u64.pow(3)) as f64;
    let memory = if gibibytes.fract() == 0.0 {
        format!("{gibibytes:.0} GiB RAM")
    } else {
        format!("{gibibytes:.1} GiB RAM")
    };
    let metadata_fragments = [
        &generated_at[..10],
        object_string(metadata, "sourceCommit"),
        &rustc_summary,
        node,
        object_string(metadata, "allocationCounter"),
        processor,
        architecture,
        &memory,
        object_string(metadata, "operatingSystem"),
    ];
    for fragment in metadata_fragments {
        if !readme.contains(fragment) {
            return Some(format!("README is missing benchmark metadata: {fragment}"));
        }
    }

    let measurements = report["measurements"]
        .as_array()
        .expect("measurements must be an array");
    let stage_labels = [
        ("parsing", "Parsing"),
        ("annotation", "Contextual annotation"),
        ("lint", "Lint analysis"),
        ("ir-projection", "Guarded IR projection"),
        ("ir-serialization", "Canonical IR serialization"),
        ("ir-validation", "Fail-closed IR validation"),
    ];
    for (stage, label) in stage_labels {
        let small = report_measurement(measurements, stage, "small");
        let medium = report_measurement(measurements, stage, "medium");
        let row = format!(
            "| {label} | {} | {} / {} | {} | {} | {} / {} |",
            display_duration(
                small["medianNanoseconds"]
                    .as_u64()
                    .expect("small median must be an integer")
            ),
            grouped_integer(
                small["allocationCount"]
                    .as_u64()
                    .expect("small allocation count must be an integer")
            ),
            display_bytes(
                small["allocatedBytes"]
                    .as_u64()
                    .expect("small allocated bytes must be an integer")
            ),
            display_duration(
                medium["medianNanoseconds"]
                    .as_u64()
                    .expect("medium median must be an integer")
            ),
            display_throughput(
                medium["throughputBytesPerSecond"]
                    .as_u64()
                    .expect("medium throughput must be an integer")
            ),
            grouped_integer(
                medium["allocationCount"]
                    .as_u64()
                    .expect("medium allocation count must be an integer")
            ),
            display_bytes(
                medium["allocatedBytes"]
                    .as_u64()
                    .expect("medium allocated bytes must be an integer")
            ),
        );
        if !readme.contains(&row) {
            return Some(format!("README is missing benchmark row: {row}"));
        }
    }

    let graft = &report["linkedMeasurements"][0]["measurements"];
    let graft = graft
        .as_array()
        .expect("Graft measurements must be an array");
    let small = graft
        .iter()
        .find(|measurement| measurement["corpus"] == "small")
        .expect("small Graft measurement");
    let medium = graft
        .iter()
        .find(|measurement| measurement["corpus"] == "medium")
        .expect("medium Graft measurement");
    let graft_row = format!(
        "| Graft projection | {} | unavailable | {} | {} | unavailable |",
        display_duration(
            small["medianNanoseconds"]
                .as_u64()
                .expect("small Graft median must be an integer")
        ),
        display_duration(
            medium["medianNanoseconds"]
                .as_u64()
                .expect("medium Graft median must be an integer")
        ),
        display_throughput(
            medium["throughputBytesPerSecond"]
                .as_u64()
                .expect("medium Graft throughput must be an integer")
        ),
    );
    (!readme.contains(&graft_row)).then(|| format!("README is missing benchmark row: {graft_row}"))
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
    let stats_alloc = &manifest["dev-dependencies"]["stats_alloc"];
    assert!(
        stats_alloc
            .get("workspace")
            .and_then(toml::Value::as_bool)
            == Some(true)
            || stats_alloc.get("version").and_then(toml::Value::as_str) == Some("0.1.10")
            || stats_alloc.as_str() == Some("0.1.10"),
        "the allocation probe must use stats_alloc 0.1.10 from either the workspace or normalized package manifest"
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
        "node",
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

    if let Some(root) = &root {
        let readme = std::fs::read_to_string(root.join("docs/topics/coloring/README.md"))
            .expect("read README");
        assert!(
            readme.contains(source_commit),
            "performance reference must identify the measured source commit"
        );
        assert_eq!(
            readme_report_mismatch(&readme, &report),
            None,
            "performance reference must render the reviewed report exactly"
        );
        let test_plan = std::fs::read_to_string(root.join("docs/topics/coloring/test-plan.md"))
            .expect("read test plan");
        assert!(
            !test_plan.contains("postcondition remains unmeasured"),
            "the test plan must not call delivered IR projection evidence unmeasured"
        );
    }

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
        let corpus_path = evidence_path(root.as_deref(), relative_path)
            .unwrap_or_else(|| panic!("corpus is not package-local: {relative_path}"));
        let bytes = std::fs::read(&corpus_path)
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
        if let Some(root) = &root {
            assert!(
                root.join(evidence).is_file(),
                "authority evidence does not exist: {evidence}"
            );
        }
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

    let linked_measurements = report["linkedMeasurements"]
        .as_array()
        .expect("linkedMeasurements must be an array");
    assert_eq!(linked_measurements.len(), 1);
    let graft = &linked_measurements[0];
    assert_eq!(graft["schemaVersion"], GRAFT_REPORT_SCHEMA);
    assert_eq!(graft["stage"], "graft-projection");
    assert_eq!(
        graft["allocationAttribution"], "unavailable-node-runtime",
        "JavaScript allocation attribution must remain explicit"
    );
    let graft_measurements = graft["measurements"]
        .as_array()
        .expect("Graft measurements must be an array");
    assert_eq!(graft_measurements.len(), corpora.len());
    let mut graft_corpora = BTreeSet::new();
    for measurement in graft_measurements {
        let corpus = object_string(measurement, "corpus");
        let input_bytes = *corpora
            .get(corpus)
            .unwrap_or_else(|| panic!("unknown Graft corpus {corpus}"));
        assert_eq!(
            measurement["inputBytes"].as_u64(),
            u64::try_from(input_bytes).ok()
        );
        let token_count = measurement["tokenCount"]
            .as_u64()
            .expect("Graft tokenCount must be an integer");
        let span_count = measurement["spanCount"]
            .as_u64()
            .expect("Graft spanCount must be an integer");
        let median_ns = measurement["medianNanoseconds"]
            .as_u64()
            .expect("Graft medianNanoseconds must be an integer");
        let throughput = measurement["throughputBytesPerSecond"]
            .as_u64()
            .expect("Graft throughputBytesPerSecond must be an integer");
        assert!(token_count > 0);
        assert_eq!(span_count, token_count);
        assert!(median_ns > 0);
        let expected_throughput = (u128::try_from(input_bytes).expect("input fits")
            * 1_000_000_000)
            / u128::from(median_ns);
        assert_eq!(u128::from(throughput), expected_throughput);
        assert!(
            graft_corpora.insert(corpus),
            "duplicate Graft measurement for {corpus}"
        );
    }
    assert_eq!(
        graft_corpora,
        corpora.keys().copied().collect::<BTreeSet<_>>()
    );

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

#[test]
fn a_stale_readme_benchmark_table_is_rejected() {
    let Some(root) = workspace_root() else {
        return;
    };
    let report = report();
    let readme =
        std::fs::read_to_string(root.join("docs/topics/coloring/README.md")).expect("read README");
    assert_eq!(readme_report_mismatch(&readme, &report), None);

    let stale = readme.replacen("| Parsing |", "| Stale parsing |", 1);
    assert!(
        readme_report_mismatch(&stale, &report).is_some(),
        "a changed display row must not satisfy the report contract"
    );
}
