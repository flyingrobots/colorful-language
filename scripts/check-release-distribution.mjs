#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { parse as parseYaml } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FULL_ACTION_SHA = /^[^@\s]+@[0-9a-f]{40}$/u;

export const CHECK_COMMAND = "node scripts/check-release-distribution.mjs";
export const EXPECTED_OWNER = "@flyingrobots";
export const EXPECTED_PROVENANCE = "github-sigstore";
export const EXPECTED_PLATFORMS = Object.freeze([
  Object.freeze({
    runner: "ubuntu-24.04",
    target: "x86_64-unknown-linux-gnu",
    executable_suffix: "",
  }),
  Object.freeze({
    runner: "macos-14",
    target: "aarch64-apple-darwin",
    executable_suffix: "",
  }),
  Object.freeze({
    runner: "windows-2025",
    target: "x86_64-pc-windows-msvc",
    executable_suffix: ".exe",
  }),
]);
export const EXPECTED_EDITOR_POLICY = Object.freeze({
  vscode: Object.freeze({
    artifact: "target/editor-smoke/colorful-language-{version}.vsix",
    registries: Object.freeze([
      "visual-studio-marketplace",
      "open-vsx",
    ]),
    credential_secrets: Object.freeze(["VSCE_PAT", "OVSX_PAT"]),
    duplicate_policy: "skip-existing-version",
  }),
  zed: Object.freeze({
    source_path: "editors/zed",
    registry: "zed-industries/extensions",
    publication: "pull-request",
  }),
});
export const EXPECTED_PUBLISHER_TOOLS = Object.freeze({
  "@vscode/vsce": "3.9.2",
  ovsx: "1.0.2",
});

