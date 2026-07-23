//! Release-mode latency benchmarks for `colorful_lsp::compute_semantic_tokens`.
//!
//! `v0`'s incrementality model reparses the whole document on every request
//! (see `docs/topics/coloring/README.md`), so this benchmark's cost model
//! *is* the per-edit cost an editor pays on `didChange`. Run with
//! `cargo bench -p colorful-lsp`. See `docs/topics/coloring/README.md` for
//! the measured figures this produces and how to read them.

use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_parse::ProseParser;
use criterion::{black_box, criterion_group, criterion_main, Criterion};

const SMALL: &str = include_str!("../../colorful-cli/fixtures/editor-smoke-prose.txt");
const MEDIUM: &str = include_str!("../../colorful-cli/fixtures/bench-corpus.txt");

fn bench_semantic_tokens(c: &mut Criterion) {
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let mut group = c.benchmark_group("semantic_tokens (full reparse, v0's per-edit cost)");

    group.bench_function("small (899 B, real prose)", |b| {
        b.iter(|| colorful_lsp::compute_semantic_tokens(black_box(SMALL), &parser, &annotator));
    });

    group.bench_function("medium (45 KB, repeated prose)", |b| {
        b.iter(|| colorful_lsp::compute_semantic_tokens(black_box(MEDIUM), &parser, &annotator));
    });

    group.finish();
}

criterion_group!(benches, bench_semantic_tokens);
criterion_main!(benches);
