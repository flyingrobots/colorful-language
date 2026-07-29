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
    runner: "macos-15",
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

function validateAdmissionJob(job) {
  const context = ".github/workflows/release.yml:jobs.validate-release";
  if (job?.["runs-on"] !== "ubuntu-24.04") {
    throw new Error(`${context} must pin its admission runner`);
  }
  if (
    job?.permissions?.contents !== "read" ||
    Object.keys(job.permissions).length !== 1
  ) {
    throw new Error(`${context} must have read-only contents permission`);
  }

  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const checkout = steps.find((step) =>
    String(step?.uses ?? "").startsWith("actions/checkout@"),
  );
  requirePinnedAction(checkout, "actions/checkout", context);
  if (
    checkout?.with?.["fetch-depth"] !== 0 ||
    checkout?.with?.["persist-credentials"] !== false
  ) {
    throw new Error(`${context} must check out complete history read-only`);
  }

  const metadata = requiredStep(steps, "Verify release metadata", context);
  const metadataSource = String(metadata.run ?? "");
  for (const required of [
    'version="${GITHUB_REF_NAME#v}"',
    "workspace_version",
    "CHANGELOG.md",
    "docs/goalposts/${GITHUB_REF_NAME}/release.md",
    "docs/goalposts/${GITHUB_REF_NAME}/verification.md",
  ]) {
    if (!metadataSource.includes(required)) {
      throw new Error(`${context} metadata admission must include ${required}`);
    }
  }

  const ancestry = requiredStep(steps, "Verify the tag is on main", context);
  const ancestrySource = String(ancestry.run ?? "");
  for (const required of [
    "git fetch -q origin main",
    'git rev-parse "${GITHUB_REF_NAME}^{commit}"',
    "git merge-base --is-ancestor",
    "origin/main",
  ]) {
    if (!ancestrySource.includes(required)) {
      throw new Error(`${context} ancestry admission must include ${required}`);
    }
  }
}

function validateBinaryJob(job, platforms) {
  const context = ".github/workflows/release.yml:jobs.binary-artifacts";
  const needs = Array.isArray(job?.needs) ? job.needs : [job?.needs];
  if (!needs.includes("validate-release")) {
    throw new Error(`${context} must wait for validate-release`);
  }
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
  const buildStep = requiredStep(steps, "Build native binaries", context);
  const buildSource = String(buildStep.run ?? "");
  if (
    buildStep.env?.TARGET !== "${{ matrix.target }}" ||
    !buildSource.includes('--target "$TARGET"') ||
    buildSource.includes("${{ matrix.")
  ) {
    throw new Error(`${context} build must isolate the reviewed target in env`);
  }

  const packageStep = requiredStep(steps, "Package native binaries", context);
  const packageSource = String(packageStep.run ?? "");
  if (
    packageStep.env?.TARGET !== "${{ matrix.target }}" ||
    packageStep.env?.EXECUTABLE_SUFFIX !==
      "${{ matrix.executable_suffix }}" ||
    packageSource.includes("${{ matrix.")
  ) {
    throw new Error(
      `${context} package must isolate reviewed matrix values in env`,
    );
  }
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
  if (job?.["runs-on"] !== "ubuntu-24.04") {
    throw new Error(`${context} must pin its publication runner`);
  }
  const needs = Array.isArray(job?.needs) ? job.needs : [job?.needs];
  if (
    !needs.includes("validate-release") ||
    !needs.includes("binary-artifacts")
  ) {
    throw new Error(
      `${context} must wait for validate-release and binary-artifacts`,
    );
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

  const publish = requiredStep(
    steps,
    "Verify and publish editor extension",
    context,
  );
  if (
    publish.env?.VSCE_PAT !== "${{ secrets.VSCE_PAT }}" ||
    publish.env?.OVSX_PAT !== "${{ secrets.OVSX_PAT }}"
  ) {
    throw new Error(`${context} must bind both reviewed publisher secrets`);
  }
  const publishSource = String(publish.run ?? "");
  for (const command of ["vsce verify-pat", "ovsx verify-pat"]) {
    if (!publishSource.includes(command)) {
      throw new Error(`${context} must run ${command}`);
    }
  }
  const cratesIndex = stepIndex(steps, "Publish to crates.io");
  const publishIndex = stepIndex(
    steps,
    "Verify and publish editor extension",
  );
  if (
    cratesIndex === -1 ||
    publishIndex === -1 ||
    publishIndex > cratesIndex
  ) {
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
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const normalizedTopic = topic.replace(/\s+/gu, " ");
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
    if (!normalizedRunbook.includes(text)) {
      throw new Error(`docs/RELEASING.md must include ${text}`);
    }
  }
  if (
    !normalizedTopic.includes("installation-to-first-highlight") ||
    !normalizedTopic.includes("not a correctness threshold")
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
  validateAdmissionJob(jobs["validate-release"]);
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
