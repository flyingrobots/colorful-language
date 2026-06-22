import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("colorful");
  if (!config.get<boolean>("enable", true)) {
    return;
  }

  const command = config.get<string>("serverPath", "colorful-lsp");

  // colorful-lsp speaks LSP over stdio; the same binary serves both modes.
  const serverOptions: ServerOptions = {
    run: { command, transport: TransportKind.stdio },
    debug: { command, transport: TransportKind.stdio },
  };

  // Prose: attach to plain text and Markdown buffers.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "plaintext" },
      { scheme: "file", language: "markdown" },
      { scheme: "untitled", language: "plaintext" },
      { scheme: "untitled", language: "markdown" },
    ],
  };

  client = new LanguageClient(
    "colorful",
    "Colorful Language",
    serverOptions,
    clientOptions,
  );

  client.start();
  context.subscriptions.push({
    dispose: () => {
      void client?.stop();
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
