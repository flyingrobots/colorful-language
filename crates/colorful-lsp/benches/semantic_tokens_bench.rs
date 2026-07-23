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

/// Read a fixture shared with `colorful-cli` at runtime rather than
/// `include_str!`-ing it: `scripts/package-witness.sh` compiles this bench
/// against `colorful-lsp` extracted standalone via `cargo package`, where the
/// sibling `colorful-cli` crate directory isn't present (and can't be --
/// `cargo package` refuses paths outside the crate directory). A compile-time
/// `include_str!` would fail to build there; a runtime read only fails if the
/// benchmark is actually *run* outside a full workspace checkout, which
/// nobody does -- `cargo bench` is a development-time tool.
fn fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../colorful-cli/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn bench_semantic_tokens(c: &mut Criterion) {
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let small = fixture("editor-smoke-prose.txt");
    let medium = fixture("bench-corpus.txt");
    let mut group = c.benchmark_group("semantic_tokens (full reparse, v0's per-edit cost)");

    group.bench_function("small (899 B, real prose)", |b| {
        b.iter(|| colorful_lsp::compute_semantic_tokens(black_box(&small), &parser, &annotator));
    });

    group.bench_function("medium (45 KB, repeated prose)", |b| {
        b.iter(|| colorful_lsp::compute_semantic_tokens(black_box(&medium), &parser, &annotator));
    });

    group.finish();
}

criterion_group!(benches, bench_semantic_tokens);
criterion_main!(benches);
