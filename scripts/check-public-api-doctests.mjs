#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "yaml";

const APIS = Object.freeze([
  ["core", "parser", "pub trait Parser"],
  ["core", "annotator", "pub trait Annotator"],
  ["core", "analyzer", "pub trait Analyzer"],
  ["projection", "ir-projection", "pub fn build_document"],
  ["vocabulary", "vocabulary", "pub fn visual_role"],
]);
const DOCTEST_COMMAND = "cargo test --doc --workspace --locked";
const RUSTDOC_FENCE = /^\s*\/\/\/ ```(?:rust)?\s*$/gmu;

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

function markerIsInsideFence(doc, marker) {
  const markerOffset = doc.indexOf(`# // public-api-doctest: ${marker}`);
  if (markerOffset === -1) {
    return false;
  }
  const fencesBefore = [...doc.slice(0, markerOffset).matchAll(RUSTDOC_FENCE)]
    .length;
  const fencesAfter = [...doc.slice(markerOffset).matchAll(RUSTDOC_FENCE)]
    .length;
  return fencesBefore % 2 === 1 && fencesAfter > 0;
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

  const steps = document?.jobs?.rust?.steps;
  return (
    Array.isArray(steps) &&
    steps.some(
      (step) =>
        typeof step?.run === "string" &&
        step.run.trim() === DOCTEST_COMMAND,
    )
  );
}

export function validatePublicApiDoctestPolicy(snapshot) {
  for (const [file, marker, declaration] of APIS) {
    const count = markerCount(snapshot[file], marker);
    const doc = rustdocBefore(snapshot[file], declaration);
    if (count === 0 || !markerIsInsideFence(doc, marker)) {
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
