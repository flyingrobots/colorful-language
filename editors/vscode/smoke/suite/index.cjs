const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const vscode = require("vscode");

const EXTENSION_ID = "flyingrobots.colorful-language";
const EXPECTED_FALLBACK_SCOPES = [
  {
    language: "plaintext",
    scopes: {
      noun: ["variable.other.colorful.noun"],
      verb: ["entity.name.function.colorful.verb"],
      adjective: ["variable.other.property.colorful.adjective"],
      adverb: ["keyword.other.colorful.adverb"],
    },
  },
  {
    language: "markdown",
    scopes: {
      noun: ["variable.other.colorful.noun"],
      verb: ["entity.name.function.colorful.verb"],
      adjective: ["variable.other.property.colorful.adjective"],
      adverb: ["keyword.other.colorful.adverb"],
    },
  },
];

async function waitFor(description, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const suffix = lastError ? `: ${String(lastError)}` : "";
  throw new Error(`timed out waiting for ${description}${suffix}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  assert.ok(value, `missing required smoke environment variable ${name}`);
  return value;
}

function treeContains(directory, needle) {
  if (!fs.existsSync(directory)) {
    return false;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (treeContains(absolute, needle)) {
        return true;
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".log") &&
      fs.statSync(absolute).size <= 5 * 1024 * 1024 &&
      fs.readFileSync(absolute, "utf8").includes(needle)
    ) {
      return true;
    }
  }
  return false;
}

function assertInstalledPackage(extension) {
  assert.equal(extension.packageJSON.publisher, "flyingrobots");
  assert.equal(extension.packageJSON.name, "colorful-language");
  assert.equal(
    extension.packageJSON.version,
    requiredEnv("COLORFUL_EXPECTED_VERSION"),
  );
  assert.deepEqual(extension.packageJSON.activationEvents, [
    "onLanguage:plaintext",
    "onLanguage:markdown",
  ]);
  assert.deepEqual(
    extension.packageJSON.contributes.semanticTokenScopes,
    EXPECTED_FALLBACK_SCOPES,
  );

  const extensionsDirectory = path.resolve(requiredEnv("COLORFUL_EXTENSIONS_DIR"));
  const relative = path.relative(extensionsDirectory, extension.extensionPath);
  assert.ok(
    !path.isAbsolute(relative) &&
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`),
    `extension was not loaded from the isolated install: ${extension.extensionPath}`,
  );
}

async function configureServer(command) {
  await vscode.workspace
    .getConfiguration("colorful")
    .update("serverPath", command, vscode.ConfigurationTarget.Global);
}

async function openFixture(filename, languageId) {
  const uri = vscode.Uri.file(
    path.join(requiredEnv("COLORFUL_SMOKE_WORKSPACE"), filename),
  );
  const document = await vscode.workspace.openTextDocument(uri);
  assert.equal(document.languageId, languageId);
  await vscode.window.showTextDocument(document);
  return document;
}

function assertWeakWordDiagnostic(diagnostics) {
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.equal(diagnostic.code, "weak-word");
  assert.equal(diagnostic.message, "weak word 'really'");
  assert.equal(diagnostic.source, "colorful");
  assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Information);
  assert.deepEqual(diagnostic.range.start, new vscode.Position(0, 11));
  assert.deepEqual(diagnostic.range.end, new vscode.Position(0, 17));
}

async function assertSemanticTokens(document) {
  // These commands are internal to the pinned VS Code 1.91 smoke host. They
  // cross the real provider boundary without adding a test API to the adapter.
  const legend = await vscode.commands.executeCommand(
    "_provideDocumentSemanticTokensLegend",
    document.uri,
  );
  assert.ok(
    legend &&
      Array.isArray(legend.tokenTypes) &&
      legend.tokenTypes.includes("noun"),
    "installed adapter returned no Colorful semantic-token legend",
  );
  const encoded = await vscode.commands.executeCommand(
    "_provideDocumentSemanticTokens",
    document.uri,
  );
  assert.ok(
    encoded &&
      ArrayBuffer.isView(encoded.buffer) &&
      encoded.byteLength > 0 &&
      encoded.byteLength % 5 === 0,
    "installed adapter returned no encoded semantic tokens",
  );
}

async function exerciseDocument(filename, languageId) {
  const document = await openFixture(filename, languageId);
  const diagnostics = await waitFor(`${languageId} diagnostics`, () => {
    const current = vscode.languages.getDiagnostics(document.uri);
    return current.length > 0 ? current : undefined;
  });
  assertWeakWordDiagnostic(diagnostics);
  await assertSemanticTokens(document);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(new vscode.Position(0, 11), new vscode.Position(0, 17)),
    "plain",
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await waitFor(`${languageId} changed diagnostics`, () => {
    const current = vscode.languages.getDiagnostics(document.uri);
    return current.length === 0;
  });
  await assertSemanticTokens(document);
}

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `installed extension ${EXTENSION_ID} was not discovered`);
  assertInstalledPackage(extension);

  const mode = requiredEnv("COLORFUL_SMOKE_MODE");
  if (mode === "success") {
    await configureServer(requiredEnv("COLORFUL_LSP_BIN"));
    await exerciseDocument("editor-smoke.txt", "plaintext");
    await exerciseDocument("editor-smoke.md", "markdown");
    await waitFor("installed extension activation", () => extension.isActive);
    return;
  }

  if (mode === "missing-server") {
    const missingServer = requiredEnv("COLORFUL_MISSING_SERVER");
    assert.ok(missingServer.includes("does-not-exist"));
    await configureServer(missingServer);
    await openFixture("editor-smoke.txt", "plaintext");
    await waitFor("installed extension activation", () => extension.isActive);
    await waitFor("persisted missing-server category", () =>
      treeContains(
        requiredEnv("COLORFUL_USER_DATA_DIR"),
        "[colorful/server-not-found]",
      ),
    );
    return;
  }

  throw new Error(
    `unknown COLORFUL_SMOKE_MODE ${JSON.stringify(mode)}; expected success or missing-server`,
  );
}

module.exports = { run };
