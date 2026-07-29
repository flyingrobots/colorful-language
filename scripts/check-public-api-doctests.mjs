#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "yaml";

const APIS = Object.freeze([
  ["core", "parser", "pub trait Parser", ".parse("],
  ["core", "annotator", "pub trait Annotator", ".annotate("],
  ["core", "analyzer", "pub trait Analyzer", ".analyze("],
  ["projection", "ir-projection", "pub fn build_document", "build_document("],
  ["vocabulary", "vocabulary", "pub fn visual_role", "visual_role("],
]);
const DOCTEST_COMMAND = "cargo test --doc --workspace --locked";
const RUSTDOC_COMMAND =
  'RUSTDOCFLAGS="-D warnings" cargo doc --locked -p colorful-lexicon --no-deps';
const INPUT_PATHS = Object.freeze({
  core: "crates/colorful-core/src/lib.rs",
  projection: "crates/colorful-projection/src/lib.rs",
  vocabulary: "crates/colorful-ir/src/vocabulary.rs",
  workflow: ".github/workflows/ci.yml",
  releasePrep: "scripts/release-prep.sh",
});
const RUSTDOC_FENCE =
  /^\s*\/\/\/ ```(?<info>[A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)?\s*$/u;
const EXECUTABLE_RUSTDOC_ATTRIBUTES = new Set([
  "should_panic",
  "standalone_crate",
  "edition2015",
  "edition2018",
  "edition2021",
  "edition2024",
]);
const ASSERTION = /\bassert(?:_eq|_matches|_ne)?!\s*\(/u;
const DOCTEST_MARKER = /^#\s*\/\/\s*public-api-doctest:/u;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class PublicApiDoctestPolicyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PublicApiDoctestPolicyError";
    this.code = code;
  }
}

function markerCount(source, marker) {
  return source.split(`# // public-api-doctest: ${marker}`).length - 1;
}

function rustdocBefore(source, declaration) {
  const declarationOffset = source.indexOf(declaration);
  if (declarationOffset === -1) {
    return "";
  }

  const lines = source.slice(0, declarationOffset).split("\n");
  let index = lines.length - 1;
  if (lines[index].trim() === "") {
    index -= 1;
  }
  while (index >= 0 && /^\s*#\[[^\]]+\]\s*$/u.test(lines[index])) {
    index -= 1;
  }

  const doc = [];
  while (index >= 0 && /^\s*\/\/\//u.test(lines[index])) {
    doc.unshift(lines[index]);
    index -= 1;
  }
  return doc.join("\n");
}

function isExecutableRustdocFence(line) {
  const match = RUSTDOC_FENCE.exec(line);
  if (match === null || match.groups?.info === undefined) {
    return match !== null;
  }

  const attributes = match.groups.info.split(",").map((value) => value.trim());
  if (attributes[0] === "rust") {
    attributes.shift();
  }
  return attributes.every((attribute) =>
    EXECUTABLE_RUSTDOC_ATTRIBUTES.has(attribute),
  );
}

function fencedExample(doc, marker) {
  const lines = doc.split("\n");
  const markerIndex = lines.findIndex((line) =>
    line.includes(`# // public-api-doctest: ${marker}`),
  );
  if (markerIndex === -1) {
    return null;
  }

  const fenceIndexes = lines
    .map((line, index) => (isExecutableRustdocFence(line) ? index : -1))
    .filter((index) => index !== -1);
  const before = fenceIndexes.filter((index) => index < markerIndex);
  const closing = fenceIndexes.find((index) => index > markerIndex);
  if (before.length % 2 !== 1 || closing === undefined) {
    return null;
  }

  const opening = before.at(-1);
  return lines
    .slice(opening + 1, closing)
    .map((line) => line.replace(/^\s*\/\/\/ ?/u, ""))
    .join("\n");
}

function executableLines(example) {
  return example
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !DOCTEST_MARKER.test(line))
    .map((line) =>
      line === "#"
        ? ""
        : line.startsWith("# ")
          ? line.slice(2).trimStart()
          : line,
    )
    .filter((line) => line !== "" && !line.startsWith("//"));
}

function rustJobRunsBlockingCommand(workflow, command, policy) {
  let document;
  try {
    document = parse(workflow);
  } catch (error) {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_CI_INVALID",
      `.github/workflows/ci.yml is not valid YAML: ${error.message}`,
    );
  }

  const rustJob = document?.jobs?.rust;
  const steps = rustJob?.steps;
  const commandStep = Array.isArray(steps)
    ? steps.find(
        (step) =>
          typeof step?.run === "string" && step.run.trim() === command,
      )
    : undefined;
  if (commandStep === undefined) {
    return false;
  }

  if (Object.hasOwn(rustJob, "if")) {
    throw new PublicApiDoctestPolicyError(
      policy.disabledCode,
      `the Rust job containing the required ${policy.label} command must not have an execution guard`,
    );
  }
  if (Object.hasOwn(commandStep, "if")) {
    throw new PublicApiDoctestPolicyError(
      policy.disabledCode,
      `the required ${policy.label} step must not have an execution guard`,
    );
  }
  if (
    Object.hasOwn(rustJob, "continue-on-error") &&
    rustJob["continue-on-error"] !== false
  ) {
    throw new PublicApiDoctestPolicyError(
      policy.nonBlockingCode,
      `the Rust job containing the required ${policy.label} command must be blocking`,
    );
  }
  if (
    Object.hasOwn(commandStep, "continue-on-error") &&
    commandStep["continue-on-error"] !== false
  ) {
    throw new PublicApiDoctestPolicyError(
      policy.nonBlockingCode,
      `the required ${policy.label} step must be blocking`,
    );
  }

  return true;
}

