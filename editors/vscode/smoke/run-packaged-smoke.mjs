#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vscodeTest from "@vscode/test-electron";

import { readTextFile, textFiles } from "./log-files.mjs";
import { createInstallationTimingWitness } from "./timing-witness.mjs";
import {
  stageZedExtension,
  validateZedSourcePackage,
} from "../../../scripts/stage-zed-extension.mjs";
import {
  validateVscodeHostPolicy,
} from "../../../scripts/check-vscode-dependency-policy.mjs";

const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} = vscodeTest;

const EXTENSION_ID = "flyingrobots.colorful-language";
const SERVER_NOT_FOUND_CATEGORY = "colorful/server-not-found";
const scriptPath = fileURLToPath(import.meta.url);
const vscodeRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(vscodeRoot, "../..");
const packageJson = JSON.parse(
  readFileSync(path.join(vscodeRoot, "package.json"), "utf8"),
);
const runtimePolicy = JSON.parse(
  readFileSync(path.join(vscodeRoot, "runtime-policy.json"), "utf8"),
);
const { minimumVscodeVersion: VSCODE_VERSION } = validateVscodeHostPolicy(
  packageJson,
  runtimePolicy,
);
const artifactRoot = path.join(repositoryRoot, "target/editor-smoke");
const cachePath = path.join(vscodeRoot, ".vscode-test");
const smokeWorkspace = path.join(repositoryRoot, "editors/fixtures");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function digestFile(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function digestTree(directory, files) {
  const hash = createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(readFileSync(path.join(directory, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function assertMissingServerLog(userDataDirectory) {
  const matches = [];
  for (const filename of textFiles(userDataDirectory)) {
    const text = readTextFile(filename);
    if (text?.includes(`[${SERVER_NOT_FOUND_CATEGORY}]`)) {
      matches.push(filename);
    }
  }
  assert.ok(
    matches.length > 0,
    `no persisted VS Code log contained [${SERVER_NOT_FOUND_CATEGORY}] under ${userDataDirectory}`,
  );
  return matches.map((filename) =>
    path.relative(repositoryRoot, filename).split(path.sep).join("/"),
  );
}

function installVsix(vscodeExecutablePath, vsixPath, extensionsDirectory) {
  const installData = path.join(artifactRoot, "profiles/install");
  mkdirSync(installData, { recursive: true });
  mkdirSync(extensionsDirectory, { recursive: true });
  const [cli, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(
    vscodeExecutablePath,
    { reuseMachineInstall: true },
  );
  const profileArgs = [
    ...baseArgs,
    `--extensions-dir=${extensionsDirectory}`,
    `--user-data-dir=${installData}`,
  ];
  run(cli, [...profileArgs, "--install-extension", vsixPath, "--force"]);
  const listed = run(cli, [...profileArgs, "--list-extensions", "--show-versions"], {
    capture: true,
  });
  assert.ok(
    listed.stdout
      .split(/\r?\n/u)
      .includes(`${EXTENSION_ID}@${packageJson.version}`),
    `isolated VS Code profile did not list ${EXTENSION_ID}@${packageJson.version}: ${listed.stdout}`,
  );
}

async function runExtensionHost(
  vscodeExecutablePath,
  mode,
  userDataDirectory,
  extensionsDirectory,
  colorfulLsp,
  timing,
) {
  mkdirSync(userDataDirectory, { recursive: true });
  const status = await runTests({
    vscodeExecutablePath,
    reuseMachineInstall: true,
    extensionDevelopmentPath: path.join(vscodeRoot, "smoke/harness"),
    extensionTestsPath: path.join(vscodeRoot, "smoke/suite/index.cjs"),
    launchArgs: [
      smokeWorkspace,
      `--extensions-dir=${extensionsDirectory}`,
      `--user-data-dir=${userDataDirectory}`,
    ],
    extensionTestsEnv: {
      COLORFUL_EXPECTED_VERSION: packageJson.version,
      COLORFUL_EXTENSIONS_DIR: extensionsDirectory,
      COLORFUL_LSP_BIN: colorfulLsp,
      COLORFUL_MISSING_SERVER: path.join(
        artifactRoot,
        "does-not-exist",
        "colorful-lsp",
      ),
      COLORFUL_SMOKE_MODE: mode,
      COLORFUL_SMOKE_WORKSPACE: smokeWorkspace,
      COLORFUL_USER_DATA_DIR: userDataDirectory,
      ...(timing
        ? {
            COLORFUL_INSTALL_STARTED_AT_UNIX_MS: String(
              timing.installationStartedAtUnixMs,
            ),
            COLORFUL_TIMING_PATH: timing.path,
          }
        : {}),
    },
  });
  assert.equal(status, 0, `${mode} Extension Host exited nonzero`);
}

async function main() {
  rmSync(artifactRoot, { recursive: true, force: true });
  mkdirSync(artifactRoot, { recursive: true });

  run("cargo", ["build", "--release", "--locked", "-p", "colorful-lsp"]);
  const colorfulLsp = path.join(
    repositoryRoot,
    "target/release",
    process.platform === "win32" ? "colorful-lsp.exe" : "colorful-lsp",
  );
  assert.ok(statSync(colorfulLsp).isFile(), `missing LSP binary: ${colorfulLsp}`);

  const vsixPath = path.join(
    artifactRoot,
    `colorful-language-${packageJson.version}.vsix`,
  );
  run(
    "npm",
    ["run", "package:vsix", "--", "--out", vsixPath],
    { cwd: vscodeRoot },
  );
  assert.ok(statSync(vsixPath).size > 0, "VSIX must not be empty");

  const zedPackageRoot = path.join(artifactRoot, "zed-source");
  stageZedExtension(repositoryRoot, zedPackageRoot);
  run("cargo", [
    "build",
    "--manifest-path",
    path.join(zedPackageRoot, "Cargo.toml"),
    "--target",
    "wasm32-wasip1",
    "--locked",
    "--target-dir",
    path.join(artifactRoot, "zed-target"),
  ]);
  const zedWasm = path.join(
    artifactRoot,
    "zed-target/wasm32-wasip1/debug/colorful_language_zed.wasm",
  );
  assert.ok(statSync(zedWasm).size > 0, "staged Zed package must build Wasm");

  const vscodeExecutablePath = await downloadAndUnzipVSCode({
    version: VSCODE_VERSION,
    cachePath,
  });
  const extensionsDirectory = path.join(artifactRoot, "extensions");
  const installationStartedAtUnixMs = Date.now();
  installVsix(vscodeExecutablePath, vsixPath, extensionsDirectory);

  const timingPath = path.join(
    artifactRoot,
    "install-to-first-highlight.json",
  );
  await runExtensionHost(
    vscodeExecutablePath,
    "success",
    path.join(artifactRoot, "profiles/success"),
    extensionsDirectory,
    colorfulLsp,
    { installationStartedAtUnixMs, path: timingPath },
  );
  const timingMarker = JSON.parse(readFileSync(timingPath, "utf8"));
  assert.equal(
    timingMarker.installationStartedAtUnixMs,
    installationStartedAtUnixMs,
    "Extension Host timing marker must preserve the parent start event",
  );
  assert.equal(
    timingMarker.endEvent,
    "first-plaintext-diagnostic-and-semantic-tokens",
  );
  const cpuInventory = cpus();
  const installationToFirstHighlight = createInstallationTimingWitness({
    installationStartedAtUnixMs,
    firstHighlightAtUnixMs: timingMarker.firstHighlightAtUnixMs,
    environment: {
      architecture: arch(),
      cpu: cpuInventory[0]?.model ?? "unknown",
      extension: `${EXTENSION_ID}@${packageJson.version}`,
      logicalCpuCount: cpuInventory.length,
      memoryBytes: totalmem(),
      node: process.version,
      operatingSystem: `${platform()} ${release()}`,
      rustc: run("rustc", ["--version"], { capture: true }).stdout.trim(),
      server: `colorful-lsp@${packageJson.version}`,
      vscode: VSCODE_VERSION,
    },
  });
  const missingProfile = path.join(artifactRoot, "profiles/missing-server");
  await runExtensionHost(
    vscodeExecutablePath,
    "missing-server",
    missingProfile,
    extensionsDirectory,
    colorfulLsp,
  );
  const missingServerLogs = assertMissingServerLog(missingProfile);

  const zedPackage = validateZedSourcePackage(
    repositoryRoot,
    zedPackageRoot,
  );
  const witness = {
    schemaVersion: "colorful.editor-package-smoke/v1",
    vscode: {
      version: VSCODE_VERSION,
      extension: `${EXTENSION_ID}@${packageJson.version}`,
      publicationTargets: ["visual-studio-marketplace", "open-vsx"],
      artifact: path.relative(repositoryRoot, vsixPath),
      sha256: digestFile(vsixPath),
      missingServerCategory: SERVER_NOT_FOUND_CATEGORY,
      missingServerLogs,
      installationToFirstHighlight,
    },
    zed: {
      ...zedPackage,
      sourceSha256: digestTree(zedPackageRoot, zedPackage.files),
      wasm: path.relative(repositoryRoot, zedWasm),
      wasmSha256: digestFile(zedWasm),
    },
  };
  const witnessPath = path.join(artifactRoot, "witness.json");
  writeFileSync(witnessPath, `${JSON.stringify(witness, null, 2)}\n`);
  process.stdout.write(
    `editor package smoke passed: ${path.relative(repositoryRoot, witnessPath)}\n`,
  );
}

if (
  process.platform === "linux" &&
  !process.env.DISPLAY &&
  process.env.COLORFUL_XVFB_CHILD !== "1"
) {
  const result = spawnSync(
    "xvfb-run",
    ["-a", process.execPath, scriptPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, COLORFUL_XVFB_CHILD: "1" },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} else {
  await main();
}
