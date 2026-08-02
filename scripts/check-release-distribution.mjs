#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { parse as parseYaml } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FULL_ACTION_SHA = /^[^@\s]+@[0-9a-f]{40}$/u;

export const CHECK_COMMAND = "node scripts/check-release-distribution.mjs";
export const HOMEBREW_SELF_TEST_COMMAND =
  "node --test scripts/generate-homebrew-formula.test.mjs";
export const PUBLICATION_SELF_TEST_COMMAND =
  "node --test scripts/verify-editor-publication.test.mjs";
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
export const EXPECTED_HOMEBREW_POLICY = Object.freeze({
  formula: "dist/colorful.rb",
  binaries: Object.freeze(["colorful", "colorful-lsp"]),
  platforms: Object.freeze([
    Object.freeze({
      os: "linux",
      arch: "x86_64",
      target: "x86_64-unknown-linux-gnu",
    }),
    Object.freeze({
      os: "macos",
      arch: "arm64",
      target: "aarch64-apple-darwin",
    }),
  ]),
  publication: Object.freeze({
    authority: "github-release-asset",
    tap: null,
    tracking_issue: 37,
  }),
});
export const EXPECTED_PUBLISHER_TOOLS = Object.freeze({
  "@vscode/vsce": "3.9.2",
  ovsx: "1.0.2",
});
export const EXPECTED_FORMULA_RUBY = Object.freeze({
  uses:
    "ruby/setup-ruby@95ef2b042f9d7a56d8268cba8559e2842e2ad01b",
  with: Object.freeze({
    "ruby-version": "3.4.10",
  }),
});
// The SBOM is generated after the native archives land in dist/ so the
// dependency graph ships beside the bytes it describes, and before the
// attestation step so it is covered by the same provenance.
export const EXPECTED_SBOM_TOOL = "cargo-cyclonedx@0.5.9";
// The release profile's artifact inventory is a separate authority from the
// workflow: the workflow decides what is produced, the inventory decides what a
// release is required to contain. Both SBOM assets must appear here, or an
// entry could be dropped without any gate noticing.
export const EXPECTED_SBOM_ARTIFACT = Object.freeze({
  name: "software-bill-of-materials",
  platform: "provenance",
  contents: Object.freeze([
    "dist/colorful-language-v{version}-colorful-sbom.cdx.json",
    "dist/colorful-language-v{version}-colorful-lsp-sbom.cdx.json",
  ]),
});
const EXPECTED_SBOM_ASSET = "dist/*sbom.cdx.json";
// Matched as an exact sequence rather than by token presence, so an inert
// stand-in such as `echo 'cargo cyclonedx'; touch dist/fake-sbom.cdx.json`
// cannot satisfy the gate and publish an arbitrary attested file.
// cargo-cyclonedx emits one SBOM per package next to that package's manifest;
// there is no aggregate-workspace mode, and it rejects --locked. The release
// ships two binaries, so each gets its own bill of materials.
const REVIEWED_SBOM_COMMANDS = Object.freeze([
  "set -euo pipefail",
  "cargo cyclonedx --format json --all " +
    "--manifest-path crates/colorful-cli/Cargo.toml --override-filename sbom",
  "cargo cyclonedx --format json --all " +
    "--manifest-path crates/colorful-lsp/Cargo.toml --override-filename sbom",
  "cp crates/colorful-cli/sbom.json " +
    '"dist/colorful-language-${GITHUB_REF_NAME}-colorful-sbom.cdx.json"',
  "cp crates/colorful-lsp/sbom.json " +
    '"dist/colorful-language-${GITHUB_REF_NAME}-colorful-lsp-sbom.cdx.json"',
]);

