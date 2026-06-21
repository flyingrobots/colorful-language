//! The `colorful-lsp` binary: a language server that emits part-of-speech
//! semantic tokens for English prose.
//!
//! It keeps a [`Rope`] mirror of each open document, applies incremental edits,
//! and answers `textDocument/semanticTokens/full` by classifying the text. All
//! the real logic lives in the `colorful_lsp` library; this file is transport.

use colorful_lexicon::ClosedClassTagger;
use colorful_lsp::{apply_change, compute_semantic_tokens, legend_token_types};
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

/// The language server: a document store plus the parser and tagger adapters.
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
        self.documents.insert(doc.uri, Rope::from_str(&doc.text));
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        if let Some(mut rope) = self.documents.get_mut(&params.text_document.uri) {
            for change in params.content_changes {
                apply_change(rope.value_mut(), change.range, &change.text);
            }
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.documents.remove(&params.text_document.uri);
    }

    async fn semantic_tokens_full(
        &self,
        params: SemanticTokensParams,
    ) -> Result<Option<SemanticTokensResult>> {
        let Some(rope) = self.documents.get(&params.text_document.uri) else {
            return Ok(None);
        };
        let text = rope.to_string();
        let data = compute_semantic_tokens(&text, &ProseParser::new(), &ClosedClassTagger::new());
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
