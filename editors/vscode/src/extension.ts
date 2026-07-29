import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

const SERVER_NOT_FOUND_CATEGORY = "colorful/server-not-found";
const SERVER_START_FAILED_CATEGORY = "colorful/server-start-failed";

function startupFailureCategory(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ENOENT" || /\b(?:ENOENT|not found)\b/iu.test(message)
    ? SERVER_NOT_FOUND_CATEGORY
    : SERVER_START_FAILED_CATEGORY;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Colorful Language", {
    log: true,
  });
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
      const category = startupFailureCategory(error);
      output.appendLine(`[${category}] Failed to start colorful-lsp: ${message}`);
      void vscode.window.showErrorMessage(
        `[${category}] Colorful Language could not start colorful-lsp: ${message}`,
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
