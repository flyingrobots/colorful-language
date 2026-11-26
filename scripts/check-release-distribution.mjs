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
    publication: Object.freeze({
      authority: "github-release-asset",
      installation: "manual-vsix",
    }),
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
export const EXPECTED_PACKAGE_TOOLS = Object.freeze({
  "@vscode/vsce": "3.9.2",
});
export const EXPECTED_FORMULA_RUBY = Object.freeze({
  uses:
    "ruby/setup-ruby@7f797815d8adceb1c412e7abefdd1ab4abc47a5f",
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
    '"dist/colorful-language-${RELEASE_TAG}-colorful-sbom.cdx.json"',
  "cp crates/colorful-lsp/sbom.json " +
    '"dist/colorful-language-${RELEASE_TAG}-colorful-lsp-sbom.cdx.json"',
]);

// A manual run of the release workflow is a dry run. The mode is the event,
// not an input, so a tag push cannot select it. Exactly these steps have an
// effect outside the run (public attestation records, crates.io, the GitHub
// Release, and the read of the public release asset); they run only on a tag
// push, and every other step and job runs unconditionally in both modes.
const RELEASE_TRIGGERS = Object.freeze({
  push: Object.freeze({ tags: Object.freeze(["v*"]) }),
  workflow_dispatch: null,
});
const DRY_RUN_GUARD = "github.event_name == 'push'";
const TAG_ONLY_STEPS = Object.freeze({
  "binary-artifacts": Object.freeze(["Attest native archive"]),
  release: Object.freeze([
    "Attest Homebrew and editor artifacts",
    "Publish to crates.io",
    "Create GitHub Release",
    "Verify GitHub Release VSIX",
  ]),
});
const CREDENTIAL_REFERENCE = /secrets\.|github\.token/u;
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/gu;
const REF_NAME_REFERENCE = /GITHUB_REF_NAME|github\.ref_name/u;
const RELEASE_TAG_OUTPUT = "${{ steps.release-metadata.outputs.release_tag }}";
const RELEASE_TAG_ENV = "${{ needs.validate-release.outputs.release-tag }}";
// A tag run takes its release tag from the pushed tag and still compares it
// with the workspace, changelog, and packet. A dry run has no tag, so it
// derives the tag from the workspace version, and it is refused outside main.
const DRY_RUN_REFUSAL = Object.freeze([
  'if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ] && ' +
    '[ "$GITHUB_REF" != "refs/heads/main" ]; then',
  /^echo /u,
  "exit 1",
  "fi",
]);
const REQUIRED_METADATA_LINES = Object.freeze([
  'case "$GITHUB_EVENT_NAME" in',
  'push) release_tag="$GITHUB_REF_NAME" ;;',
  'workflow_dispatch) release_tag="v${workspace_version}" ;;',
  'version="${release_tag#v}"',
  'if [ "$workspace_version" != "$version" ]; then',
  'grep -F "## [$version]" CHANGELOG.md',
  'test -f "docs/goalposts/${release_tag}/release.md"',
  'test -f "docs/goalposts/${release_tag}/verification.md"',
  'echo "release_tag=${release_tag}" >> "$GITHUB_OUTPUT"',
]);
const REVIEWED_ANCESTRY_SELECTION = Object.freeze([
  'if [ "$GITHUB_EVENT_NAME" = "push" ]; then',
  'release_commit="$(git rev-parse "${GITHUB_REF_NAME}^{commit}")"',
  "else",
  'release_commit="$(git rev-parse "${GITHUB_SHA}^{commit}")"',
  "fi",
  'if ! git merge-base --is-ancestor "$release_commit" origin/main; then',
]);

