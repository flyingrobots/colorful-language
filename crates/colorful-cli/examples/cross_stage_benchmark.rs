//! Release-mode benchmark for Colorful's independently observable Rust stages.
//!
//! Run from a clean workspace and redirect stdout to a temporary file:
//!
//! ```text
//! cargo run --locked --release -p colorful-cli \
//!   --example cross_stage_benchmark > /tmp/colorful-cross-stage.json
//! ```
//!
//! Review the report before replacing the committed baseline. Timing and
//! allocation tolerances are advisory evidence; correctness CI validates only
//! the report contract.

#![forbid(unsafe_code)]

use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use colorful_core::{Analyzer, Annotator, Parser, ValidatedClassification};
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;
use serde_json::{json, Value};

const REPORT_SCHEMA: &str = "colorful.performance.cross-stage/v1";
const TIMING_SAMPLES: usize = 9;
const ALLOCATION_COUNTER: &str = "allocation-counter 0.8.1";
const THROUGHPUT_BASIS: &str = "source-utf8-bytes";
const SMALL: &str = include_str!("../fixtures/editor-smoke-prose.txt");
const MEDIUM: &str = include_str!("../fixtures/bench-corpus.txt");

struct Corpus {
    id: &'static str,
    path: &'static str,
    source: &'static str,
}

struct StageMeasurement {
    stage: &'static str,
    corpus: &'static str,
    input_bytes: u64,
    median_nanoseconds: u64,
    throughput_bytes_per_second: u64,
    allocation_count: u64,
    allocated_bytes: u64,
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("canonical workspace root")
}

