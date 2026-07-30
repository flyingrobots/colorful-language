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
      ? value.match(/^(\d+)\.(\d+)\.(\d+)$/u)
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

export function validateVscodeHostPolicy(editorPackage, runtimePolicy) {
  const minimumVscodeVersion = runtimePolicy?.minimumVscodeVersion;
  const electronVersion = runtimePolicy?.electronVersion;
  const nodeVersion = runtimePolicy?.nodeVersion;
  const nodeTypesVersion = runtimePolicy?.nodeTypesVersion;
  const evidenceUrl = runtimePolicy?.evidenceUrl;
  const minimumVscode = parseVersion(
    minimumVscodeVersion,
    "E_VSCODE_HOST_POLICY",
    "editors/vscode/runtime-policy.json#minimumVscodeVersion",
  );
  const electron = parseVersion(
    electronVersion,
    "E_VSCODE_HOST_POLICY",
    "editors/vscode/runtime-policy.json#electronVersion",
  );
  const node = parseVersion(
    nodeVersion,
    "E_VSCODE_HOST_POLICY",
    "editors/vscode/runtime-policy.json#nodeVersion",
  );
  const nodeTypes = parseVersion(
    nodeTypesVersion,
    "E_VSCODE_HOST_POLICY",
    "editors/vscode/runtime-policy.json#nodeTypesVersion",
  );
  const extensionFloor = declaredFloor(
    editorPackage.engines?.vscode,
    "E_VSCODE_HOST_POLICY",
    "editors/vscode/package.json#engines.vscode",
  );
  if (compareVersions(extensionFloor, minimumVscode) !== 0) {
    fail(
      "E_VSCODE_HOST_POLICY",
      "editors/vscode/package.json#engines.vscode must match editors/vscode/runtime-policy.json#minimumVscodeVersion",
    );
  }

  const expectedEvidenceUrl = `https://releases.electronjs.org/release/v${electronVersion}`;
  if (evidenceUrl !== expectedEvidenceUrl) {
    fail(
      "E_VSCODE_HOST_POLICY",
      `editors/vscode/runtime-policy.json#evidenceUrl must be ${expectedEvidenceUrl}; found ${String(evidenceUrl)}`,
    );
  }

  return {
    electronVersion: electron.join("."),
    evidenceUrl,
    minimumVscodeVersion: minimumVscode.join("."),
    nodeTypesVersion: nodeTypes.join("."),
    nodeVersion: node.join("."),
  };
}

function validateNodeDeclarations(editorPackage, lockfile, lockRoot, host) {
  const declaredNodeTypes = editorPackage.devDependencies?.["@types/node"];
  const expectedNodeTypes = host.nodeTypesVersion;
  if (declaredNodeTypes !== expectedNodeTypes) {
    fail(
      "E_VSCODE_NODE_TYPES",
      `editors/vscode/package.json#devDependencies["@types/node"] must be ${expectedNodeTypes} for Node ${host.nodeVersion}; found ${String(declaredNodeTypes)}`,
    );
  }
  if (lockRoot.devDependencies?.["@types/node"] !== declaredNodeTypes) {
    fail(
      "E_VSCODE_NODE_TYPES",
      `editors/vscode/package-lock.json#packages[""].devDependencies["@types/node"] must repeat ${declaredNodeTypes}`,
    );
  }

  const lockedNodeTypes = requirePackage(
    lockfile,
    "node_modules/@types/node",
    "E_VSCODE_NODE_TYPES",
  );
  const lockedNodeVersion = parseVersion(
    lockedNodeTypes.version,
    "E_VSCODE_NODE_TYPES",
    'editors/vscode/package-lock.json#packages["node_modules/@types/node"].version',
  );
  if (
    compareVersions(
      lockedNodeVersion,
      parseVersion(
        host.nodeTypesVersion,
        "E_VSCODE_NODE_TYPES",
        "editors/vscode/runtime-policy.json#nodeTypesVersion",
      ),
    ) !== 0
  ) {
    fail(
      "E_VSCODE_NODE_TYPES",
      `editors/vscode/package-lock.json#packages["node_modules/@types/node"].version must equal the reviewed declaration release ${host.nodeTypesVersion}; found ${String(lockedNodeTypes.version)}`,
    );
  }
}

