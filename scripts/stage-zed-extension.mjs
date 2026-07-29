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

import { parse as parseToml } from "smol-toml";

export const ZED_SERVER_NOT_FOUND_CATEGORY = "colorful/server-not-found";
export const ZED_PACKAGE_FILES = [
  "Cargo.lock",
  "Cargo.toml",
  "LICENSE",
  "README.md",
  "extension.toml",
  "src/lib.rs",
];

function requiredTomlString(value, path) {
  assert.equal(typeof value, "string", `missing TOML string ${path}`);
  return value;
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

  const manifest = parseToml(
    readFileSync(path.join(packageRoot, "extension.toml"), "utf8"),
  );
  const cargo = parseToml(
    readFileSync(path.join(packageRoot, "Cargo.toml"), "utf8"),
  );
  const workspace = parseToml(
    readFileSync(path.join(repositoryRoot, "Cargo.toml"), "utf8"),
  );
  const source = readFileSync(path.join(packageRoot, "src/lib.rs"), "utf8");

  assert.equal(requiredTomlString(manifest.id, "id"), "colorful-language");
  assert.equal(requiredTomlString(manifest.name, "name"), "Colorful Language");
  assert.equal(manifest.schema_version, 1, "Zed package must use manifest schema 1");
  const server = manifest.language_servers?.["colorful-lsp"];
  assert.deepEqual(
    server?.languages?.toSorted(),
    ["Markdown", "Plain Text"],
    "Zed package must attach to Markdown and Plain Text exactly once",
  );
  assert.equal(server?.language_ids?.Markdown, "markdown");
  assert.equal(server?.language_ids?.["Plain Text"], "plaintext");

  const extensionVersion = requiredTomlString(manifest.version, "version");
  assert.equal(
    requiredTomlString(cargo.package?.version, "package.version"),
    extensionVersion,
  );
  assert.equal(
    requiredTomlString(
      workspace.workspace?.package?.version,
      "workspace.package.version",
    ),
    extensionVersion,
  );
  assert.equal(
    readFileSync(path.join(packageRoot, "LICENSE"), "utf8"),
    readFileSync(path.join(repositoryRoot, "LICENSE"), "utf8"),
    "staged Zed license must equal the repository license",
  );
  assert.ok(
    source.includes(
      `const SERVER_NOT_FOUND_CATEGORY: &str = "${ZED_SERVER_NOT_FOUND_CATEGORY}";`,
    ),
    "staged Zed source must expose the documented missing-server category",
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
