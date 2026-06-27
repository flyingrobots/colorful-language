import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Colorful Language");
  context.subscriptions.push(output);

  const config = vscode.workspace.getConfiguration("colorful");
  if (!config.get<boolean>("enable", true)) {
    output.appendLine("Colorful Language is disabled by colorful.enable.");
    return;
  }

  const command = config.get<string>("serverPath", "colorful-lsp");
  output.appendLine(`Starting colorful-lsp with command: ${command}`);

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
    outputChannel: output,
    traceOutputChannel: output,
  };

  client = new LanguageClient(
    "colorful",
    "Colorful Language",
    serverOptions,
    clientOptions,
  );

  void client.start().then(
    () => {
      output.appendLine("colorful-lsp started.");
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`Failed to start colorful-lsp: ${message}`);
      void vscode.window.showErrorMessage(
        `Colorful Language could not start colorful-lsp: ${message}`,
      );
    },
  );
  context.subscriptions.push({
    dispose: () => {
      void client?.stop();
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
