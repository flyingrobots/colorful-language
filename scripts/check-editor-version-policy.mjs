import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { parse as parseYaml } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export const CHECK_COMMAND = "node scripts/check-editor-version-policy.mjs";

export const EXPECTED_VERSION_SOURCES = Object.freeze([
  Object.freeze({
    path: "Cargo.toml",
    type: "cargo-workspace",
    field: "workspace.package.version",
    required: true,
  }),
  Object.freeze({
    path: "Cargo.lock",
    type: "cargo-lock",
    field: "package.version",
    required: true,
  }),
  Object.freeze({
    path: "editors/vscode/package.json",
    type: "npm-package",
    field: "version",
    required: true,
  }),
  Object.freeze({
    path: "editors/vscode/package-lock.json",
    type: "npm-lock",
    field: "version-and-root.version",
    required: true,
  }),
  Object.freeze({
    path: "editors/zed/extension.toml",
    type: "zed-extension",
    field: "version",
    required: true,
  }),
  Object.freeze({
    path: "editors/zed/Cargo.toml",
    type: "cargo-package",
    field: "package.version",
    required: true,
  }),
  Object.freeze({
    path: "editors/zed/Cargo.lock",
    type: "cargo-lock-package",
    field: "package[colorful-language-zed].version",
    required: true,
  }),
]);

function parseStableSemVer(version, context) {
  const match = STABLE_SEMVER.exec(version);
  if (match === null) {
    throw new Error(`${context} must be stable SemVer; found ${version}`);
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function deriveCompatibleLspRange(adapterVersion) {
  const { major, minor } = parseStableSemVer(adapterVersion, "adapter version");
  if (major !== 0) {
    throw new Error(
      `same-pre-1.0-minor compatibility requires a pre-1.0 adapter; found ${adapterVersion}`,
    );
  }
  return `>=0.${minor}.0 <0.${minor + 1}.0`;
}

export function isCompatibleLspVersion(adapterVersion, serverVersion) {
  try {
    const adapter = parseStableSemVer(adapterVersion, "adapter version");
    const server = parseStableSemVer(serverVersion, "server version");
    return (
      adapter.major === 0 &&
      server.major === 0 &&
      adapter.minor === server.minor
    );
  } catch {
    return false;
  }
}

export function validatedNpmLockVersion(
  lockfile,
  path = "package-lock.json",
) {
  const documentVersion = lockfile.version;
  const rootVersion = lockfile.packages?.[""]?.version;
  if (typeof documentVersion !== "string") {
    throw new Error(`${path} has no top-level version`);
  }
  if (typeof rootVersion !== "string") {
    throw new Error(`${path} has no root package version`);
  }
  if (documentVersion !== rootVersion) {
    throw new Error(
      `${path} versions disagree: top-level ${documentVersion}, root ${rootVersion}`,
    );
  }
  return documentVersion;
}

function sameVersionSources(actual) {
  return isDeepStrictEqual(actual, EXPECTED_VERSION_SOURCES);
}

function gateCommandIndex(source, command) {
  return source.split(/\r?\n/u).findIndex((line) => {
    const normalized = line.trim();
    return (
      normalized === command ||
      normalized === `run: ${command}` ||
      normalized === `- run: ${command}`
    );
  });
}

function gateRunsCommand(source) {
  return gateCommandIndex(source, CHECK_COMMAND) !== -1;
}

function gateInstallsPolicyDependenciesBeforeCheck(source) {
  const installIndex = gateCommandIndex(source, "npm ci");
  const checkIndex = gateCommandIndex(source, CHECK_COMMAND);
  return installIndex !== -1 && installIndex < checkIndex;
}

export function validateEditorVersionPolicy(snapshot) {
  const { policy, versions, gateSources } = snapshot;
  if (policy.strategy !== "synchronized") {
    throw new Error(
      `editor adapter strategy must be synchronized; found ${policy.strategy}`,
    );
  }
  if (policy.server !== "colorful-lsp") {
    throw new Error(
      `editor adapter server must be colorful-lsp; found ${policy.server}`,
    );
  }
  if (policy.compatibility !== "same-pre-1.0-minor") {
    throw new Error(
      `LSP compatibility must be same-pre-1.0-minor; found ${policy.compatibility}`,
    );
  }
  if (policy.prerelease !== "unsupported") {
    throw new Error(
      `editor prerelease policy must be unsupported; found ${policy.prerelease}`,
    );
  }
  if (!sameVersionSources(policy.versionSources)) {
    throw new Error(
      "version sources differ from the reviewed synchronized inventory",
    );
  }

  for (const source of EXPECTED_VERSION_SOURCES) {
    const version = versions[source.path];
    if (typeof version !== "string") {
      throw new Error(`${source.path} has no readable version`);
    }
    parseStableSemVer(version, source.path);
  }

  const releaseVersion = versions["Cargo.toml"];
  for (const source of EXPECTED_VERSION_SOURCES) {
    const version = versions[source.path];
    if (version !== releaseVersion) {
      throw new Error(
        `${source.path} has ${version}; expected ${releaseVersion}`,
      );
    }
  }

  for (const gate of ["ci", "releasePrep", "release"]) {
    if (!gateRunsCommand(gateSources[gate] ?? "")) {
      throw new Error(`${gate} must run ${CHECK_COMMAND}`);
    }
    if (
      !gateInstallsPolicyDependenciesBeforeCheck(gateSources[gate] ?? "")
    ) {
      throw new Error(`${gate} must run npm ci before ${CHECK_COMMAND}`);
    }
  }

  return {
    releaseVersion,
    compatibleLsp: deriveCompatibleLspRange(releaseVersion),
    versionSourceCount: EXPECTED_VERSION_SOURCES.length,
  };
}

function parseTomlSectionVersion(source, section, path) {
  const lines = source.split(/\r?\n/u);
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    throw new Error(`${path} is missing ${header}`);
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("[")) {
      break;
    }
    const match = /^version\s*=\s*"([^"]+)"$/u.exec(line);
    if (match !== null) {
      return match[1];
    }
  }
  throw new Error(`${path} is missing ${section}.version`);
}