function requiredRecord(value, context) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a mapping`);
  }
  return value;
}

function requiredStep(steps, name, context) {
  const matches = steps.filter((step) => step?.name === name);
  if (matches.length !== 1) {
    throw new Error(`${context} must contain exactly one '${name}' step`);
  }
  return matches[0];
}

function stepIndex(steps, name) {
  return steps.findIndex((step) => step?.name === name);
}

function requirePinnedAction(step, action, context) {
  const uses = String(step?.uses ?? "");
  if (!uses.startsWith(`${action}@`) || !FULL_ACTION_SHA.test(uses)) {
    throw new Error(`${context} must pin ${action} to a full commit SHA`);
  }
}

function includesCommand(source, command) {
  return String(source).split(/\r?\n/u).some((line) => {
    const normalized = line.trim();
    return (
      normalized === command ||
      normalized === `run: ${command}` ||
      normalized === `- run: ${command}`
    );
  });
}

function validateBinaryJob(job, platforms) {
  const context = ".github/workflows/release.yml:jobs.binary-artifacts";
  if (!isDeepStrictEqual(job?.strategy?.matrix?.include, platforms)) {
    throw new Error(`${context} matrix differs from the reviewed platform list`);
  }
  if (
    job?.permissions?.contents !== "read" ||
    job?.permissions?.["id-token"] !== "write" ||
    job?.permissions?.attestations !== "write"
  ) {
    throw new Error(`${context} must grant read contents and write provenance`);
  }

  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const packageStep = requiredStep(steps, "Package native binaries", context);
  const packageSource = String(packageStep.run ?? "");
  for (const required of [
    "colorful",
    "colorful-lsp",
    "README.md",
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",
    "sha256sum",
  ]) {
    if (!packageSource.includes(required)) {
      throw new Error(`${context} package step must include ${required}`);
    }
  }

  const attest = requiredStep(steps, "Attest native archive", context);
  requirePinnedAction(attest, "actions/attest", context);
  if (!String(attest.with?.["subject-path"] ?? "").includes("*.tar.gz")) {
    throw new Error(`${context} must attest the native archive`);
  }

  const upload = requiredStep(steps, "Upload native archive", context);
  requirePinnedAction(upload, "actions/upload-artifact", context);
  const uploadPath = String(upload.with?.path ?? "");
  if (!uploadPath.includes("*.tar.gz") || !uploadPath.includes("*.sha256")) {
    throw new Error(`${context} must upload each archive and checksum`);
  }
}

function validateReleaseJob(job) {
  const context = ".github/workflows/release.yml:jobs.release";
  const needs = Array.isArray(job?.needs) ? job.needs : [job?.needs];
  if (!needs.includes("binary-artifacts")) {
    throw new Error(`${context} must wait for binary-artifacts`);
  }
  if (
    job?.permissions?.contents !== "write" ||
    job?.permissions?.["id-token"] !== "write" ||
    job?.permissions?.attestations !== "write"
  ) {
    throw new Error(`${context} must publish releases and signed provenance`);
  }

  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const checker = requiredStep(
    steps,
    "Check release distribution policy",
    context,
  );
  if (String(checker.run ?? "").trim() !== CHECK_COMMAND) {
    throw new Error(`${context} must run ${CHECK_COMMAND}`);
  }

  const download = requiredStep(steps, "Download native archives", context);
  requirePinnedAction(download, "actions/download-artifact", context);
  if (
    download.with?.pattern !== "release-binaries-*" ||
    download.with?.["merge-multiple"] !== true
  ) {
    throw new Error(`${context} must merge the reviewed native archives`);
  }

  const verify = requiredStep(
    steps,
    "Verify editor publisher credentials",
    context,
  );
  if (
    verify.env?.VSCE_PAT !== "${{ secrets.VSCE_PAT }}" ||
    verify.env?.OVSX_PAT !== "${{ secrets.OVSX_PAT }}"
  ) {
    throw new Error(`${context} must bind both reviewed publisher secrets`);
  }
  const verifySource = String(verify.run ?? "");
  for (const command of ["vsce verify-pat", "ovsx verify-pat"]) {
    if (!verifySource.includes(command)) {
      throw new Error(`${context} must run ${command}`);
    }
  }
  const cratesIndex = stepIndex(steps, "Publish to crates.io");
  const verifyIndex = stepIndex(steps, "Verify editor publisher credentials");
  if (cratesIndex === -1 || verifyIndex === -1 || verifyIndex > cratesIndex) {
    throw new Error(`${context} must verify editor credentials before crates`);
  }

  const packageStep = requiredStep(
    steps,
    "Build and smoke editor packages",
    context,
  );
  const packageSource = String(packageStep.run ?? "");
  if (
    !packageSource.includes("npm --prefix editors/vscode run smoke:package") ||
    !packageSource.includes("target/editor-smoke/zed-source") ||
    packageSource.includes("package:vsix")
  ) {
    throw new Error(
      `${context} must package editors once through the clean-install smoke`,
    );
  }

  const attest = requiredStep(steps, "Attest editor artifacts", context);
  requirePinnedAction(attest, "actions/attest", context);
  const attested = String(attest.with?.["subject-path"] ?? "");
  if (!attested.includes("*.vsix") || !attested.includes("*zed-source.tar.gz")) {
    throw new Error(`${context} must attest the VSIX and Zed source archive`);
  }

  const publish = requiredStep(steps, "Publish editor extension", context);
  const publishSource = String(publish.run ?? "");
  const vsixAssignment =
    'vsix="target/editor-smoke/colorful-language-${version}.vsix"';
  if (!publishSource.includes(vsixAssignment)) {
    throw new Error(`${context} must select the smoke-tested VSIX path`);
  }
  for (const command of ["vsce publish", "ovsx publish"]) {
    const commandLine = publishSource
      .split(/\r?\n/u)
      .find((line) => line.includes(command));
    if (
      commandLine === undefined ||
      !commandLine.includes('--packagePath "$vsix"') ||
      !commandLine.includes("--skip-duplicate")
    ) {
      throw new Error(
        `${context} must publish the exact VSIX rerun-safely with ${command}`,
      );
    }
  }

  const release = requiredStep(steps, "Create GitHub Release", context);
  if (!String(release.run ?? "").includes("dist/*")) {
    throw new Error(`${context} must attach every reviewed distribution asset`);
  }
}

function validateDocumentation(documentation) {
  const runbook = String(documentation.runbook ?? "");
  const topic = String(documentation.topic ?? "");
  const requiredRunbookText = [
    "Publication and rollback owner: `@flyingrobots`",
    "gh attestation verify",
    "vsce show",
    "ovsx get",
    "zed-industries/extensions",
    "Do not move the tag",
    "observational",
  ];
  for (const text of requiredRunbookText) {
    if (!runbook.includes(text)) {
      throw new Error(`docs/RELEASING.md must include ${text}`);
    }
  }
  if (
    !topic.includes("installation-to-first-highlight") ||
    !topic.includes("not a correctness threshold")
  ) {
    throw new Error(
      "editor integration reference must bound observational startup timing",
    );
  }
}

export function validateReleaseDistribution(snapshot) {
  const policy = requiredRecord(
    snapshot.policy,
    ".continuum/release.yml:distribution",
  );
  if (policy.owner !== EXPECTED_OWNER) {
    throw new Error(
      `.continuum/release.yml distribution owner must be ${EXPECTED_OWNER}`,
    );
  }
  if (policy.provenance !== EXPECTED_PROVENANCE) {
    throw new Error(
      `.continuum/release.yml provenance must be ${EXPECTED_PROVENANCE}`,
    );
  }
  if (!isDeepStrictEqual(policy.binaries, EXPECTED_PLATFORMS)) {
    throw new Error(
      ".continuum/release.yml binaries differ from the reviewed platform list",
    );
  }
  if (!isDeepStrictEqual(policy.editors, EXPECTED_EDITOR_POLICY)) {
    throw new Error(
      ".continuum/release.yml editor distribution policy has drifted",
    );
  }
  if (
    !isDeepStrictEqual(snapshot.publisherTools, EXPECTED_PUBLISHER_TOOLS)
  ) {
    throw new Error("editor publisher tools must be exact and lockfile-backed");
  }
  if (snapshot.zedLicense !== snapshot.repositoryLicense) {
    throw new Error(
      "editors/zed/LICENSE must equal the repository license byte-for-byte",
    );
  }

  const workflow = requiredRecord(
    snapshot.workflow,
    ".github/workflows/release.yml",
  );
  const jobs = requiredRecord(
    workflow.jobs,
    ".github/workflows/release.yml:jobs",
  );
  validateBinaryJob(jobs["binary-artifacts"], EXPECTED_PLATFORMS);
  validateReleaseJob(jobs.release);

  for (const [name, source] of Object.entries(snapshot.gates ?? {})) {
    if (!includesCommand(source, CHECK_COMMAND)) {
      throw new Error(`${name} must run ${CHECK_COMMAND}`);
    }
  }
  validateDocumentation(snapshot.documentation ?? {});

  return {
    owner: policy.owner,
    platformCount: policy.binaries.length,
    editorRegistryCount: policy.editors.vscode.registries.length + 1,
  };
}

function parseRepositoryProfile(source) {
  const document = requiredRecord(
    parseYaml(source),
    ".continuum/release.yml",
  );
  return document.distribution;
}

export function loadRepositorySnapshot(root = ROOT) {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const readOptional = (path) => {
    try {
      return read(path);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  };
  const packageJson = JSON.parse(read("editors/vscode/package.json"));
  const packageLock = JSON.parse(read("editors/vscode/package-lock.json"));
  const toolNames = Object.keys(EXPECTED_PUBLISHER_TOOLS);
  const publisherTools = Object.fromEntries(
    toolNames.map((name) => {
      const declared = packageJson.devDependencies?.[name];
      const lockedRoot = packageLock.packages?.[""]?.devDependencies?.[name];
      const lockedPackage = packageLock.packages?.[`node_modules/${name}`]?.version;
      if (declared !== lockedRoot || declared !== lockedPackage) {
        return [name, "manifest-lockfile-drift"];
      }
      return [name, declared];
    }),
  );

  return {
    policy: parseRepositoryProfile(read(".continuum/release.yml")),
    workflow: parseYaml(read(".github/workflows/release.yml")),
    publisherTools,
    repositoryLicense: read("LICENSE"),
    zedLicense: readOptional("editors/zed/LICENSE"),
    gates: {
      ci: read(".github/workflows/ci.yml"),
      releasePrep: read("scripts/release-prep.sh"),
      release: read(".github/workflows/release.yml"),
    },
    documentation: {
      runbook: read("docs/RELEASING.md"),
      topic: read("docs/topics/editor-integrations/README.md"),
    },
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = validateReleaseDistribution(loadRepositorySnapshot());
    process.stdout.write(
      `check-release-distribution passed: ${result.platformCount} native platforms, ${result.editorRegistryCount} editor registries\n`,
    );
  } catch (error) {
    process.stderr.write(`check-release-distribution: ${error.message}\n`);
    process.exitCode = 1;
  }
}
