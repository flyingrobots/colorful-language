#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  ConsumerError,
  consumeIr,
  loadProfiles,
} from "../src/index.mjs";

function usage() {
  process.stderr.write(
    "usage: independent-ir-report --format ir --source FILE " +
      "--input FILE --profiles DIR\n",
  );
  process.exit(2);
}

function isFileSystemError(error) {
  return (
    error instanceof Error &&
    typeof error.code === "string" &&
    typeof error.syscall === "string"
  );
}

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || value === undefined || options.has(name)) {
    usage();
  }
  options.set(name, value);
}
if (
  options.size !== 4 ||
  options.get("--format") !== "ir" ||
  !options.has("--source") ||
  !options.has("--input") ||
  !options.has("--profiles")
) {
  usage();
}

try {
  const report = consumeIr({
    source: readFileSync(options.get("--source")),
    artifactJson: readFileSync(options.get("--input"), "utf8"),
    profiles: loadProfiles(options.get("--profiles")),
  });
  process.stdout.write(report);
} catch (error) {
  if (error instanceof ConsumerError) {
    process.stderr.write(
      `independent-ir-report: ${error.code}: ${error.message}\n`,
    );
    process.exit(1);
  }
  if (isFileSystemError(error)) {
    process.stderr.write(
      `independent-ir-report: E_IO: ${error.message.replaceAll("\n", " ")}\n`,
    );
    process.exit(1);
  }
  throw error;
}
