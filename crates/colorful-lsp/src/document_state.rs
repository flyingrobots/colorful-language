#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    };
    use std::time::Duration;

    use colorful_lsp::DocumentAnalysis;
    use tower_lsp::lsp_types::{
        Diagnostic, NumberOrString, SemanticToken, TextDocumentContentChangeEvent, Url,
    };

    use super::{
        AnalysisComputer, AnalysisPublisher, CompletedAnalysis, DocumentStore, MAX_DOCUMENT_BYTES,
    };

    fn analysis_for(generation: u64) -> DocumentAnalysis {
        DocumentAnalysis::new(
            vec![SemanticToken {
                delta_line: 0,
                delta_start: generation as u32,
                length: 1,
                token_type: 0,
                token_modifiers_bitset: 0,
            }],
            vec![Diagnostic {
                code: Some(NumberOrString::String(format!("generation-{generation}"))),
                ..Diagnostic::default()
            }],
        )
    }

    fn recording_publisher(log: Arc<Mutex<Vec<u64>>>) -> AnalysisPublisher {
        Arc::new(move |completed: CompletedAnalysis| {
            let log = Arc::clone(&log);
            Box::pin(async move {
                log.lock()
                    .expect("publication log lock")
                    .push(completed.generation());
            })
        })
    }

    async fn wait_until(mut condition: impl FnMut() -> bool) {
        for _ in 0..200 {
            if condition() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("condition did not become true");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn older_computation_finishing_last_cannot_publish_or_replace_cache() {
        let (old_started_tx, old_started_rx) = mpsc::channel();
        let (release_old_tx, release_old_rx) = mpsc::channel();
        let release_old_rx = Arc::new(Mutex::new(release_old_rx));
        let compute: AnalysisComputer = Arc::new(move |_text, generation| {
            if generation == 1 {
                old_started_tx.send(()).expect("signal old start");
                release_old_rx
                    .lock()
                    .expect("release lock")
                    .recv()
                    .expect("release old computation");
            }
            analysis_for(generation)
        });
        let store = DocumentStore::new(compute, Duration::ZERO, MAX_DOCUMENT_BYTES);
        let uri = Url::parse("file:///forced-stale.txt").expect("test URI");
        let publications = Arc::new(Mutex::new(Vec::new()));
        let publisher = recording_publisher(Arc::clone(&publications));

        store.open(uri.clone(), "old", 1, Arc::clone(&publisher));
        old_started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("old computation started");
        store
            .change(
                &uri,
                2,
                vec![TextDocumentContentChangeEvent {
                    range: None,
                    range_length: None,
                    text: "new".to_string(),
                }],
                Arc::clone(&publisher),
            )
            .await;

        wait_until(|| {
            publications
                .lock()
                .expect("publication log lock")
                .as_slice()
                == [2]
        })
        .await;
        assert_eq!(
            store
                .semantic_tokens(&uri)
                .await
                .expect("current semantic tokens")[0]
                .delta_start,
            2
        );

        release_old_tx.send(()).expect("release old computation");
        wait_until(|| store.metrics().stale_results == 1).await;

        assert_eq!(
            publications
                .lock()
                .expect("publication log lock")
                .as_slice(),
            [2]
        );
        assert_eq!(store.cached_generation(&uri), Some(2));
        assert_eq!(store.metrics().cancelled_before_compute, 0);
        assert_eq!(store.metrics().stale_results, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn diagnostics_and_tokens_reuse_one_generation_analysis() {
        let invocations = Arc::new(AtomicUsize::new(0));
        let compute: AnalysisComputer = {
            let invocations = Arc::clone(&invocations);
            Arc::new(move |_text, generation| {
                invocations.fetch_add(1, Ordering::SeqCst);
                analysis_for(generation)
            })
        };
        let store = DocumentStore::new(compute, Duration::ZERO, MAX_DOCUMENT_BYTES);
        let uri = Url::parse("file:///one-analysis.txt").expect("test URI");
        let publications = Arc::new(Mutex::new(Vec::new()));

        store.open(
            uri.clone(),
            "The cat is calm.",
            7,
            recording_publisher(Arc::clone(&publications)),
        );
        wait_until(|| {
            !publications
                .lock()
                .expect("publication log lock")
                .is_empty()
        })
        .await;

        let first = store
            .semantic_tokens(&uri)
            .await
            .expect("first semantic tokens");
        let second = store
            .semantic_tokens(&uri)
            .await
            .expect("second semantic tokens");
        assert_eq!(first, second);
        assert_eq!(invocations.load(Ordering::SeqCst), 1);
        assert_eq!(store.cached_generation(&uri), Some(1));
        assert_eq!(
            publications
                .lock()
                .expect("publication log lock")
                .as_slice(),
            [1]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn oversized_documents_bypass_analysis_with_stable_outputs() {
        assert_eq!(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024);

        let invocations = Arc::new(AtomicUsize::new(0));
        let compute: AnalysisComputer = {
            let invocations = Arc::clone(&invocations);
            Arc::new(move |_text, generation| {
                invocations.fetch_add(1, Ordering::SeqCst);
                analysis_for(generation)
            })
        };
        let store = DocumentStore::new(compute, Duration::ZERO, 4);
        let at_limit = Url::parse("file:///at-limit.txt").expect("test URI");
        let oversized = Url::parse("file:///oversized.txt").expect("test URI");
        let publications = Arc::new(Mutex::new(Vec::new()));
        let publisher = recording_publisher(Arc::clone(&publications));

        store.open(at_limit.clone(), "1234", 1, Arc::clone(&publisher));
        wait_until(|| invocations.load(Ordering::SeqCst) == 1).await;
        store.open(oversized.clone(), "12345", 1, Arc::clone(&publisher));
        wait_until(|| store.cached_generation(&oversized) == Some(1)).await;

        assert_eq!(invocations.load(Ordering::SeqCst), 1);
        assert_eq!(
            store
                .diagnostics(&oversized)
                .expect("oversized diagnostics")[0]
                .code,
            Some(NumberOrString::String(
                "colorful/document-too-large".to_string()
            ))
        );
        assert_eq!(store.semantic_tokens(&oversized).await, Some(Vec::new()));
        assert_eq!(store.metrics().oversized_results, 1);
    }
}
