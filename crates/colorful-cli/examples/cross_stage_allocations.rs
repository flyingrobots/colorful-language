//! Allocation-only companion process for `cross_stage_benchmark`.
//!
//! Keeping the instrumented allocator in this separate executable prevents the
//! latency benchmark from timing profiler overhead.

#![forbid(unsafe_code)]

use std::alloc::System;

#[global_allocator]
static ALLOCATOR: &stats_alloc::StatsAlloc<System> = &stats_alloc::INSTRUMENTED_SYSTEM;

use serde_json::json;
use stats_alloc::Region;

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
            let region = Region::new(ALLOCATOR);
            prepared.run(stage);
            let stats = region.change();
            let allocation_count = stats
                .allocations
                .checked_add(stats.reallocations)
                .expect("allocation count fits usize");
            let reallocated_growth = usize::try_from(stats.bytes_reallocated.max(0))
                .expect("nonnegative reallocation growth fits usize");
            let allocated_bytes = stats
                .bytes_allocated
                .checked_add(reallocated_growth)
                .expect("allocated bytes fit usize");
            measurements.push(json!({
                "stage": stage.name(),
                "corpus": corpus.id,
                "allocationCount": allocation_count,
                "allocatedBytes": allocated_bytes
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