function parseTomlTopLevelVersion(source, path) {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      break;
    }
    const match = /^version\s*=\s*"([^"]+)"$/u.exec(line);
    if (match !== null) {
      return match[1];
    }
  }
  throw new Error(`${path} is missing top-level version`);
}

function parseCargoLockVersion(source, packageName, path) {
  for (const block of source.split(/(?=^\[\[package\]\]$)/gmu)) {
    const name = /^name\s*=\s*"([^"]+)"$/mu.exec(block)?.[1];
    if (name !== packageName) {
      continue;
    }
    const version = /^version\s*=\s*"([^"]+)"$/mu.exec(block)?.[1];
    if (version === undefined) {
      break;
    }
    return version;
  }
  throw new Error(`${path} is missing package ${packageName}`);
}

function isMapping(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReleaseProfile(profile) {
  let document;
  try {
    document = parseYaml(profile);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`.continuum/release.yml is not valid YAML: ${detail}`, {
      cause: error,
    });
  }
  if (!isMapping(document)) {
    throw new Error(".continuum/release.yml must contain a mapping");
  }

  const editorPolicy = document.versioning?.editor_adapters;
  if (!isMapping(editorPolicy)) {
    throw new Error(
      ".continuum/release.yml is missing versioning.editor_adapters",
    );
  }
  if (!Array.isArray(document.version_sources)) {
    throw new Error(".continuum/release.yml is missing version_sources");
  }

  return {
    strategy: editorPolicy.strategy,
    server: editorPolicy.server,
    compatibility: editorPolicy.compatibility,
    prerelease: editorPolicy.prerelease,
    versionSources: document.version_sources,
  };
}

function read(path, root) {
  return readFileSync(resolve(root, path), "utf8");
}

export function loadRepositorySnapshot(root = ROOT) {
  const profile = read(".continuum/release.yml", root);
  const vscodePackage = JSON.parse(
    read("editors/vscode/package.json", root),
  );
  const vscodeLock = JSON.parse(
    read("editors/vscode/package-lock.json", root),
  );
  const cargoLock = read("Cargo.lock", root);
  const zedCargoLock = read("editors/zed/Cargo.lock", root);

  return {
    policy: parseReleaseProfile(profile),
    versions: {
      "Cargo.toml": parseTomlSectionVersion(
        read("Cargo.toml", root),
        "workspace.package",
        "Cargo.toml",
      ),
      "Cargo.lock": parseCargoLockVersion(
        cargoLock,
        "colorful-lsp",
        "Cargo.lock",
      ),
      "editors/vscode/package.json": vscodePackage.version,
      "editors/vscode/package-lock.json": validatedNpmLockVersion(
        vscodeLock,
        "editors/vscode/package-lock.json",
      ),
      "editors/zed/extension.toml": parseTomlTopLevelVersion(
        read("editors/zed/extension.toml", root),
        "editors/zed/extension.toml",
      ),
      "editors/zed/Cargo.toml": parseTomlSectionVersion(
        read("editors/zed/Cargo.toml", root),
        "package",
        "editors/zed/Cargo.toml",
      ),
      "editors/zed/Cargo.lock": parseCargoLockVersion(
        zedCargoLock,
        "colorful-language-zed",
        "editors/zed/Cargo.lock",
      ),
    },
    gateSources: {
      ci: read(".github/workflows/ci.yml", root),
      releasePrep: read("scripts/release-prep.sh", root),
      release: read(".github/workflows/release.yml", root),
    },
  };
}

function main() {
  try {
    const result = validateEditorVersionPolicy(loadRepositorySnapshot());
    console.log(
      `check-editor-version-policy passed: ${result.versionSourceCount} source(s) at ${result.releaseVersion}; colorful-lsp ${result.compatibleLsp}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`check-editor-version-policy: ${message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