const REVIEWED_RELEASE_STEP_ORDER = Object.freeze([
  "Set up formula syntax Ruby",
  "Download native archives",
  "Install SBOM tool",
  "Generate SBOM",
  "Generate Homebrew formula",
  "Build and smoke editor packages",
  "Attest Homebrew and editor artifacts",
  "Verify and publish VS Marketplace extension",
  "Verify and publish Open VSX extension",
  "Verify published editor bytes",
  "Publish to crates.io",
  "Create GitHub Release",
]);
const REVIEWED_HOMEBREW_COMMANDS = Object.freeze([
  "set -euo pipefail",
  'version="${GITHUB_REF_NAME#v}"',
  "node scripts/generate-homebrew-formula.mjs " +
    '--version "$version" --dist-dir dist > dist/colorful.rb',
  "ruby -c dist/colorful.rb",
]);
const REQUIRED_ADMISSION_COMMANDS = Object.freeze([
  "bash scripts/release-profile-check.sh",
  "node scripts/check-editor-version-policy.mjs",
  CHECK_COMMAND,
  HOMEBREW_SELF_TEST_COMMAND,
  "cargo fmt --all -- --check",
  "cargo clippy --locked --all-targets --all-features -- -D warnings",
  "cargo test --all --locked",
  "cargo build --release --locked",
  "bash scripts/package-witness.sh",
]);

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

