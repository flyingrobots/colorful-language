//! Release-mode latency benchmarks for `colorful_lsp::compute_semantic_tokens`.
//!
//! This directly times the stateless helper that computes one full semantic-token
//! result, so every benchmark iteration parses and classifies its input. It does
//! not exercise the production `DocumentStore`: after `didOpen` or a debounced
//! `didChange`, the server calls `analyze_document` once for each accepted
//! generation within the document-size limit and caches both diagnostics and
//! semantic tokens. An oversized generation instead bypasses parsing,
//! classification, and linting while caching a limit diagnostic and empty token
//! data.
//!
//! Consequently this benchmark omits snapshot conversion, debounce and queue
//! delay, cancellation, lint analysis, cache coordination, diagnostic
//! publication, and JSON-RPC transport. Run it with
//! `cargo bench -p colorful-lsp`. See `docs/topics/coloring/README.md` for the
//! measured helper figures,
//! [#122](https://github.com/flyingrobots/colorful-language/issues/122)
//! for the production overload envelope, and
//! [#135](https://github.com/flyingrobots/colorful-language/issues/135)
//! for the delivered cross-stage comparison.

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
    let mut group = c.benchmark_group("semantic_tokens (one semanticTokens/full request)");

    group.bench_function("small (899 B, real prose)", |b| {
        b.iter(|| {
            colorful_lsp::compute_semantic_tokens(black_box(&small), &parser, &annotator)
                .expect("built-in adapters produce a valid classification")
        });
    });

    group.bench_function("medium (45 KB, repeated prose)", |b| {
        b.iter(|| {
            colorful_lsp::compute_semantic_tokens(black_box(&medium), &parser, &annotator)
                .expect("built-in adapters produce a valid classification")
        });
    });

    group.finish();
}

criterion_group!(benches, bench_semantic_tokens);
criterion_main!(benches);
