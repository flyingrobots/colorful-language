use std::future::Future;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use colorful_lsp::{apply_change, DocumentAnalysis};
use dashmap::DashMap;
use ropey::Rope;
use serde::Serialize;
use tokio::sync::{watch, Mutex};
use tokio::time::Instant;
use tower_lsp::lsp_types::{
    Diagnostic, DiagnosticSeverity, NumberOrString, Position, Range, SemanticToken,
    TextDocumentContentChangeEvent, Url,
};

pub(crate) const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;

pub(crate) type AnalysisComputer =
    Arc<dyn Fn(String, u64) -> DocumentAnalysis + Send + Sync + 'static>;
type PublishFuture = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;
pub(crate) type AnalysisPublisher =
    Arc<dyn Fn(CompletedAnalysis) -> PublishFuture + Send + Sync + 'static>;

#[derive(Clone)]
struct CancellationHandle {
    cancelled: Arc<AtomicBool>,
}

impl CancellationHandle {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn is_same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }
}

#[derive(Clone)]
struct CachedAnalysis {
    generation: u64,
    version: i32,
    analysis: Arc<DocumentAnalysis>,
}

struct DocumentState {
    rope: Rope,
    generation: u64,
    version: i32,
    cached: Option<Arc<CachedAnalysis>>,
    cancellation: CancellationHandle,
    updates: watch::Sender<Option<Arc<CachedAnalysis>>>,
    publication_gate: Arc<Mutex<()>>,
}

struct WorkItem {
    uri: Url,
    snapshot: Rope,
    generation: u64,
    version: i32,
    scheduled_at: Instant,
    cancellation: CancellationHandle,
    publication_gate: Arc<Mutex<()>>,
}

/// A fresh analysis that is safe to publish for one document generation.
pub(crate) struct CompletedAnalysis {
    uri: Url,
    cached: Arc<CachedAnalysis>,
}

impl CompletedAnalysis {
    pub(crate) fn uri(&self) -> &Url {
        &self.uri
    }

    #[cfg(test)]
    pub(crate) fn generation(&self) -> u64 {
        self.cached.generation
    }

    pub(crate) fn version(&self) -> i32 {
        self.cached.version
    }