function requireStepOrder(steps, names, context) {
  const indices = names.map((name) => {
    requiredStep(steps, name, context);
    return stepIndex(steps, name);
  });
  if (
    indices.some(
      (index, position) =>
        position > 0 && index <= indices[position - 1],
    )
  ) {
    throw new Error(
      `${context} must preserve the reviewed release step order`,
    );
  }
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

function workflowIncludesCommand(workflow, command) {
  const jobs = workflow?.jobs;
  if (typeof jobs !== "object" || jobs === null || Array.isArray(jobs)) {
    return false;
  }
  return Object.values(jobs).some((job) =>
    stepsIncludeCommand(
      Array.isArray(job?.steps) ? job.steps : [],
      command,
    ),
  );
}

function stepsIncludeCommand(steps, command) {
  return steps.some((step) =>
    String(step?.run ?? "")
      .split(/\r?\n/u)
      .some(
        (line) =>
          line.trim().replace(/\s+#.*$/u, "") === command,
      ),
  );
}

function shellCommandLines(source) {
  return String(source)
    .replace(/[ \t]*\\\r?\n[ \t]*/gu, " ")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function validateGateCommands(gates, names, command) {
  requiredRecord(gates, "release distribution gates");
  const observed = Object.keys(gates).toSorted();
  const expected = names.toSorted();
  if (!isDeepStrictEqual(observed, expected)) {
    throw new Error(
      `release distribution gates for ${command} must be ${expected.join(", ")}`,
    );
  }
  for (const name of expected) {
    const includes =
      name === "releasePrep"
        ? includesCommand(gates[name], command)
        : workflowIncludesCommand(gates[name], command);
    if (!includes) {
      throw new Error(`${name} must run ${command}`);
    }
  }
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
  for (const command of REQUIRED_ADMISSION_COMMANDS) {
    if (!stepsIncludeCommand(steps, command)) {
      throw new Error(
        `${context} admission must complete all final validation before native provenance: ${command}`,
      );
    }
  }
}

function validateBinaryJob(job, platforms) {
  const context = ".github/workflows/release.yml:jobs.binary-artifacts";
  if (job?.["runs-on"] !== "${{ matrix.runner }}") {
    throw new Error(`${context} native job must dispatch through matrix.runner`);
  }
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
  if (upload.with?.["if-no-files-found"] !== "error") {
    throw new Error(
      `${context} must fail when native archive files are absent`,
    );
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
  const formulaRuby = requiredStep(
    steps,
    "Set up formula syntax Ruby",
    context,
  );
  if (!isDeepStrictEqual(formulaRuby, {
    name: "Set up formula syntax Ruby",
    ...EXPECTED_FORMULA_RUBY,
  })) {
    throw new Error(
      `${context} must use the reviewed formula syntax Ruby setup`,
    );
  }

  const download = requiredStep(steps, "Download native archives", context);
  requirePinnedAction(download, "actions/download-artifact", context);
  if (
    download.with?.pattern !== "release-binaries-*" ||
    download.with?.["merge-multiple"] !== true
  ) {
    throw new Error(`${context} must merge the reviewed native archives`);
  }
  if (download.with?.path !== "dist") {
    throw new Error(`${context} must download native archives into dist`);
  }

  const sbomInstall = requiredStep(steps, "Install SBOM tool", context);
  requirePinnedAction(sbomInstall, "taiki-e/install-action", context);
  const sbomGenerate = requiredStep(steps, "Generate SBOM", context);
  if (
    sbomInstall.with?.tool !== EXPECTED_SBOM_TOOL ||
    sbomInstall.with?.fallback !== "none" ||
    !isDeepStrictEqual(
      shellCommandLines(sbomGenerate.run ?? ""),
      REVIEWED_SBOM_COMMANDS,
    )
  ) {
    throw new Error(
      `${context} must generate an SBOM with ${EXPECTED_SBOM_TOOL} ` +
        `through the exact reviewed command sequence`,
    );
  }

  const homebrew = requiredStep(
    steps,
    "Generate Homebrew formula",
    context,
  );
  if (
    !isDeepStrictEqual(
      shellCommandLines(homebrew.run ?? ""),
      REVIEWED_HOMEBREW_COMMANDS,
    )
  ) {
    throw new Error(
      `${context} Homebrew generation must match the exact reviewed command sequence`,
    );
  }

  const marketplace = requiredStep(
    steps,
    "Verify and publish VS Marketplace extension",
    context,
  );
  const openVsx = requiredStep(
    steps,
    "Verify and publish Open VSX extension",
    context,
  );
  if (
    !isDeepStrictEqual(marketplace.env, {
      VSCE_PAT: "${{ secrets.VSCE_PAT }}",
    })
  ) {
    throw new Error(
      `${context} must isolate the VS Marketplace publisher secret`,
    );
  }
  if (
    !isDeepStrictEqual(openVsx.env, {
      OVSX_PAT: "${{ secrets.OVSX_PAT }}",
    })
  ) {
    throw new Error(`${context} must isolate the Open VSX publisher secret`);
  }
  const marketplaceSource = String(marketplace.run ?? "");
  const openVsxSource = String(openVsx.run ?? "");

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

  const attest = requiredStep(
    steps,
    "Attest Homebrew and editor artifacts",
    context,
  );
  requirePinnedAction(attest, "actions/attest", context);
  const attested = String(attest.with?.["subject-path"] ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (
    !attested.includes("target/editor-smoke/*.vsix") ||
    !attested.includes("dist/*zed-source.tar.gz") ||
    !attested.includes("dist/colorful.rb") ||
    !attested.includes(EXPECTED_SBOM_ASSET)
  ) {
    throw new Error(
      `${context} must attest the formula, VSIX, Zed source archive, and SBOM`,
    );
  }

  const vsixAssignment =
    'vsix="target/editor-smoke/colorful-language-${version}.vsix"';
  for (const [source, command] of [
    [marketplaceSource, "vsce"],
    [openVsxSource, "ovsx"],
  ]) {
    if (
      !source.includes(`${command} verify-pat`) ||
      !source.includes(vsixAssignment)
    ) {
      throw new Error(
        `${context} must verify credentials and select the smoke-tested VSIX for ${command}`,
      );
    }
    const commandLine = source
      .split(/\r?\n/u)
      .find((line) => line.includes(`${command} publish`));
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

  const verify = requiredStep(
    steps,
    "Verify published editor bytes",
    context,
  );
  const verifySource = String(verify.run ?? "");
  if (
    !verifySource.includes("node scripts/verify-editor-publication.mjs") ||
    !verifySource.includes('--vsix "$vsix"') ||
    !verifySource.includes('--version "$version"')
  ) {
    throw new Error(
      `${context} must verify published editor bytes against the smoke-tested VSIX`,
    );
  }

  const release = requiredStep(steps, "Create GitHub Release", context);
  if (!String(release.run ?? "").includes("dist/*")) {
    throw new Error(`${context} must attach every reviewed distribution asset`);
  }
  requireStepOrder(steps, REVIEWED_RELEASE_STEP_ORDER, context);
}

function validateDocumentation(documentation) {
  const runbook = String(documentation.runbook ?? "");
  const topic = String(documentation.topic ?? "");
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const normalizedTopic = topic.replace(/\s+/gu, " ");
  const requiredRunbookText = [
    "Publication and rollback owner: `@flyingrobots`",
    "gh release download vX.Y.Z",
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
  const releaseDownloadLine = runbook
    .split(/\r?\n/u)
    .find((line) => line.trim().startsWith("gh release download vX.Y.Z"));
  const releaseDownload = runbook.indexOf("gh release download vX.Y.Z");
  const attestationVerification = runbook.indexOf("gh attestation verify");
  if (
    releaseDownloadLine?.trim() !== "gh release download vX.Y.Z" ||
    releaseDownload === -1 ||
    attestationVerification <= releaseDownload
  ) {
    throw new Error(
      "release verification must download every release asset before attestation",
    );
  }
  if (
    !runbook.includes("shasum -a 256 -c ./*.sha256") ||
    !normalizedRunbook.includes(
      "for artifact in colorful-language-vX.Y.Z-*.tar.gz colorful-language-X.Y.Z.vsix",
    )
  ) {
    throw new Error(
      "release verification must verify checksums and provenance for every release artifact",
    );
  }
  const postPublication =
    runbook.indexOf("## Post-publication verification");
  const publicByteVerification =
    runbook.indexOf("node scripts/verify-editor-publication.mjs");
  if (
    postPublication === -1 ||
    publicByteVerification <= postPublication
  ) {
    throw new Error(
      "public byte verification must follow publication in docs/RELEASING.md",
    );
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
  requireSbomArtifactInventory(
    snapshot.releaseArtifacts,
    ".continuum/release.yml:publish.artifacts",
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
  if (!isDeepStrictEqual(policy.homebrew, EXPECTED_HOMEBREW_POLICY)) {
    throw new Error(
      ".continuum/release.yml Homebrew distribution policy has drifted",
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

  validateGateCommands(
    snapshot.gates,
    ["ci", "release", "releasePrep"],
    CHECK_COMMAND,
  );
  validateGateCommands(
    snapshot.gates,
    ["ci", "release", "releasePrep"],
    HOMEBREW_SELF_TEST_COMMAND,
  );
  validateGateCommands(
    snapshot.publicationVerificationGates,
    ["ci", "releasePrep"],
    PUBLICATION_SELF_TEST_COMMAND,
  );
  validateDocumentation(snapshot.documentation ?? {});

  return {
    owner: policy.owner,
    platformCount: policy.binaries.length,
    homebrewPlatformCount: policy.homebrew.platforms.length,
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

function parseReleaseArtifacts(source) {
  const document = requiredRecord(
    parseYaml(source),
    ".continuum/release.yml",
  );
  return document.publish?.artifacts;
}

function requireSbomArtifactInventory(artifacts, context) {
  const entries = Array.isArray(artifacts) ? artifacts : [];
  const entry = entries.find(
    (candidate) => candidate?.name === EXPECTED_SBOM_ARTIFACT.name,
  );
  if (
    !entry ||
    entry.platform !== EXPECTED_SBOM_ARTIFACT.platform ||
    !isDeepStrictEqual(
      Array.isArray(entry.contents) ? [...entry.contents].sort() : [],
      [...EXPECTED_SBOM_ARTIFACT.contents].sort(),
    )
  ) {
    throw new Error(
      `${context} must register both SBOM assets in the release artifact inventory`,
    );
  }
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
  const ciWorkflow = parseYaml(read(".github/workflows/ci.yml"));
  const releaseWorkflow = parseYaml(read(".github/workflows/release.yml"));
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
    releaseArtifacts: parseReleaseArtifacts(read(".continuum/release.yml")),
    workflow: releaseWorkflow,
    publisherTools,
    repositoryLicense: read("LICENSE"),
    zedLicense: readOptional("editors/zed/LICENSE"),
    gates: {
      ci: ciWorkflow,
      releasePrep: read("scripts/release-prep.sh"),
      release: releaseWorkflow,
    },
    publicationVerificationGates: {
      ci: ciWorkflow,
      releasePrep: read("scripts/release-prep.sh"),
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
      `check-release-distribution passed: ${result.platformCount} native platforms, ${result.homebrewPlatformCount} Homebrew platforms, ${result.editorRegistryCount} editor registries\n`,
    );
  } catch (error) {
    process.stderr.write(`check-release-distribution: ${error.message}\n`);
    process.exitCode = 1;
  }
}
