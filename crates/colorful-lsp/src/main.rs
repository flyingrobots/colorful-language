//! The `colorful-lsp` binary: a language server that emits part-of-speech
//! semantic tokens for English prose.
//!
//! It keeps a [`Rope`](ropey::Rope) mirror of each open document, applies
//! incremental edits, and processes each accepted generation. Snapshots within
//! the size limit receive one whole-document analysis; oversized snapshots
//! bypass parsing, classification, and linting. Both outcomes publish diagnostics
//! and answer `textDocument/semanticTokens/full` from the generation's cache.
//! The `colorful_lsp` library owns pure analysis and projection; this binary owns
//! transport and document-state coordination.

#![forbid(unsafe_code)]

use std::sync::Arc;
use std::time::Duration;

use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
use colorful_lint::ProseLinter;
use colorful_lsp::{
    analyze_document_for_format, legend_token_types, DocumentAnalysis, DocumentFormat,
};
use colorful_parse::ProseParser;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::{
    DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    InitializeParams, InitializeResult, InitializedParams, MessageType, SemanticTokens,
    SemanticTokensFullOptions, SemanticTokensLegend, SemanticTokensOptions, SemanticTokensParams,
    SemanticTokensResult, SemanticTokensServerCapabilities, ServerCapabilities, ServerInfo,
    TextDocumentSyncCapability, TextDocumentSyncKind,
};
use tower_lsp::{Client, LanguageServer, LspService, Server};

mod document_state;

use document_state::{
    AnalysisComputer, AnalysisPublisher, CompletedAnalysis, DocumentMetricsSnapshot, DocumentStore,
    MAX_DOCUMENT_BYTES,
};

/// The language server: a document store plus the parser and annotator adapters.
struct Backend {
    client: Client,
    documents: DocumentStore,
}

impl Backend {
    fn new(client: Client) -> Self {
        let compute: AnalysisComputer = Arc::new(|text, format, _generation| {
            analyze_document_for_format(
                &text,
                format,
                &ProseParser::new(),
                &default_annotator(),
                &ProseLinter::new(),
            )
            .unwrap_or_else(|error| DocumentAnalysis::invalid_classification(&error))
        });
        Self {
            client,
            documents: DocumentStore::new(compute, Duration::from_millis(50), MAX_DOCUMENT_BYTES),
        }
    }

    fn analysis_publisher(&self) -> AnalysisPublisher {
        let client = self.client.clone();
        Arc::new(move |completed: CompletedAnalysis| {
            let client = client.clone();
            Box::pin(async move {
                client
                    .publish_diagnostics(
                        completed.uri().clone(),
                        completed.diagnostics().to_vec(),
                        Some(completed.version()),
                    )
                    .await;
            })
        })
    }

    async fn metrics(&self, _: Option<()>) -> Result<DocumentMetricsSnapshot> {
        Ok(self.documents.metrics())
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::INCREMENTAL,
                )),
                semantic_tokens_provider: Some(
                    SemanticTokensServerCapabilities::SemanticTokensOptions(
                        SemanticTokensOptions {
                            legend: SemanticTokensLegend {
                                token_types: legend_token_types(),
                                token_modifiers: vec![],
                            },
                            full: Some(SemanticTokensFullOptions::Bool(true)),
                            range: Some(false),
                            work_done_progress_options: Default::default(),
                        },
                    ),
                ),
                ..ServerCapabilities::default()
            },
            server_info: Some(ServerInfo {
                name: "colorful-lsp".to_string(),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
            }),
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, "colorful-lsp ready")
            .await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let doc = params.text_document;
        self.documents
            .open(
                doc.uri,
                &doc.text,
                doc.version,
                DocumentFormat::from_language_id(&doc.language_id),
                self.analysis_publisher(),
            )
            .await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        let version = params.text_document.version;
        self.documents
            .change(
                &uri,
                version,
                params.content_changes,
                self.analysis_publisher(),
            )
            .await;
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        let uri = params.text_document.uri;
        self.documents.close(&uri).await;
        // Clear the document's diagnostics when it closes.
        self.client.publish_diagnostics(uri, vec![], None).await;
    }

    async fn semantic_tokens_full(
        &self,
        params: SemanticTokensParams,
    ) -> Result<Option<SemanticTokensResult>> {
        let Some(snapshot) = self
            .documents
            .semantic_tokens(&params.text_document.uri)
            .await
        else {
            return Ok(None);
        };
        Ok(Some(SemanticTokensResult::Tokens(SemanticTokens {
            result_id: Some(snapshot.generation().to_string()),
            data: snapshot.into_data(),
        })))
    }
}

fn default_annotator() -> ContextualOpenClassAnnotator<SeedOpenClassLexicon> {
    ContextualOpenClassAnnotator::default()
}

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let (service, socket) = LspService::build(Backend::new)
        .custom_method("colorful/metrics", Backend::metrics)
        .finish();
    Server::new(stdin, stdout, socket).serve(service).await;
}
