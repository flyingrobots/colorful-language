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
const RUSTDOC_FENCE = /^\s*\/\/\/ ```(?:rust)?\s*$/u;
const ASSERTION = /\bassert(?:_eq|_matches|_ne)?!\s*\(/u;

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

function fencedExample(doc, marker) {
  const lines = doc.split("\n");
  const markerIndex = lines.findIndex((line) =>
    line.includes(`# // public-api-doctest: ${marker}`),
  );
  if (markerIndex === -1) {
    return null;
  }

  const fenceIndexes = lines
    .map((line, index) => (RUSTDOC_FENCE.test(line) ? index : -1))
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
    .filter(
      (line) =>
        line !== "" && !line.startsWith("#") && !line.startsWith("//"),
    );
}

function rustJobRunsDoctests(workflow) {
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
  const doctestStep = Array.isArray(steps)
    ? steps.find(
        (step) =>
          typeof step?.run === "string" &&
          step.run.trim() === DOCTEST_COMMAND,
      )
    : undefined;
  if (doctestStep === undefined) {
    return false;
  }

  if (Object.hasOwn(rustJob, "if")) {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_CI_DISABLED",
      "the Rust job containing the required doctest command must not have an execution guard",
    );
  }
  if (Object.hasOwn(doctestStep, "if")) {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_CI_DISABLED",
      "the required doctest step must not have an execution guard",
    );
  }
  if (
    Object.hasOwn(rustJob, "continue-on-error") &&
    rustJob["continue-on-error"] !== false
  ) {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_CI_NON_BLOCKING",
      "the Rust job containing the required doctest command must be blocking",
    );
  }
  if (
    Object.hasOwn(doctestStep, "continue-on-error") &&
    doctestStep["continue-on-error"] !== false
  ) {
    throw new PublicApiDoctestPolicyError(
      "E_API_DOCTEST_CI_NON_BLOCKING",
      "the required doctest step must be blocking",
    );
  }

  return true;
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
}

function readSnapshot(root) {
  return {
    core: readFileSync(
      path.join(root, "crates/colorful-core/src/lib.rs"),
      "utf8",
    ),
    projection: readFileSync(
      path.join(root, "crates/colorful-projection/src/lib.rs"),
      "utf8",
    ),
    vocabulary: readFileSync(
      path.join(root, "crates/colorful-ir/src/vocabulary.rs"),
      "utf8",
    ),
    workflow: readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"),
  };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
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
