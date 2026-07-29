#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ZED_SERVER_NOT_FOUND_CATEGORY = "colorful/server-not-found";
export const ZED_PACKAGE_FILES = [
  "Cargo.lock",
  "Cargo.toml",
  "LICENSE",
  "README.md",
  "extension.toml",
  "src/lib.rs",
];

function readTomlString(source, key) {
  const escaped = key.replaceAll(".", "\\.");
  const match = source.match(
    new RegExp(`^${escaped}\\s*=\\s*"([^"]+)"\\s*$`, "mu"),
  );
  assert.ok(match, `missing TOML string ${key}`);
  return match[1];
}

function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...inventory(absolute, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`unsupported Zed package entry: ${relative}`);
    }
  }
  return files.sort();
}

export function validateZedSourcePackage(repositoryRoot, packageRoot) {
  assert.deepEqual(inventory(packageRoot), ZED_PACKAGE_FILES);

  const manifest = readFileSync(
    path.join(packageRoot, "extension.toml"),
    "utf8",
  );
  const cargo = readFileSync(path.join(packageRoot, "Cargo.toml"), "utf8");
  const workspace = readFileSync(path.join(repositoryRoot, "Cargo.toml"), "utf8");
  const source = readFileSync(path.join(packageRoot, "src/lib.rs"), "utf8");

  assert.equal(readTomlString(manifest, "id"), "colorful-language");
  assert.equal(readTomlString(manifest, "name"), "Colorful Language");
  assert.match(
    manifest,
    /^schema_version\s*=\s*1\s*$/mu,
    "Zed package must use manifest schema 1",
  );
  assert.match(
    manifest,
    /^languages\s*=\s*\["Markdown", "Plain Text"\]\s*$/mu,
    "Zed package must attach to Markdown and Plain Text",
  );
  assert.match(manifest, /^Markdown\s*=\s*"markdown"\s*$/mu);
  assert.match(manifest, /^"Plain Text"\s*=\s*"plaintext"\s*$/mu);

  const extensionVersion = readTomlString(manifest, "version");
  assert.equal(readTomlString(cargo, "version"), extensionVersion);
  assert.equal(readTomlString(workspace, "version"), extensionVersion);
  assert.equal(
    readFileSync(path.join(packageRoot, "LICENSE"), "utf8"),
    readFileSync(path.join(repositoryRoot, "LICENSE"), "utf8"),
    "staged Zed license must equal the repository license",
  );
  assert.match(
    source,
    new RegExp(
      `const SERVER_NOT_FOUND_CATEGORY: &str =\\s*"${ZED_SERVER_NOT_FOUND_CATEGORY.replace("/", "\\/")}";`,
      "u",
    ),
  );
  assert.ok(
    statSync(path.join(packageRoot, "Cargo.lock")).size > 0,
    "staged Zed lockfile must not be empty",
  );

  return {
    id: "colorful-language",
    version: extensionVersion,
    files: ZED_PACKAGE_FILES,
    missingServerCategory: ZED_SERVER_NOT_FOUND_CATEGORY,
  };
}

export function stageZedExtension(repositoryRoot, destination) {
  const sourceRoot = path.join(repositoryRoot, "editors/zed");
  mkdirSync(path.join(destination, "src"), { recursive: true });
  const sources = new Map([
    ["Cargo.lock", path.join(sourceRoot, "Cargo.lock")],
    ["Cargo.toml", path.join(sourceRoot, "Cargo.toml")],
    ["LICENSE", path.join(repositoryRoot, "LICENSE")],
    ["README.md", path.join(sourceRoot, "README.md")],
    ["extension.toml", path.join(sourceRoot, "extension.toml")],
    ["src/lib.rs", path.join(sourceRoot, "src/lib.rs")],
  ]);
  for (const [relative, source] of sources) {
    copyFileSync(source, path.join(destination, relative));
  }
  return validateZedSourcePackage(repositoryRoot, destination);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [destination] = process.argv.slice(2);
  if (!destination) {
    throw new Error("usage: scripts/stage-zed-extension.mjs <destination>");
  }
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = stageZedExtension(repositoryRoot, path.resolve(destination));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
