#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PRIMARY_MARKER = /<!--\s*roadmap-primary:\s*([\s\S]*?)-->/gu;
const VALID_MARKER = /^(active|parked|delivered)((?:\s+#\d+)+)$/u;
const ACCOUNTABILITY_HEADING = "## Architecture accountability";
const MARKDOWN_DELIMITER_CELL = /^:?-+:?$/u;
const NONCANONICAL_MECHANISM_MARKUP = new Set([
  "*",
  "_",
  "~",
  "[",
  "]",
  "<",
  ">",
]);
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

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
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

function markdownTableMechanism(line) {
  const firstNonWhitespace = line.search(/\S/u);
  if (firstNonWhitespace === -1 || line[firstNonWhitespace] !== "|") {
    return undefined;
  }

  for (let index = firstNonWhitespace + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
    } else if (line[index] === "|") {
      return line.slice(firstNonWhitespace + 1, index).trim();
    }
  }
  return undefined;
}

function canonicalMechanismIdentity(mechanism, location) {
  let identity = "";

  for (let index = 0; index < mechanism.length; index += 1) {
    const character = mechanism[index];
    if (character === "\\") {
      if (index + 1 === mechanism.length) {
        fail(
          "E_ROADMAP_NONCANONICAL_MECHANISM",
          location,
          "mechanism ends with an incomplete Markdown escape",
        );
      }
      identity += mechanism[index + 1];
      index += 1;
      continue;
    }
    if (character === "`") {
      let delimiterLength = 1;
      while (mechanism[index + delimiterLength] === "`") {
        delimiterLength += 1;
      }
      const delimiter = "`".repeat(delimiterLength);
      const contentStart = index + delimiterLength;
      const contentEnd = mechanism.indexOf(delimiter, contentStart);
      if (contentEnd === -1) {
        fail(
          "E_ROADMAP_NONCANONICAL_MECHANISM",
          location,
          "mechanism contains an unterminated inline-code span",
        );
      }
      identity += mechanism.slice(contentStart, contentEnd);
      index = contentEnd + delimiterLength - 1;
      continue;
    }
    if (NONCANONICAL_MECHANISM_MARKUP.has(character)) {
      fail(
        "E_ROADMAP_NONCANONICAL_MECHANISM",
        location,
        "use plain text, escaped punctuation, or inline code in mechanism cells",
      );
    }
    identity += character;
  }

  return identity.replace(/\s+/gu, " ").trim();
}

function validateArchitectureAccountability(roadmap, roadmapPath) {
  const mechanisms = new Map();
  let inAccountabilitySection = false;
  let accountabilityTableState = "searching";
  let fenceCharacter;
  let fenceLength = 0;
  let inHtmlComment = false;
  let foundAccountabilitySection = false;
  let foundAccountabilityTable = false;

  for (const [index, line] of roadmap.split("\n").entries()) {
    if (fenceCharacter !== undefined) {
      const closingFence = line.match(
        /^ {0,3}(`{3,}|~{3,})[ \t]*$/u,
      );
      if (
        closingFence !== null &&
        closingFence[1][0] === fenceCharacter &&
        closingFence[1].length >= fenceLength
      ) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (inHtmlComment) {
      if (line.includes("-->")) {
        inHtmlComment = false;
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,}).*$/u);
    if (openingFence !== null) {
      fenceCharacter = openingFence[1][0];
      fenceLength = openingFence[1].length;
      continue;
    }
    const commentStart = line.indexOf("<!--");
    if (
      commentStart !== -1 &&
      line.slice(0, commentStart).trim().length === 0
    ) {
      inHtmlComment = !line.slice(commentStart + 4).includes("-->");
      continue;
    }

    if (line.trim() === ACCOUNTABILITY_HEADING) {
      inAccountabilitySection = true;
      foundAccountabilitySection = true;
      continue;
    }
    if (inAccountabilitySection && /^##\s+/u.test(line.trimStart())) {
      break;
    }
    if (!inAccountabilitySection) {
      continue;
    }

    const mechanism = markdownTableMechanism(line);
    if (accountabilityTableState === "searching") {
      if (mechanism === "Mechanism") {
        accountabilityTableState = "delimiter";
      }
      continue;
    }
    if (accountabilityTableState === "delimiter") {
      accountabilityTableState =
        mechanism !== undefined && MARKDOWN_DELIMITER_CELL.test(mechanism)
          ? "rows"
          : "searching";
      continue;
    }
    if (accountabilityTableState === "complete") {
      continue;
    }
    if (mechanism === undefined) {
      accountabilityTableState = "complete";
      continue;
    }

    const location = `${roadmapPath}:${index + 1}`;
    const identity = canonicalMechanismIdentity(mechanism, location);
    foundAccountabilityTable = true;
    const previous = mechanisms.get(identity);
    if (previous !== undefined) {
      fail(
        "E_ROADMAP_DUPLICATE_MECHANISM",
        location,
        `architecture-accountability mechanism "${identity}" already appears at ${previous}`,
      );
    }
    mechanisms.set(identity, location);
  }

  if (!foundAccountabilitySection) {
    fail(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_SECTION",
      roadmapPath,
      `expected canonical heading "${ACCOUNTABILITY_HEADING}"`,
    );
  }
  if (!foundAccountabilityTable) {
    fail(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE",
      roadmapPath,
      'expected a table whose first header cell is "Mechanism"',
    );
  }
}

export function parseRoadmapInventory(
  roadmap,
  { roadmapPath = "ROADMAP.md" } = {},
) {
  validateArchitectureAccountability(roadmap, roadmapPath);
  const inventory = new Map();

  for (const match of roadmap.matchAll(PRIMARY_MARKER)) {
    const marker = match[1].trim();
    const location = `${roadmapPath}:${lineNumber(roadmap, match.index)}`;
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

function parseArguments(argv) {
  const options = {
    roadmapPath: "ROADMAP.md",
    issuePath: undefined,
    live: false,
    repo: process.env.GITHUB_REPOSITORY,
    closingPr: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const optionValue = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(
          "E_ROADMAP_USAGE",
          "arguments",
          `${argument} requires a value`,
        );
      }
      index += 1;
      return value;
    };
    if (argument === "--live") {
      options.live = true;
    } else if (argument === "--roadmap") {
      options.roadmapPath = optionValue();
    } else if (argument === "--issues") {
      options.issuePath = optionValue();
    } else if (argument === "--repo") {
      options.repo = optionValue();
    } else if (argument === "--closing-pr") {
      options.closingPr = optionValue();
    } else {
      fail(
        "E_ROADMAP_USAGE",
        "arguments",
        `unknown or incomplete argument "${argument ?? ""}"`,
      );
    }
  }

  if (options.live && options.issuePath) {
    fail(
      "E_ROADMAP_USAGE",
      "arguments",
      "--live and --issues are mutually exclusive",
    );
  }
  if (options.closingPr && !options.live) {
    fail(
      "E_ROADMAP_USAGE",
      "arguments",
      "--closing-pr requires --live",
    );
  }
  if (options.live && !options.repo) {
    fail(
      "E_ROADMAP_USAGE",
      "arguments",
      "--live requires --repo OWNER/NAME or GITHUB_REPOSITORY",
    );
  }
  if (
    options.closingPr &&
    !/^[1-9]\d*$/u.test(String(options.closingPr))
  ) {
    fail(
      "E_ROADMAP_USAGE",
      "arguments",
      "--closing-pr requires a positive pull-request number",
    );
  }

  return options;
}

function runGitHub(arguments_, description) {
  try {
    return execFileSync("gh", arguments_, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = error?.stderr?.trim();
    fail(
      "E_ROADMAP_GITHUB",
      description,
      stderr || error?.message || "GitHub CLI command failed",
    );
  }
}

function parseJson(source, category, location) {
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(category, location, `invalid JSON: ${error.message}`);
  }
}

function loadLiveIssues(repo) {
  const output = runGitHub(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--limit",
      "10000",
      "--json",
      "number,state,title,labels",
    ],
    `github:${repo}:issues`,
  );
  return parseJson(
    output,
    "E_ROADMAP_GITHUB",
    `github:${repo}:issues`,
  );
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

function loadClosingIssueNumbers(repo, pullRequest) {
  if (!pullRequest) {
    return new Set();
  }
  const output = runGitHub(
    [
      "pr",
      "view",
      String(pullRequest),
      "--repo",
      repo,
      "--json",
      "closingIssuesReferences",
    ],
    `github:${repo}:pulls/${pullRequest}`,
  );
  const parsed = parseJson(
    output,
    "E_ROADMAP_GITHUB",
    `github:${repo}:pulls/${pullRequest}`,
  );
  return closingIssueNumbersForRepository(
    parsed.closingIssuesReferences ?? [],
    repo,
  );
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const roadmapPath = resolve(options.roadmapPath);
  const roadmap = readFileSync(roadmapPath, "utf8");

  if (!options.live && !options.issuePath) {
    const inventory = parseRoadmapInventory(roadmap, {
      roadmapPath: options.roadmapPath,
    });
    process.stdout.write(
      `check-roadmap-inventory: ${inventory.size} primary markers are structurally valid\n`,
    );
    return;
  }

  const issues = options.live
    ? loadLiveIssues(options.repo)
    : parseJson(
        readFileSync(resolve(options.issuePath), "utf8"),
        "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
        options.issuePath,
      );
  const closingIssueNumbers = options.live
    ? loadClosingIssueNumbers(options.repo, options.closingPr)
    : new Set();
  const result = validateRoadmapInventory({
    roadmap,
    issues,
    roadmapPath: options.roadmapPath,
    issuePath: options.live
      ? `github:${options.repo}:issues`
      : options.issuePath,
    closingIssueNumbers,
  });
  process.stdout.write(
    `check-roadmap-inventory: ${result.openSliceCount} open slices and ${result.primaryCount} primary markers agree\n`,
  );
}

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
