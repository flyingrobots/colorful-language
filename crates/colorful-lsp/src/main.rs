//! The `colorful-lsp` binary: a language server that emits part-of-speech
//! semantic tokens for English prose.
//!
//! It keeps a [`Rope`] mirror of each open document, applies incremental edits,
//! and answers `textDocument/semanticTokens/full` by classifying the text. All
//! the real logic lives in the `colorful_lsp` library; this file is transport.

use colorful_core::LexicalAnnotator;
use colorful_lexicon::SeedOpenClassLexicon;
use colorful_lint::ProseLinter;
use colorful_lsp::{
    apply_change, compute_diagnostics, compute_semantic_tokens, legend_token_types,
};
use colorful_parse::ProseParser;
use dashmap::DashMap;
use ropey::Rope;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::{
    DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    InitializeParams, InitializeResult, InitializedParams, MessageType, SemanticTokens,
    SemanticTokensFullOptions, SemanticTokensLegend, SemanticTokensOptions, SemanticTokensParams,
    SemanticTokensResult, SemanticTokensServerCapabilities, ServerCapabilities, ServerInfo,
    TextDocumentSyncCapability, TextDocumentSyncKind, Url,
};
use tower_lsp::{Client, LanguageServer, LspService, Server};

/// The language server: a document store plus the parser and annotator adapters.
struct Backend {
    client: Client,
    documents: DashMap<Url, Rope>,
}

impl Backend {
    fn new(client: Client) -> Self {
        Self {
            client,
            documents: DashMap::new(),
        }
    }

    /// Lint `text` and publish the diagnostics for `uri`. Called after every
    /// open and change so an editor's "Problems" view tracks the document.
    async fn publish_diagnostics(&self, uri: Url, text: &str, version: Option<i32>) {
        let diagnostics = compute_diagnostics(
            text,
            &ProseParser::new(),
            &LexicalAnnotator::new(SeedOpenClassLexicon::new()),
            &ProseLinter::new(),
        );
        self.client
            .publish_diagnostics(uri, diagnostics, version)
            .await;
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
            .insert(doc.uri.clone(), Rope::from_str(&doc.text));
        self.publish_diagnostics(doc.uri, &doc.text, Some(doc.version))
            .await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        let version = params.text_document.version;
        // Apply the edits, then drop the document lock before awaiting the
        // publish so the async call never holds the DashMap guard.
        let text = {
            let Some(mut rope) = self.documents.get_mut(&uri) else {
                return;
            };
            for change in params.content_changes {
                apply_change(rope.value_mut(), change.range, &change.text);
            }
            rope.to_string()
        };
        self.publish_diagnostics(uri, &text, Some(version)).await;
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        let uri = params.text_document.uri;
        self.documents.remove(&uri);
        // Clear the document's diagnostics when it closes.
        self.client.publish_diagnostics(uri, vec![], None).await;
    }

    async fn semantic_tokens_full(
        &self,
        params: SemanticTokensParams,
    ) -> Result<Option<SemanticTokensResult>> {
        let Some(rope) = self.documents.get(&params.text_document.uri) else {
            return Ok(None);
        };
        let text = rope.to_string();
        let data = compute_semantic_tokens(
            &text,
            &ProseParser::new(),
            &LexicalAnnotator::new(SeedOpenClassLexicon::new()),
        );
        Ok(Some(SemanticTokensResult::Tokens(SemanticTokens {
            result_id: None,
            data,
        })))
    }
}

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let (service, socket) = LspService::new(Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}
