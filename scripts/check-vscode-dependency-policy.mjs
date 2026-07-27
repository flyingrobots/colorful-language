#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const MINIMUM_CLIENT_VERSION = "10.1.0";
const LAST_VULNERABLE_BRACE_EXPANSION = "5.0.7";

export class VscodeDependencyPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VscodeDependencyPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new VscodeDependencyPolicyError(code, message);
}

function parseVersion(value, code, subject) {
  const match =
    typeof value === "string"
      ? value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u)
      : null;
  if (match === null) {
    fail(code, `${subject} must be an X.Y.Z version; found ${String(value)}`);
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function declaredFloor(value, code, subject) {
  const match =
    typeof value === "string"
      ? value.match(/^(?:\^|~)?(\d+\.\d+\.\d+)$/u)
      : null;
  if (match === null) {
    fail(
      code,
      `${subject} must declare one exact, caret, or tilde X.Y.Z range; found ${String(value)}`,
    );
  }
  return parseVersion(match[1], code, subject);
}

function requirePackage(lockfile, path, code) {
  const entry = lockfile.packages?.[path];
  if (entry === undefined) {
    fail(code, `${path} is missing from editors/vscode/package-lock.json`);
  }
  return entry;
}

export function validateVscodeDependencyPolicy(editorPackage, lockfile) {
  const declaredClient = editorPackage.dependencies?.["vscode-languageclient"];
  const clientFloor = declaredFloor(
    declaredClient,
    "E_VSCODE_CLIENT_RANGE",
    "vscode-languageclient",
  );
  if (
    compareVersions(
      clientFloor,
      parseVersion(
        MINIMUM_CLIENT_VERSION,
        "E_VSCODE_CLIENT_RANGE",
        "minimum client",
      ),
    ) < 0
  ) {
    fail(
      "E_VSCODE_CLIENT_RANGE",
      `vscode-languageclient must be at least ${MINIMUM_CLIENT_VERSION}; found ${declaredClient}`,
    );
  }

  const lockRoot = requirePackage(lockfile, "", "E_VSCODE_LOCK_SHAPE");
  if (lockRoot.dependencies?.["vscode-languageclient"] !== declaredClient) {
    fail(
      "E_VSCODE_LOCK_DEPENDENCY",
      "package-lock.json must repeat the manifest's vscode-languageclient range",
    );
  }

  const lockedClient = requirePackage(
    lockfile,
    "node_modules/vscode-languageclient",
    "E_VSCODE_CLIENT_LOCK",
  );
  if (
    compareVersions(
      parseVersion(
        lockedClient.version,
        "E_VSCODE_CLIENT_LOCK",
        "locked vscode-languageclient",
      ),
      parseVersion(
        MINIMUM_CLIENT_VERSION,
        "E_VSCODE_CLIENT_LOCK",
        "minimum client",
      ),
    ) < 0
  ) {
    fail(
      "E_VSCODE_CLIENT_LOCK",
      `locked vscode-languageclient must be at least ${MINIMUM_CLIENT_VERSION}; found ${String(lockedClient.version)}`,
    );
  }

  const extensionEngine = declaredFloor(
    editorPackage.engines?.vscode,
    "E_VSCODE_ENGINE",
    "extension VS Code engine",
  );
  const clientEngine = declaredFloor(
    lockedClient.engines?.vscode,
    "E_VSCODE_ENGINE",
    "vscode-languageclient VS Code engine",
  );
  if (compareVersions(extensionEngine, clientEngine) < 0) {
    fail(
      "E_VSCODE_ENGINE",
      "the extension VS Code floor must satisfy the locked language client's floor",
    );
  }

  const lastVulnerable = parseVersion(
    LAST_VULNERABLE_BRACE_EXPANSION,
    "E_BRACE_EXPANSION",
    "last vulnerable brace-expansion",
  );
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (
      path.endsWith("node_modules/brace-expansion") &&
      compareVersions(
        parseVersion(
          entry.version,
          "E_BRACE_EXPANSION",
          `locked ${path}`,
        ),
        lastVulnerable,
      ) <= 0
    ) {
      fail(
        "E_BRACE_EXPANSION",
        `${path} ${String(entry.version)} is within GHSA-mh99-v99m-4gvg's vulnerable <=${LAST_VULNERABLE_BRACE_EXPANSION} range`,
      );
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  validateVscodeDependencyPolicy(
    readJson(new URL("../editors/vscode/package.json", import.meta.url)),
    readJson(new URL("../editors/vscode/package-lock.json", import.meta.url)),
  );
  process.stdout.write("check-vscode-dependency-policy: policy satisfied\n");
}

if (process.argv[1] === scriptPath) {
  try {
    main();
  } catch (error) {
    if (error instanceof VscodeDependencyPolicyError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`E_VSCODE_POLICY_IO: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