function rustJobRunsDoctests(workflow) {
  return rustJobRunsBlockingCommand(workflow, DOCTEST_COMMAND, {
    disabledCode: "E_API_DOCTEST_CI_DISABLED",
    nonBlockingCode: "E_API_DOCTEST_CI_NON_BLOCKING",
    label: "doctest",
  });
}

function rustJobRunsWarningDenyingRustdoc(workflow) {
  return rustJobRunsBlockingCommand(workflow, RUSTDOC_COMMAND, {
    disabledCode: "E_API_RUSTDOC_CI_DISABLED",
    nonBlockingCode: "E_API_RUSTDOC_CI_NON_BLOCKING",
    label: "rustdoc",
  });
}

function releasePrepRunsWarningDenyingRustdoc(releasePrep) {
  return releasePrep
    .split("\n")
    .some((line) => line.trim() === RUSTDOC_COMMAND);
}

export function validatePublicApiDoctestPolicy(snapshot) {
  for (const [file, marker, declaration, invocation] of APIS) {
    const count = markerCount(snapshot[file], marker);
    const doc = rustdocBefore(snapshot[file], declaration);
    const example = fencedExample(doc, marker);
    if (count === 0 || example === null) {
      throw new PublicApiDoctestPolicyError(
        "E_API_DOCTEST_MISSING",
        `${file}'s ${declaration} docs must contain the fenced ${marker} public API doctest marker`,
      );
    }
    if (count > 1) {
      throw new PublicApiDoctestPolicyError(
        "E_API_DOCTEST_DUPLICATE",
        `${file} contains ${count} ${marker} public API doctest markers`,
      );
    }

    const executable = executableLines(example);
    if (!executable.some((line) => line.includes(invocation))) {
      throw new PublicApiDoctestPolicyError(
        "E_API_DOCTEST_ORACLE_MISSING",
        `${marker} doctest must invoke \`${invocation}\` in executable code`,
      );
    }
    if (!executable.some((line) => ASSERTION.test(line))) {
      throw new PublicApiDoctestPolicyError(
        "E_API_DOCTEST_ORACLE_MISSING",
        `${marker} doctest must contain an executable assertion`,
      );
    }
  }

  if (!rustJobRunsDoctests(snapshot.workflow)) {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_CI_MISSING",
      `.github/workflows/ci.yml's Rust job must run \`${DOCTEST_COMMAND}\` as an explicit step`,
    );
  }
  if (!rustJobRunsWarningDenyingRustdoc(snapshot.workflow)) {
    throw new PublicApiDoctestPolicyError(
      "E_API_RUSTDOC_CI_MISSING",
      `.github/workflows/ci.yml's Rust job must run \`${RUSTDOC_COMMAND}\` as an explicit step`,
    );
  }
  if (!releasePrepRunsWarningDenyingRustdoc(snapshot.releasePrep)) {
    throw new PublicApiDoctestPolicyError(
      "E_API_RUSTDOC_RELEASE_MISSING",
      `scripts/release-prep.sh must run \`${RUSTDOC_COMMAND}\` as an explicit command`,
    );
  }
}

function readExpectedInput(root, relativePath) {
  try {
    return readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_INPUT",
      `${relativePath}: cannot read expected policy input`,
    );
  }
}

function readSnapshot(root) {
  return Object.fromEntries(
    Object.entries(INPUT_PATHS).map(([key, relativePath]) => [
      key,
      readExpectedInput(root, relativePath),
    ]),
  );
}

function parseArguments(argv) {
  if (argv.length === 0) {
    return repositoryRoot;
  }
  if (argv.length === 2 && argv[0] === "--root") {
    return path.resolve(argv[1]);
  }
  throw new PublicApiDoctestPolicyError(
    "E_API_DOCTEST_USAGE",
    "usage: scripts/check-public-api-doctests.mjs [--root PATH]",
  );
}

function main() {
  try {
    const root = parseArguments(process.argv.slice(2));
    validatePublicApiDoctestPolicy(readSnapshot(root));
    console.log("check-public-api-doctests: policy satisfied");
  } catch (error) {
    if (error instanceof PublicApiDoctestPolicyError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