fn command_output(program: &str, args: &[&str]) -> String {
    let output = Command::new(program)
        .args(args)
        .current_dir(workspace_root())
        .output()
        .unwrap_or_else(|error| panic!("run {program}: {error}"));
    assert!(
        output.status.success(),
        "{program} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap_or_else(|error| panic!("{program} emitted non-UTF-8 output: {error}"))
        .trim()
        .to_owned()
}

fn generated_at() -> String {
    let value = std::env::var("COLORFUL_BENCHMARK_GENERATED_AT")
        .unwrap_or_else(|_| command_output("date", &["-u", "+%Y-%m-%dT%H:%M:%SZ"]));
    assert!(
        is_utc_timestamp(&value),
        "generatedAt must use YYYY-MM-DDTHH:MM:SSZ"
    );
    value
}

fn is_utc_timestamp(value: &str) -> bool {
    value.len() == 20
        && value.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            10 => byte == b'T',
            13 | 16 => byte == b':',
            19 => byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}

fn hardware() -> String {
    let architecture = command_output("uname", &["-m"]);
    let processor = if cfg!(target_os = "macos") {
        command_output("sysctl", &["-n", "machdep.cpu.brand_string"])
    } else if cfg!(target_os = "linux") {
        std::fs::read_to_string("/proc/cpuinfo")
            .expect("read /proc/cpuinfo")
            .lines()
            .find_map(|line| line.strip_prefix("model name\t: "))
            .unwrap_or("unknown processor")
            .to_owned()
    } else {
        "unknown processor".to_owned()
    };
    format!("{processor}; {architecture}")
}

fn parse_linux_memory_bytes(meminfo: &str) -> Option<u64> {
    let kibibytes = meminfo.lines().find_map(|line| {
        let fields = line.strip_prefix("MemTotal:")?.split_whitespace();
        fields.into_iter().next()?.parse::<u64>().ok()
    })?;
    kibibytes.checked_mul(1024)
}

fn total_memory_bytes() -> u64 {
    let bytes = if let Ok(value) = std::env::var("COLORFUL_BENCHMARK_TOTAL_MEMORY_BYTES") {
        value
            .parse()
            .expect("COLORFUL_BENCHMARK_TOTAL_MEMORY_BYTES must be a u64")
    } else if cfg!(target_os = "macos") {
        command_output("sysctl", &["-n", "hw.memsize"])
            .parse()
            .expect("sysctl hw.memsize must be a u64")
    } else if cfg!(target_os = "linux") {
        let meminfo = std::fs::read_to_string("/proc/meminfo").expect("read /proc/meminfo");
        parse_linux_memory_bytes(&meminfo).expect("parse MemTotal from /proc/meminfo")
    } else {
        panic!(
            "set COLORFUL_BENCHMARK_TOTAL_MEMORY_BYTES on platforms without a built-in memory probe"
        );
    };
    assert!(bytes > 0, "total memory must be positive");
    bytes
}

fn median_nanoseconds(mut samples: Vec<u64>) -> u64 {
    assert!(!samples.is_empty(), "median requires at least one sample");
    samples.sort_unstable();
    samples[samples.len() / 2]
}

fn throughput_bytes_per_second(input_bytes: u64, elapsed_nanoseconds: u64) -> u64 {
    assert!(
        elapsed_nanoseconds > 0,
        "throughput requires a nonzero duration"
    );
    let throughput =
        (u128::from(input_bytes) * 1_000_000_000_u128) / u128::from(elapsed_nanoseconds);
    u64::try_from(throughput).expect("throughput fits u64")
}

fn measure_stage<T, F>(stage: &'static str, corpus: &Corpus, mut operation: F) -> StageMeasurement
where
    F: FnMut() -> T,
{
    drop(black_box(operation()));

    let mut timing_samples = Vec::with_capacity(TIMING_SAMPLES);
    for _ in 0..TIMING_SAMPLES {
        let started = Instant::now();
        let value = black_box(operation());
        let elapsed = started.elapsed();
        drop(value);
        timing_samples.push(
            u64::try_from(elapsed.as_nanos())
                .expect("stage duration fits u64")
                .max(1),
        );
    }

    let allocations = allocation_counter::measure(|| {
        drop(black_box(operation()));
    });
    let input_bytes = u64::try_from(corpus.source.len()).expect("corpus length fits u64");
    let median_nanoseconds = median_nanoseconds(timing_samples);

    StageMeasurement {
        stage,
        corpus: corpus.id,
        input_bytes,
        median_nanoseconds,
        throughput_bytes_per_second: throughput_bytes_per_second(input_bytes, median_nanoseconds),
        allocation_count: allocations.count_total,
        allocated_bytes: allocations.bytes_total,
    }
}

fn measurement_json(measurement: StageMeasurement) -> Value {
    json!({
        "stage": measurement.stage,
        "corpus": measurement.corpus,
        "inputBytes": measurement.input_bytes,
        "medianNanoseconds": measurement.median_nanoseconds,
        "throughputBytesPerSecond": measurement.throughput_bytes_per_second,
        "allocationCount": measurement.allocation_count,
        "allocatedBytes": measurement.allocated_bytes
    })
}

fn require_release_profile() {
    #[cfg(debug_assertions)]
    panic!("cross_stage_benchmark must run with --release");
}

fn main() {
    require_release_profile();
    assert!(
        command_output("git", &["status", "--porcelain"]).is_empty(),
        "cross_stage_benchmark requires a clean worktree so sourceCommit is trustworthy"
    );

    let corpora = [
        Corpus {
            id: "small",
            path: "crates/colorful-cli/fixtures/editor-smoke-prose.txt",
            source: SMALL,
        },
        Corpus {
            id: "medium",
            path: "crates/colorful-cli/fixtures/bench-corpus.txt",
            source: MEDIUM,
        },
    ];
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let linter = ProseLinter::new();
    let mut measurements = Vec::new();

    for corpus in &corpora {
        let tree = parser.parse(corpus.source);
        let tokens = annotator.annotate(corpus.source, &tree);
        let classification =
            ValidatedClassification::new(corpus.source, tree.clone(), tokens.clone())
                .expect("built-in adapters produce a valid classification");
        let document = colorful_ir::from_validated_classification(
            corpus.id,
            &classification,
            parser.pass_identity(),
            annotator.pass_identity(),
        )
        .expect("built-in adapters project valid IR");

        measurements.push(measurement_json(measure_stage("parsing", corpus, || {
            parser.parse(black_box(corpus.source))
        })));
        measurements.push(measurement_json(measure_stage(
            "annotation",
            corpus,
            || annotator.annotate(black_box(corpus.source), black_box(&tree)),
        )));
        measurements.push(measurement_json(measure_stage("lint", corpus, || {
            linter.analyze(
                black_box(corpus.source),
                black_box(&tree),
                black_box(&tokens),
            )
        })));
        measurements.push(measurement_json(measure_stage(
            "ir-projection",
            corpus,
            || {
                colorful_ir::from_validated_classification(
                    corpus.id,
                    black_box(&classification),
                    parser.pass_identity(),
                    annotator.pass_identity(),
                )
                .expect("validated classification projects")
            },
        )));
        measurements.push(measurement_json(measure_stage(
            "ir-serialization",
            corpus,
            || colorful_ir::canonical_json(black_box(&document)).expect("serialize canonical IR"),
        )));
        measurements.push(measurement_json(measure_stage(
            "ir-validation",
            corpus,
            || {
                colorful_ir::validate_document(
                    black_box(&document),
                    Some(black_box(corpus.source.as_bytes())),
                )
                .expect("validate projected IR")
            },
        )));
    }

    let corpus_metadata = corpora
        .iter()
        .map(|corpus| {
            json!({
                "id": corpus.id,
                "path": corpus.path,
                "byteCount": corpus.source.len(),
                "sha256": colorful_ir::sha256_hex(corpus.source.as_bytes())
            })
        })
        .collect::<Vec<_>>();
    let authorities = [
        (
            "parsing",
            "cross-stage-release",
            "crates/colorful-cli/examples/cross_stage_benchmark.rs",
        ),
        (
            "annotation",
            "cross-stage-release",
            "crates/colorful-cli/examples/cross_stage_benchmark.rs",
        ),
        (
            "lint",
            "cross-stage-release",
            "crates/colorful-cli/examples/cross_stage_benchmark.rs",
        ),
        (
            "ir-projection",
            "cross-stage-release",
            "crates/colorful-cli/examples/cross_stage_benchmark.rs",
        ),
        (
            "ir-serialization",
            "cross-stage-release",
            "crates/colorful-cli/examples/cross_stage_benchmark.rs",
        ),
        (
            "ir-validation",
            "cross-stage-release",
            "crates/colorful-cli/examples/cross_stage_benchmark.rs",
        ),
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
    ]
    .map(|(stage, authority, evidence)| {
        json!({
            "stage": stage,
            "authority": authority,
            "evidence": evidence
        })
    });
    let report = json!({
        "schemaVersion": REPORT_SCHEMA,
        "measurement": {
            "generatedAt": generated_at(),
            "hardware": hardware(),
            "operatingSystem": command_output("uname", &["-srm"]),
            "rustc": command_output("rustc", &["--version"]),
            "profile": "release",
            "timingSamplesPerStage": TIMING_SAMPLES,
            "allocationSamplesPerStage": 1,
            "allocationCounter": ALLOCATION_COUNTER,
            "throughputBasis": THROUGHPUT_BASIS,
            "totalMemoryBytes": total_memory_bytes(),
            "sourceCommit": command_output("git", &["rev-parse", "HEAD"])
        },
        "regressionPolicy": {
            "enforcement": "advisory",
            "latencyTolerancePercent": 25,
            "allocationTolerancePercent": 10,
            "correctnessCiTimingGate": false
        },
        "corpora": corpus_metadata,
        "authorities": authorities,
        "measurements": measurements
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("encode benchmark report")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_uses_the_middle_sorted_sample() {
        assert_eq!(median_nanoseconds(vec![90, 10, 50, 30, 70]), 50);
    }

    #[test]
    fn throughput_is_derived_from_bytes_and_nanoseconds() {
        assert_eq!(throughput_bytes_per_second(1_000, 2_000), 500_000_000);
    }

    #[test]
    fn timestamp_contract_accepts_only_the_published_utc_shape() {
        assert!(is_utc_timestamp("2026-07-28T09:04:26Z"));
        assert!(!is_utc_timestamp("2026-07-28 09:04:26Z"));
        assert!(!is_utc_timestamp("2026-07-28T09:04:26+00:00"));
    }

    #[test]
    fn linux_memory_parser_converts_kibibytes_to_bytes() {
        assert_eq!(
            parse_linux_memory_bytes("MemTotal:       16384 kB\nMemFree: 2 kB\n"),
            Some(16_777_216)
        );
        assert_eq!(parse_linux_memory_bytes("MemFree: 2 kB\n"), None);
    }
}