function validateDependabotPolicy(dependabotPolicy) {
  const updates = dependabotPolicy?.updates;
  if (!Array.isArray(updates)) {
    fail(
      "E_VSCODE_DEPENDABOT_POLICY",
      ".github/dependabot.yml#updates must be an array",
    );
  }
  const editorUpdate = updates.find(
    (update) =>
      update?.["package-ecosystem"] === "npm" &&
      update.directory === "/editors/vscode",
  );
  const ignore = editorUpdate?.ignore;
  if (!Array.isArray(ignore)) {
    fail(
      "E_VSCODE_DEPENDABOT_POLICY",
      ".github/dependabot.yml must define an ignore array for /editors/vscode",
    );
  }
  const nodeTypesIgnore = ignore.find(
    (entry) => entry?.["dependency-name"] === "@types/node",
  );
  if (
    nodeTypesIgnore === undefined ||
    Object.hasOwn(nodeTypesIgnore, "update-types")
  ) {
    fail(
      "E_VSCODE_DEPENDABOT_POLICY",
      ".github/dependabot.yml must ignore every @types/node update under /editors/vscode",
    );
  }
}

function validateTypeScriptPolicy(tsconfig) {
  if (tsconfig?.compilerOptions?.strict !== true) {
    fail(
      "E_VSCODE_TYPESCRIPT_POLICY",
      "editors/vscode/tsconfig.json#compilerOptions.strict must remain true",
    );
  }
  if (tsconfig?.compilerOptions?.skipLibCheck !== false) {
    fail(
      "E_VSCODE_TYPESCRIPT_POLICY",
      "editors/vscode/tsconfig.json#compilerOptions.skipLibCheck must remain false",
    );
  }
}

function validateRuntimeDocumentation(documentation, host) {
  const requirements = [
    `VS Code ${host.minimumVscodeVersion}`,
    `Electron ${host.electronVersion}`,
    `Node ${host.nodeVersion}`,
    `\`@types/node\` ${host.nodeTypesVersion}`,
    host.evidenceUrl,
  ];
  for (const [path, contents] of [
    ["docs/topics/editor-integrations/README.md", documentation?.topic],
    ["editors/vscode/README.md", documentation?.adapter],
  ]) {
    for (const requirement of requirements) {
      if (typeof contents !== "string" || !contents.includes(requirement)) {
        fail("E_VSCODE_RUNTIME_DOCS", `${path} must record ${requirement}`);
      }
    }
  }
}

export function validateVscodeDependencyPolicy(
  editorPackage,
  lockfile,
  {
    dependabotPolicy,
    documentation,
    runtimePolicy,
    tsconfig,
  } = {},
) {
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

  const host = validateVscodeHostPolicy(editorPackage, runtimePolicy);
  validateNodeDeclarations(editorPackage, lockfile, lockRoot, host);
  validateDependabotPolicy(dependabotPolicy);
  validateTypeScriptPolicy(tsconfig);
  validateRuntimeDocumentation(documentation, host);

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

function readText(path) {
  return readFileSync(path, "utf8");
}

async function main() {
  const { parse: parseYaml } = await import("yaml");
  validateVscodeDependencyPolicy(
    readJson(new URL("../editors/vscode/package.json", import.meta.url)),
    readJson(new URL("../editors/vscode/package-lock.json", import.meta.url)),
    {
      dependabotPolicy: parseYaml(
        readText(new URL("../.github/dependabot.yml", import.meta.url)),
      ),
      documentation: {
        adapter: readText(
          new URL("../editors/vscode/README.md", import.meta.url),
        ),
        topic: readText(
          new URL(
            "../docs/topics/editor-integrations/README.md",
            import.meta.url,
          ),
        ),
      },
      runtimePolicy: readJson(
        new URL("../editors/vscode/runtime-policy.json", import.meta.url),
      ),
      tsconfig: readJson(
        new URL("../editors/vscode/tsconfig.json", import.meta.url),
      ),
    },
  );
  process.stdout.write("check-vscode-dependency-policy: policy satisfied\n");
}

if (process.argv[1] === scriptPath) {
  try {
    await main();
  } catch (error) {
    if (error instanceof VscodeDependencyPolicyError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`E_VSCODE_POLICY_IO: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