    pub(crate) fn diagnostics(&self) -> &[Diagnostic] {
        self.cached.analysis.diagnostics()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SemanticTokenSnapshot {
    generation: u64,
    data: Vec<SemanticToken>,
}

impl SemanticTokenSnapshot {
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    #[cfg(test)]
    pub(crate) fn data(&self) -> &[SemanticToken] {
        &self.data
    }

    pub(crate) fn into_data(self) -> Vec<SemanticToken> {
        self.data
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentMetricsSnapshot {
    schema_version: &'static str,
    analysis_limit_bytes: u64,
    active_documents: u64,
    computations_started: u64,
    accepted_results: u64,
    pub(crate) cancelled_before_compute: u64,
    pub(crate) stale_results: u64,
    pub(crate) oversized_results: u64,
    analysis_failures: u64,
    max_queue_delay_micros: u64,
}

#[derive(Default)]
struct DocumentMetrics {
    computations_started: AtomicU64,
    accepted_results: AtomicU64,
    cancelled_before_compute: AtomicU64,
    stale_results: AtomicU64,
    oversized_results: AtomicU64,
    analysis_failures: AtomicU64,
    max_queue_delay_micros: AtomicU64,
}

#[derive(Clone)]
pub(crate) struct DocumentStore {
    documents: Arc<DashMap<Url, DocumentState>>,
    compute: AnalysisComputer,
    edit_debounce: Duration,
    max_document_bytes: usize,
    metrics: Arc<DocumentMetrics>,
}

impl DocumentStore {
    pub(crate) fn new(
        compute: AnalysisComputer,
        edit_debounce: Duration,
        max_document_bytes: usize,
    ) -> Self {
        Self {
            documents: Arc::new(DashMap::new()),
            compute,
            edit_debounce,
            max_document_bytes,
            metrics: Arc::new(DocumentMetrics::default()),
        }
    }

    pub(crate) async fn open(
        &self,
        uri: Url,
        text: &str,
        version: i32,
        publisher: AnalysisPublisher,
    ) {
        let previous_gate = self
            .documents
            .get(&uri)
            .map(|state| Arc::clone(&state.publication_gate));
        let _previous_publication_guard = match previous_gate {
            Some(gate) => Some(gate.lock_owned().await),
            None => None,
        };

        let cancellation = CancellationHandle::new();
        let (updates, _) = watch::channel(None);
        let state = DocumentState {
            rope: Rope::from_str(text),
            generation: 1,
            version,
            cached: None,
            cancellation: cancellation.clone(),
            updates,
            publication_gate: Arc::new(Mutex::new(())),
        };
        let work = WorkItem {
            uri: uri.clone(),
            snapshot: state.rope.clone(),
            generation: state.generation,
            version: state.version,
            scheduled_at: Instant::now(),
            cancellation,
            publication_gate: Arc::clone(&state.publication_gate),
        };
        if let Some(previous) = self.documents.insert(uri, state) {
            previous.cancellation.cancel();
        }
        self.spawn_work(work, Duration::ZERO, publisher);
    }

    pub(crate) async fn change(
        &self,
        uri: &Url,
        version: i32,
        changes: Vec<TextDocumentContentChangeEvent>,
        publisher: AnalysisPublisher,
    ) {
        let Some(publication_gate) = self
            .documents
            .get(uri)
            .map(|state| Arc::clone(&state.publication_gate))
        else {
            return;
        };
        let _publication_guard = publication_gate.lock().await;

        let work = {
            let Some(mut state) = self.documents.get_mut(uri) else {
                return;
            };
            state.cancellation.cancel();
            for change in changes {
                apply_change(&mut state.rope, change.range, &change.text);
            }
            state.generation = state
                .generation
                .checked_add(1)
                .expect("document generation exhausted");
            state.version = version;
            state.cached = None;
            state.updates.send_replace(None);
            state.cancellation = CancellationHandle::new();

            WorkItem {
                uri: uri.clone(),
                snapshot: state.rope.clone(),
                generation: state.generation,
                version: state.version,
                scheduled_at: Instant::now(),
                cancellation: state.cancellation.clone(),
                publication_gate: Arc::clone(&state.publication_gate),
            }
        };

        self.spawn_work(work, self.edit_debounce, publisher);
    }

    pub(crate) async fn close(&self, uri: &Url) {
        let Some(publication_gate) = self
            .documents
            .get(uri)
            .map(|state| Arc::clone(&state.publication_gate))
        else {
            return;
        };
        let _publication_guard = publication_gate.lock().await;
        if let Some((_, state)) = self.documents.remove(uri) {
            state.cancellation.cancel();
        }
    }

    pub(crate) async fn semantic_tokens(&self, uri: &Url) -> Option<SemanticTokenSnapshot> {
        let mut updates = self
            .documents
            .get(uri)
            .map(|state| state.updates.subscribe())?;

        loop {
            if let Some(cached) = updates.borrow().clone() {
                return Some(SemanticTokenSnapshot {
                    generation: cached.generation,
                    data: cached.analysis.semantic_tokens().to_vec(),
                });
            }
            if updates.changed().await.is_err() {
                return None;
            }
        }
    }

    #[cfg(test)]
    fn cached_generation(&self, uri: &Url) -> Option<u64> {
        self.documents
            .get(uri)
            .and_then(|state| state.cached.as_ref().map(|cached| cached.generation))
    }

    #[cfg(test)]
    fn diagnostics(&self, uri: &Url) -> Option<Vec<Diagnostic>> {
        self.documents.get(uri).and_then(|state| {
            state
                .cached
                .as_ref()
                .map(|cached| cached.analysis.diagnostics().to_vec())
        })
    }

    pub(crate) fn metrics(&self) -> DocumentMetricsSnapshot {
        DocumentMetricsSnapshot {
            schema_version: "colorful.lsp.metrics/v1",
            analysis_limit_bytes: u64::try_from(self.max_document_bytes).unwrap_or(u64::MAX),
            active_documents: u64::try_from(self.documents.len()).unwrap_or(u64::MAX),
            computations_started: self.metrics.computations_started.load(Ordering::Acquire),
            accepted_results: self.metrics.accepted_results.load(Ordering::Acquire),
            cancelled_before_compute: self
                .metrics
                .cancelled_before_compute
                .load(Ordering::Acquire),
            stale_results: self.metrics.stale_results.load(Ordering::Acquire),
            oversized_results: self.metrics.oversized_results.load(Ordering::Acquire),
            analysis_failures: self.metrics.analysis_failures.load(Ordering::Acquire),
            max_queue_delay_micros: self.metrics.max_queue_delay_micros.load(Ordering::Acquire),
        }
    }

    fn spawn_work(&self, work: WorkItem, delay: Duration, publisher: AnalysisPublisher) {
        let store = self.clone();
        tokio::spawn(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            if work.cancellation.is_cancelled() {
                store
                    .metrics
                    .cancelled_before_compute
                    .fetch_add(1, Ordering::AcqRel);
                return;
            }

            let queue_delay = work.scheduled_at.elapsed().saturating_sub(delay);
            let queue_delay_micros = u64::try_from(queue_delay.as_micros()).unwrap_or(u64::MAX);
            store
                .metrics
                .max_queue_delay_micros
                .fetch_max(queue_delay_micros, Ordering::AcqRel);
            let oversized = work.snapshot.len_bytes() > store.max_document_bytes;
            let (analysis, accepted_result) = if oversized {
                (
                    oversized_analysis(work.snapshot.len_bytes(), store.max_document_bytes),
                    true,
                )
            } else {
                store
                    .metrics
                    .computations_started
                    .fetch_add(1, Ordering::AcqRel);
                let compute = Arc::clone(&store.compute);
                let generation = work.generation;
                let snapshot = work.snapshot;
                match tokio::task::spawn_blocking(move || compute(snapshot.to_string(), generation))
                    .await
                {
                    Ok(analysis) => (analysis, true),
                    Err(_) => {
                        store
                            .metrics
                            .analysis_failures
                            .fetch_add(1, Ordering::AcqRel);
                        (failed_analysis(), false)
                    }
                }
            };
            let analysis = Arc::new(analysis);

            let _publication_guard = work.publication_gate.lock().await;
            let Some(mut state) = store.documents.get_mut(&work.uri) else {
                store.metrics.stale_results.fetch_add(1, Ordering::AcqRel);
                return;
            };
            if state.generation != work.generation
                || state.cancellation.is_cancelled()
                || !state.cancellation.is_same(&work.cancellation)
            {
                store.metrics.stale_results.fetch_add(1, Ordering::AcqRel);
                return;
            }

            let cached = Arc::new(CachedAnalysis {
                generation: work.generation,
                version: work.version,
                analysis,
            });
            state.cached = Some(Arc::clone(&cached));
            state.updates.send_replace(Some(Arc::clone(&cached)));
            drop(state);
            if accepted_result {
                store
                    .metrics
                    .accepted_results
                    .fetch_add(1, Ordering::AcqRel);
            }

            if oversized {
                store
                    .metrics
                    .oversized_results
                    .fetch_add(1, Ordering::AcqRel);
            }
            publisher(CompletedAnalysis {
                uri: work.uri,
                cached,
            })
            .await;
        });
    }
}

fn oversized_analysis(bytes: usize, limit: usize) -> DocumentAnalysis {
    DocumentAnalysis::new(
        Vec::new(),
        vec![Diagnostic {
            range: Range::new(Position::new(0, 0), Position::new(0, 0)),
            severity: Some(DiagnosticSeverity::WARNING),
            code: Some(NumberOrString::String(
                "colorful/document-too-large".to_string(),
            )),
            source: Some("colorful".to_string()),
            message: format!("document is {bytes} bytes; the analysis limit is {limit} bytes"),
            ..Diagnostic::default()
        }],
    )
}

fn failed_analysis() -> DocumentAnalysis {
    DocumentAnalysis::new(
        Vec::new(),
        vec![Diagnostic {
            range: Range::new(Position::new(0, 0), Position::new(0, 0)),
            severity: Some(DiagnosticSeverity::ERROR),
            code: Some(NumberOrString::String(
                "colorful/analysis-failed".to_string(),
            )),
            source: Some("colorful".to_string()),
            message: "document analysis failed".to_string(),
            ..Diagnostic::default()
        }],
    )
}

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

    async fn yield_until(mut condition: impl FnMut() -> bool) {
        for _ in 0..200 {
            if condition() {
                return;
            }
            tokio::task::yield_now().await;
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

        store
            .open(uri.clone(), "old", 1, Arc::clone(&publisher))
            .await;
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
                .expect("current semantic tokens")
                .data()[0]
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

        store
            .open(
                uri.clone(),
                "The cat is calm.",
                7,
                recording_publisher(Arc::clone(&publications)),
            )
            .await;
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

    #[tokio::test(start_paused = true)]
    async fn rapid_edits_cancel_debounced_work_before_analysis() {
        let invocations = Arc::new(Mutex::new(Vec::new()));
        let compute: AnalysisComputer = {
            let invocations = Arc::clone(&invocations);
            Arc::new(move |_text, generation| {
                invocations
                    .lock()
                    .expect("invocation log lock")
                    .push(generation);
                analysis_for(generation)
            })
        };
        let store = DocumentStore::new(compute, Duration::from_secs(1), MAX_DOCUMENT_BYTES);
        let uri = Url::parse("file:///debounced.txt").expect("test URI");
        let publications = Arc::new(Mutex::new(Vec::new()));
        let publisher = recording_publisher(Arc::clone(&publications));

        store
            .open(uri.clone(), "one", 1, Arc::clone(&publisher))
            .await;
        store
            .semantic_tokens(&uri)
            .await
            .expect("initial semantic tokens");
        store
            .change(
                &uri,
                2,
                vec![TextDocumentContentChangeEvent {
                    range: None,
                    range_length: None,
                    text: "two".to_string(),
                }],
                Arc::clone(&publisher),
            )
            .await;
        store
            .change(
                &uri,
                3,
                vec![TextDocumentContentChangeEvent {
                    range: None,
                    range_length: None,
                    text: "three".to_string(),
                }],
                Arc::clone(&publisher),
            )
            .await;

        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(1)).await;
        store
            .semantic_tokens(&uri)
            .await
            .expect("latest semantic tokens");
        yield_until(|| store.metrics().cancelled_before_compute == 1).await;

        assert_eq!(
            invocations.lock().expect("invocation log lock").as_slice(),
            [1, 3]
        );
        assert_eq!(
            publications
                .lock()
                .expect("publication log lock")
                .as_slice(),
            [1, 3]
        );
        assert_eq!(store.metrics().stale_results, 0);
        assert!(
            store.metrics().max_queue_delay_micros < 10_000,
            "the intentional debounce is not scheduler queue delay"
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

        store
            .open(at_limit.clone(), "1234", 1, Arc::clone(&publisher))
            .await;
        wait_until(|| invocations.load(Ordering::SeqCst) == 1).await;
        store
            .open(oversized.clone(), "12345", 1, Arc::clone(&publisher))
            .await;
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
        assert!(store
            .semantic_tokens(&oversized)
            .await
            .expect("oversized semantic tokens")
            .data()
            .is_empty());
        assert_eq!(store.metrics().oversized_results, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn failed_analysis_is_reported_but_not_counted_as_accepted() {
        let compute: AnalysisComputer = Arc::new(move |_text, _generation| {
            panic!("deterministic analysis failure");
        });
        let store = DocumentStore::new(compute, Duration::ZERO, MAX_DOCUMENT_BYTES);
        let uri = Url::parse("file:///failed-analysis.txt").expect("test URI");
        let publications = Arc::new(Mutex::new(Vec::new()));

        store
            .open(
                uri.clone(),
                "failure",
                1,
                recording_publisher(Arc::clone(&publications)),
            )
            .await;
        wait_until(|| store.cached_generation(&uri) == Some(1)).await;

        assert_eq!(store.metrics().analysis_failures, 1);
        assert_eq!(store.metrics().accepted_results, 0);
        assert_eq!(
            store.diagnostics(&uri).expect("failure diagnostics")[0].code,
            Some(NumberOrString::String(
                "colorful/analysis-failed".to_string()
            ))
        );
        assert_eq!(
            publications
                .lock()
                .expect("publication log lock")
                .as_slice(),
            [1]
        );
    }
}
