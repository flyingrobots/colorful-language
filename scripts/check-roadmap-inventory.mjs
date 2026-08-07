#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { validateArchitectureAccountability } from "./roadmap-accountability-policy.mjs";
import { createRoadmapInventoryRun } from "./roadmap-inventory-runner.mjs";

const PRIMARY_MARKER =
  /^<!--\s*roadmap-primary:\s*([\s\S]*?)-->$/u;
const PRIMARY_MARKER_CANDIDATE = /^<!--\s*roadmap-primary\b/u;
const VALID_MARKER = /^(active|parked|delivered)((?:\s+#\d+)+)$/u;
const ACTIVE_DISPOSITIONS = new Set(["active", "parked"]);

export class InventoryError extends Error {
  constructor(category, location, detail) {
    super(`${category}: ${location}: ${detail}`);
    this.name = "InventoryError";
    this.category = category;
  }
}

function fail(category, location, detail) {
  throw new InventoryError(category, location, detail);
}

function issueLabels(issue) {
  if (!Array.isArray(issue.labels)) {
    return [];
  }
  return issue.labels.map((label) =>
    typeof label === "string" ? label : label?.name,
  );
}

function normalizeIssues(issues, issuePath, closingIssueNumbers) {
  if (!Array.isArray(issues)) {
    fail(
      "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
      issuePath,
      "expected a JSON array of issues",
    );
  }

  const byNumber = new Map();
  for (const [index, issue] of issues.entries()) {
    const location = `${issuePath}:issues[${index}]`;
    if (
      !Number.isSafeInteger(issue?.number) ||
      issue.number <= 0 ||
      !["OPEN", "CLOSED"].includes(issue?.state)
    ) {
      fail(
        "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
        location,
        "expected a positive issue number and OPEN or CLOSED state",
      );
    }
    if (byNumber.has(issue.number)) {
      fail(
        "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
        location,
        `duplicate issue #${issue.number}`,
      );
    }

    byNumber.set(issue.number, {
      ...issue,
      labels: issueLabels(issue),
      state: closingIssueNumbers.has(issue.number) ? "CLOSED" : issue.state,
      snapshotIndex: index,
    });
  }
  return byNumber;
}

export function parseRoadmapInventory(
  roadmap,
  { roadmapPath = "ROADMAP.md" } = {},
) {
  const tree = validateArchitectureAccountability(
    roadmap,
    roadmapPath,
    fail,
  );
  const inventory = new Map();
  const markerNodes = [];
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node.type === "html" &&
      PRIMARY_MARKER_CANDIDATE.test(node.value)
    ) {
      markerNodes.push(node);
    }
    if (Array.isArray(node.children)) {
      stack.push(...node.children);
    }
  }
  markerNodes.sort(
    (left, right) =>
      left.position.start.offset - right.position.start.offset,
  );

  for (const node of markerNodes) {
    const match = node.value.match(PRIMARY_MARKER);
    const location = `${roadmapPath}:${node.position.start.line}`;
    if (match === null) {
      fail(
        "E_ROADMAP_INVALID_MARKER",
        location,
        "roadmap-primary comment must end at its HTML comment closer",
      );
    }
    const marker = match[1].trim();
    const parsed = marker.match(VALID_MARKER);
    if (!parsed) {
      fail(
        "E_ROADMAP_INVALID_MARKER",
        location,
        `expected "<active|parked|delivered> #NN [#NN ...]", found "${marker}"`,
      );
    }

    const disposition = parsed[1];
    const numbers = parsed[2]
      .trim()
      .split(/\s+/u)
      .map((number) => Number.parseInt(number.slice(1), 10));
    for (const number of numbers) {
      const previous = inventory.get(number);
      if (previous) {
        fail(
          "E_ROADMAP_DUPLICATE_PRIMARY",
          location,
          `issue #${number} already has a primary home at ${previous.location}`,
        );
      }
      inventory.set(number, { disposition, location });
    }
  }

  return inventory;
}

export function validateRoadmapInventory({
  roadmap,
  issues,
  roadmapPath = "ROADMAP.md",
  issuePath = "issues.json",
  closingIssueNumbers = new Set(),
}) {
  const inventory = parseRoadmapInventory(roadmap, { roadmapPath });
  const byNumber = normalizeIssues(issues, issuePath, closingIssueNumbers);

  for (const [number, primary] of inventory) {
    const issue = byNumber.get(number);
    if (!issue) {
      fail(
        "E_ROADMAP_UNKNOWN_ISSUE",
        primary.location,
        `primary marker names issue #${number}, which is absent from ${issuePath}`,
      );
    }
    if (!issue.labels.includes("slice") || issue.labels.includes("epic")) {
      fail(
        "E_ROADMAP_NON_SLICE_PRIMARY",
        primary.location,
        `issue #${number} is not a non-epic slice`,
      );
    }
    if (
      issue.state === "CLOSED" &&
      ACTIVE_DISPOSITIONS.has(primary.disposition)
    ) {
      fail(
        "E_ROADMAP_CLOSED_ACTIVE",
        primary.location,
        `closed issue #${number} is marked ${primary.disposition}; use delivered`,
      );
    }
    if (issue.state === "OPEN" && primary.disposition === "delivered") {
      fail(
        "E_ROADMAP_OPEN_DELIVERED",
        primary.location,
        `open issue #${number} is marked delivered`,
      );
    }
  }

  const closingSlices = [...closingIssueNumbers]
    .map((number) => byNumber.get(number))
    .filter(
      (issue) =>
        issue?.labels.includes("slice") && !issue.labels.includes("epic"),
    )
    .sort((left, right) => left.number - right.number);
  for (const issue of closingSlices) {
    if (!inventory.has(issue.number)) {
      fail(
        "E_ROADMAP_MISSING_DELIVERED",
        `${issuePath}:issues[${issue.snapshotIndex}]`,
        `slice #${issue.number} is closed by this pull request but has no delivered primary marker in ${roadmapPath}`,
      );
    }
  }

  const openSlices = [...byNumber.values()]
    .filter(
      (issue) =>
        issue.state === "OPEN" &&
        issue.labels.includes("slice") &&
        !issue.labels.includes("epic"),
    )
    .sort((left, right) => left.number - right.number);
  for (const issue of openSlices) {
    if (!inventory.has(issue.number)) {
      fail(
        "E_ROADMAP_MISSING_OPEN",
        `${issuePath}:issues[${issue.snapshotIndex}]`,
        `open non-epic slice #${issue.number} has no primary active or parked disposition in ${roadmapPath}`,
      );
    }
  }

  return {
    issueCount: byNumber.size,
    openSliceCount: openSlices.length,
    primaryCount: inventory.size,
  };
}

export function closingIssueNumbersForRepository(references, repo) {
  const normalizedRepository = repo.toLowerCase();
  return new Set(
    references
      .filter((issue) => {
        const owner = issue?.repository?.owner?.login;
        const name = issue?.repository?.name;
        return (
          typeof owner === "string" &&
          typeof name === "string" &&
          `${owner}/${name}`.toLowerCase() === normalizedRepository
        );
      })
      .map((issue) => issue.number),
  );
}

export const run = createRoadmapInventoryRun({
  InventoryError,
  closingIssueNumbersForRepository,
  parseRoadmapInventory,
  validateRoadmapInventory,
});

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
