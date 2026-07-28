//! Allocation-only companion process for `cross_stage_benchmark`.
//!
//! Keeping the instrumented allocator in this separate executable prevents the
//! latency benchmark from timing profiler overhead.

#![forbid(unsafe_code)]

#[global_allocator]
static ALLOCATOR: dhat::Alloc = dhat::Alloc;

use serde_json::json;

mod cross_stage_support;

use cross_stage_support::{PreparedStageInput, CORPORA, STAGES};

fn require_release_profile() {
    #[cfg(debug_assertions)]
    panic!("cross_stage_allocations must run with --release");
}

fn main() {
    require_release_profile();
    let mut measurements = Vec::new();

    for corpus in &CORPORA {
        assert!(!corpus.path.is_empty(), "corpus path must be published");
        let prepared = PreparedStageInput::new(corpus);
        for stage in STAGES {
            prepared.run(stage);
            let profiler = dhat::Profiler::builder().testing().build();
            prepared.run(stage);
            let stats = dhat::HeapStats::get();
            drop(profiler);
            measurements.push(json!({
                "stage": stage.name(),
                "corpus": corpus.id,
                "allocationCount": stats.total_blocks,
                "allocatedBytes": stats.total_bytes
            }));
        }
    }

    println!(
        "{}",
        serde_json::to_string(&json!({
            "schemaVersion": "colorful.performance.allocations/v1",
            "measurements": measurements
        }))
        .expect("encode allocation report")
    );
}
