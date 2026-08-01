//! Release-mode latency benchmarks for `colorful_cli::colorize` (parse +
//! classify + ANSI render — the CLI's whole hot path for `colorful FILE`).
//!
//! Run with `cargo bench -p colorful-cli`. See
//! `docs/topics/coloring/README.md` for the measured figures this produces
//! and how to read them; this file only defines what is measured, not the
//! published numbers themselves, so it can't go stale in a way that silently
//! invalidates the docs.

use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

const SMALL: &str = include_str!("../fixtures/editor-smoke-prose.txt");
const MEDIUM: &str = include_str!("../fixtures/bench-corpus.txt");

fn bench_colorize(c: &mut Criterion) {
    let mut group = c.benchmark_group("colorize");

    group.bench_function("small (899 B, real prose)", |b| {
        b.iter(|| colorful_cli::colorize(black_box(SMALL), true));
    });

    group.bench_function("medium (45 KB, repeated prose)", |b| {
        b.iter(|| colorful_cli::colorize(black_box(MEDIUM), true));
    });

    group.finish();
}

criterion_group!(benches, bench_colorize);
criterion_main!(benches);