const REVIEWED_RELEASE_STEP_ORDER = Object.freeze([
  "Set up formula syntax Ruby",
  "Download native archives",
  "Install SBOM tool",
  "Generate SBOM",
  "Generate Homebrew formula",
  "Build and smoke editor packages",
  "Attest Homebrew and editor artifacts",
  "Publish to crates.io",
  "Create GitHub Release",
  "Verify GitHub Release VSIX",
]);
const REVIEWED_HOMEBREW_COMMANDS = Object.freeze([
  "set -euo pipefail",
  'version="${RELEASE_TAG#v}"',
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

function trimmedLines(source) {
  return String(source ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function lineMatches(line, expected) {
  return expected instanceof RegExp ? expected.test(line) : line === expected;
}

function containsLineSequence(lines, sequence) {
  return lines.some((_, start) =>
    sequence.every((expected, offset) =>
      lineMatches(lines[start + offset] ?? "", expected),
    ),
  );
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
  const metadataLines = trimmedLines(metadata.run);
  for (const required of REQUIRED_METADATA_LINES) {
    if (!metadataLines.includes(required)) {
      throw new Error(`${context} metadata admission must include ${required}`);
    }
  }
  if (
    metadataLines.filter((line) =>
      /^(?:[\w-]+\)\s*)?release_tag=/u.test(line),
    ).length !== 2
  ) {
    throw new Error(
      `${context} metadata admission must assign release_tag only from the tag or the workspace version`,
    );
  }
  if (!containsLineSequence(metadataLines, DRY_RUN_REFUSAL)) {
    throw new Error(
      `${context} metadata admission must refuse a dry run outside refs/heads/main`,
    );
  }
  if (
    metadata.id !== "release-metadata" ||
    job?.outputs?.["release-tag"] !== RELEASE_TAG_OUTPUT ||
    Object.keys(job.outputs).length !== 1
  ) {
    throw new Error(
      `${context} must publish the admitted release tag as the release-tag output`,
    );
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
  if (
    !containsLineSequence(
      trimmedLines(ancestrySource),
      REVIEWED_ANCESTRY_SELECTION,
    )
  ) {
    throw new Error(
      `${context} ancestry admission must check the tag on a tag run and the dispatched commit on a dry run`,
    );
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
    !isDeepStrictEqual(job?.permissions, {
      contents: "read",
      "id-token": "write",
      attestations: "write",
    })
  ) {
    throw new Error(`${context} must grant read contents and write provenance`);
  }
  requireAdmittedReleaseTag(job, context);

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
    !isDeepStrictEqual(job?.permissions, {
      contents: "write",
      "id-token": "write",
      attestations: "write",
    })
  ) {
    throw new Error(`${context} must publish releases and signed provenance`);
  }
  requireAdmittedReleaseTag(job, context);

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

  const packageStep = requiredStep(
    steps,
    "Build and smoke editor packages",
    context,
  );
  const packageSource = String(packageStep.run ?? "");
  const vsixAssignment =
    'vsix="target/editor-smoke/colorful-language-${version}.vsix"';
  if (
    !packageSource.includes("npm --prefix editors/vscode run smoke:package") ||
    !packageSource.includes(vsixAssignment) ||
    !packageSource.includes('cp "$vsix" dist/') ||
    !packageSource.includes(
      'sha256sum "$(basename "$vsix")" > "$(basename "$vsix").sha256"',
    ) ||
    !packageSource.includes("target/editor-smoke/zed-source") ||
    packageSource.includes("package:vsix")
  ) {
    throw new Error(
      `${context} must promote one clean-install-smoked VSIX and checksum into the release assets`,
    );
  }

  for (const step of steps) {
    const envNames = Object.keys(step?.env ?? {});
    const source = String(step?.run ?? "");
    if (
      envNames.some((name) => name === "VSCE_PAT" || name === "OVSX_PAT") ||
      /(?:^|\s)(?:vsce|ovsx)\s+(?:verify-pat|publish)(?:\s|$)/u.test(source)
    ) {
      throw new Error(
        `${context} must not require marketplace credentials or publisher commands`,
      );
    }
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
    !attested.includes("dist/*.vsix") ||
    !attested.includes("dist/*zed-source.tar.gz") ||
    !attested.includes("dist/colorful.rb") ||
    !attested.includes(EXPECTED_SBOM_ASSET)
  ) {
    throw new Error(
      `${context} must attest the formula, VSIX, Zed source archive, and SBOM`,
    );
  }

  const verify = requiredStep(steps, "Verify GitHub Release VSIX", context);
  const verifySource = String(verify.run ?? "");
  if (
    !verifySource.includes("node scripts/verify-editor-publication.mjs") ||
    !verifySource.includes(vsixAssignment) ||
    !verifySource.includes('--vsix "$vsix"') ||
    !verifySource.includes('--version "$version"')
  ) {
    throw new Error(
      `${context} must verify the public GitHub Release VSIX against the smoke witness`,
    );
  }

  const release = requiredStep(steps, "Create GitHub Release", context);
  if (!/(?:^|\s)dist\/\*(?:\s|$)/u.test(String(release.run ?? ""))) {
    throw new Error(`${context} must attach every reviewed distribution asset`);
  }
  requireStepOrder(steps, REVIEWED_RELEASE_STEP_ORDER, context);
}

function requireAdmittedReleaseTag(job, context) {
  if (job?.env?.RELEASE_TAG !== RELEASE_TAG_ENV) {
    throw new Error(
      `${context} must take RELEASE_TAG from the validate-release release-tag output`,
    );
  }
}

function validateTriggers(workflow) {
  const context = ".github/workflows/release.yml";
  const triggers = workflow.on;
  const dispatch = triggers?.workflow_dispatch;
  const inputFreeDispatch =
    dispatch === null ||
    (typeof dispatch === "object" &&
      !Array.isArray(dispatch) &&
      Object.keys(dispatch).length === 0);
  if (
    typeof triggers !== "object" ||
    triggers === null ||
    !isDeepStrictEqual(
      Object.keys(triggers).toSorted(),
      Object.keys(RELEASE_TRIGGERS).toSorted(),
    ) ||
    !isDeepStrictEqual(triggers.push, RELEASE_TRIGGERS.push) ||
    !inputFreeDispatch
  ) {
    throw new Error(
      `${context}:on must trigger on a pushed v* tag and an input-free workflow_dispatch`,
    );
  }
  if (!isDeepStrictEqual(workflow.permissions, {})) {
    throw new Error(
      `${context}:permissions must grant nothing at workflow level`,
    );
  }
}

function jobModes(jobs) {
  return Object.entries(jobs).map(([jobName, job]) => {
    const tagOnly = TAG_ONLY_STEPS[jobName] ?? [];
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    return {
      job,
      jobName,
      context: `.github/workflows/release.yml:jobs.${jobName}`,
      tagOnly,
      steps: steps.map((step) => ({
        step,
        label: step?.name ?? step?.uses ?? "unnamed step",
        tagOnly: tagOnly.includes(step?.name),
      })),
    };
  });
}

// Conditions are the mode contract, so they are checked before any per-job
// invariant: a condition on any step is reported as a mode violation.
function validateExecutionConditions(jobs) {
  for (const { job, context, tagOnly, steps } of jobModes(jobs)) {
    if (Object.hasOwn(job ?? {}, "if")) {
      throw new Error(
        `${context} must not carry a job condition, so tag runs and dry runs both reach it`,
      );
    }
    for (const name of tagOnly) {
      requiredStep(
        steps.map(({ step }) => step),
        name,
        context,
      );
    }
    for (const { step, label, tagOnly: isTagOnly } of steps) {
      if (isTagOnly && step.if !== DRY_RUN_GUARD) {
        throw new Error(
          `${context} step '${label}' must run only on a tag push through if: ${DRY_RUN_GUARD}`,
        );
      }
      if (!isTagOnly && Object.hasOwn(step ?? {}, "if")) {
        throw new Error(
          `${context} step '${label}' must run on tag runs and dry runs alike`,
        );
      }
    }
  }
}

function stringsIn(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

// Actions expressions resolve context names and property names without regard
// to case, and accept bracket access with either quote. Any use of the secrets
// context reads a secret. The github context exposes the job token as
// `github.token`, so a dot or literal-bracket read of `token`, a computed
// bracket read, or the whole context (for example `toJSON(github)`) reads it.
function expressionReadsCredential(expression) {
  if (/\bsecrets\b/iu.test(expression)) {
    return true;
  }
  for (const match of expression.matchAll(/\bgithub\b/giu)) {
    const rest = expression.slice(match.index + match[0].length);
    const dot = /^\s*\.\s*([A-Za-z_][\w-]*)/u.exec(rest);
    if (dot !== null) {
      if (dot[1].toLowerCase() === "token") {
        return true;
      }
      continue;
    }
    const literal = /^\s*\[\s*(['"])([^'"]*)\1\s*\]/u.exec(rest);
    if (literal !== null) {
      if (literal[2].toLowerCase() === "token") {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

function readsCredential(value) {
  return stringsIn(value).some(
    (text) =>
      CREDENTIAL_REFERENCE.test(text) ||
      [...text.matchAll(EXPRESSION)].some(([, expression]) =>
        expressionReadsCredential(expression),
      ),
  );
}

function validateDryRunInputs(jobs) {
  for (const { jobName, context, steps } of jobModes(jobs)) {
    for (const { step, label, tagOnly } of steps) {
      if (tagOnly) {
        continue;
      }
      const body = JSON.stringify({ ...step, name: undefined });
      if (readsCredential({ ...step, name: undefined })) {
        throw new Error(
          `${context} step '${label}' reaches a dry run and must not read a secret or the job token`,
        );
      }
      // Admission reads the pushed tag on a tag run by design; every later
      // step a dry run reaches names its artifacts from the admitted tag.
      if (jobName !== "validate-release" && REF_NAME_REFERENCE.test(body)) {
        throw new Error(
          `${context} step '${label}' reaches a dry run and must name artifacts from RELEASE_TAG, not GITHUB_REF_NAME`,
        );
      }
    }
  }
}

function validateDocumentation(documentation) {
  const runbook = String(documentation.runbook ?? "");
  const topic = String(documentation.topic ?? "");
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const normalizedTopic = topic.replace(/\s+/gu, " ");
  const requiredRunbookText = [
    "Publication and rollback owner: `@flyingrobots`",
    "gh release download vX.Y.Z",
    "gh release view vX.Y.Z",
    "gh attestation verify",
    "code --install-extension",
    "code --uninstall-extension flyingrobots.colorful-language",
    "colorful-language-vX.Y.Z-zed-source.tar.gz",
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
    !isDeepStrictEqual(snapshot.packageTools, EXPECTED_PACKAGE_TOOLS)
  ) {
    throw new Error("editor package tools must be exact and lockfile-backed");
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
  validateExecutionConditions(jobs);
  validateAdmissionJob(jobs["validate-release"]);
  validateBinaryJob(jobs["binary-artifacts"], EXPECTED_PLATFORMS);
  validateReleaseJob(jobs.release);
  validateTriggers(workflow);
  validateDryRunInputs(jobs);

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
    editorArtifactCount: Object.keys(policy.editors).length,
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
  const toolNames = Object.keys(EXPECTED_PACKAGE_TOOLS);
  const packageTools = Object.fromEntries(
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
    packageTools,
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
      `check-release-distribution passed: ${result.platformCount} native platforms, ${result.homebrewPlatformCount} Homebrew platforms, ${result.editorArtifactCount} editor artifact classes\n`,
    );
  } catch (error) {
    process.stderr.write(`check-release-distribution: ${error.message}\n`);
    process.exitCode = 1;
  }
}
