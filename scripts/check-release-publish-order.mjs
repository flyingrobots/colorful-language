#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function duplicateNames(order) {
  const seen = new Set();
  const duplicates = new Set();
  for (const name of order) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }
  return [...duplicates].sort();
}

export function extractProfileOrder(source) {
  const lines = source.split("\n");
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s+packages:\s*$/u.test(line));
  if (starts.length !== 1) {
    throw new Error(
      `release profile must contain exactly one packages list; found ${starts.length}`,
    );
  }

  const { line, index } = starts[0];
  const listIndent = line.match(/^\s*/u)[0].length + 2;
  const order = [];
  for (const candidate of lines.slice(index + 1)) {
    if (candidate.trim() === "") {
      continue;
    }
    const indent = candidate.match(/^\s*/u)[0].length;
    if (indent < listIndent) {
      break;
    }
    const entry = candidate.match(/^\s*-\s+([a-z0-9-]+)\s*$/u);
    if (indent !== listIndent || entry === null) {
      throw new Error(`invalid release-profile package entry: ${candidate.trim()}`);
    }
    order.push(entry[1]);
  }
  return order;
}

export function extractWorkflowOrder(source) {
  const matches = [
    ...source.matchAll(/for\s+crate\s+in\s+([^;\n]+);\s*do/gu),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `release workflow must contain exactly one crate publish loop; found ${matches.length}`,
    );
  }
  return matches[0][1].trim().split(/\s+/u);
}

export function validateMatchingOrders(profileOrder, workflowOrder) {
  if (
    profileOrder.length === workflowOrder.length &&
    profileOrder.every((name, index) => name === workflowOrder[index])
  ) {
    return [];
  }
  return [
    `release profile and workflow publish orders differ: profile=${profileOrder.join(",")} workflow=${workflowOrder.join(",")}`,
  ];
}

export function validatePublishOrder(order, packages) {
  const errors = [];
  const workspaceNames = new Set(packages.map(({ name }) => name));
  const publishablePackages = packages.filter(
    ({ publish }) =>
      publish === undefined ||
      publish === null ||
      publish.includes("crates-io"),
  );
  const publishableNames = new Set(
    publishablePackages.map(({ name }) => name),
  );
  const orderNames = new Set(order);

  for (const duplicate of duplicateNames(order)) {
    errors.push(`publish order repeats ${duplicate}`);
  }
  for (const name of [...publishableNames].sort()) {
    if (!orderNames.has(name)) {
      errors.push(`publish order is missing publishable workspace package ${name}`);
    }
  }
  for (const name of [...orderNames].sort()) {
    if (!publishableNames.has(name)) {
      errors.push(`publish order contains non-publishable workspace package ${name}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  const positions = new Map(order.map((name, index) => [name, index]));
  for (const packageMetadata of [...publishablePackages].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const internalDependencies = packageMetadata.dependencies
      .filter(({ name }) => workspaceNames.has(name))
      .sort((left, right) =>
        `${left.name}:${left.kind ?? "normal"}`.localeCompare(
          `${right.name}:${right.kind ?? "normal"}`,
        ),
      );
    for (const dependency of internalDependencies) {
      if (!publishableNames.has(dependency.name)) {
        errors.push(
          `${packageMetadata.name} depends on non-publishable workspace package ${dependency.name} (${dependency.kind ?? "normal"})`,
        );
        continue;
      }
      if (
        positions.get(dependency.name) >= positions.get(packageMetadata.name)
      ) {
        errors.push(
          `${packageMetadata.name} depends on ${dependency.name} (${dependency.kind ?? "normal"}), but ${dependency.name} does not precede ${packageMetadata.name}`,
        );
      }
    }
  }
  return errors;
}

function main() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--locked", "--no-deps"],
      { cwd: ROOT, encoding: "utf8" },
    ),
  );
  const profileOrder = extractProfileOrder(
    readFileSync(resolve(ROOT, ".continuum/release.yml"), "utf8"),
  );
  const workflowOrder = extractWorkflowOrder(
    readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8"),
  );
  const errors = [
    ...validateMatchingOrders(profileOrder, workflowOrder),
    ...validatePublishOrder(profileOrder, metadata.packages),
  ];
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`check-release-publish-order: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-release-publish-order passed: ${profileOrder.length} package(s) in dependency order`,
  );
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
