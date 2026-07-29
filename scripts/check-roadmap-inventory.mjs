#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PRIMARY_MARKER = /<!--\s*roadmap-primary:\s*([\s\S]*?)-->/gu;
const VALID_MARKER = /^(active|parked|delivered)((?:\s+#\d+)+)$/u;
const ACCOUNTABILITY_HEADING = "## Architecture accountability";
const MARKDOWN_DELIMITER_CELL = /^:?-{3,}:?$/u;
const MARKDOWN_CHARACTER_REFERENCE =
  /^&(?:#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/u;
const UNSUPPORTED_STYLED_MECHANISM_HEADER =
  /^(\*{1,2}|_{1,2}|~~)Mechanism\1$/u;
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

function markdownTableCells(line) {
  const firstNonWhitespace = line.search(/\S/u);
  if (
    firstNonWhitespace === -1 ||
    !/^ {0,3}$/u.test(line.slice(0, firstNonWhitespace)) ||
    line[firstNonWhitespace] !== "|"
  ) {
    return undefined;
  }

  const cells = [];
  let cell = "";
  let closedFirstCell = false;
  for (let index = firstNonWhitespace + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      cell += line[index];
      if (index + 1 < line.length) {
        index += 1;
        cell += line[index];
      }
    } else if (line[index] === "|") {
      cells.push(cell.trim());
      cell = "";
      closedFirstCell = true;
    } else {
      cell += line[index];
    }
  }
  if (!closedFirstCell) {
    return undefined;
  }
  if (cell.trim().length > 0) {
    cells.push(cell.trim());
  }
  return cells;
}

function isNoLeadingPipeTableRow(line) {
  const firstNonWhitespace = line.search(/\S/u);
  if (
    firstNonWhitespace === -1 ||
    !/^ {0,3}$/u.test(line.slice(0, firstNonWhitespace)) ||
    line[firstNonWhitespace] === "|"
  ) {
    return false;
  }

  const content = line.slice(firstNonWhitespace);
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
    } else if (content[index] === "`") {
      let delimiterLength = 1;
      while (content[index + delimiterLength] === "`") {
        delimiterLength += 1;
      }
      const contentEnd = findExactBacktickRun(
        content,
        index + delimiterLength,
        delimiterLength,
      );
      if (contentEnd !== -1) {
        index = contentEnd + delimiterLength - 1;
      }
    } else if (content[index] === "|") {
      return true;
    }
  }
  return false;
}

function isNoLeadingPipeMechanismHeader(line) {
  const firstNonWhitespace = line.search(/\S/u);
  return (
    isNoLeadingPipeTableRow(line) &&
    /^Mechanism[ \t]*\|/u.test(line.slice(firstNonWhitespace))
  );
}

function noLeadingPipeTableCells(line) {
  if (!isNoLeadingPipeTableRow(line)) {
    return undefined;
  }
  const firstNonWhitespace = line.search(/\S/u);
  return markdownTableCells(
    `${line.slice(0, firstNonWhitespace)}|${line.slice(firstNonWhitespace)}`,
  );
}

function isCanonicalAccountabilityHeading(line) {
  return /^ {0,3}## Architecture accountability[ \t]*$/u.test(line);
}

function isAccountabilityHeadingWithClosingHashes(line) {
  return /^ {0,3}## Architecture accountability[ \t]+#+[ \t]*$/u.test(
    line,
  );
}

function isRoadmapLevelTwoHeading(line) {
  const match = line.match(/^ {0,3}##(?:[ \t]+|$)/u);
  if (match === null) {
    return false;
  }
  return !line.slice(match[0].length).startsWith("#");
}

function isAsciiPunctuation(character) {
  const codePoint = character.codePointAt(0);
  return (
    (codePoint >= 33 && codePoint <= 47) ||
    (codePoint >= 58 && codePoint <= 64) ||
    (codePoint >= 91 && codePoint <= 96) ||
    (codePoint >= 123 && codePoint <= 126)
  );
}

function findExactBacktickRun(source, start, length) {
  for (let index = start; index < source.length; ) {
    if (source[index] !== "`") {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (source[index + runLength] === "`") {
      runLength += 1;
    }
    if (runLength === length) {
      return index;
    }
    index += runLength;
  }
  return -1;
}

function stripClosedInlineHtmlComments(line) {
  let visible = "";
  for (let index = 0; index < line.length; ) {
    if (line[index] === "\\") {
      visible += line[index];
      index += 1;
      if (index < line.length) {
        visible += line[index];
        index += 1;
      }
      continue;
    }
    if (line[index] === "`") {
      let delimiterLength = 1;
      while (line[index + delimiterLength] === "`") {
        delimiterLength += 1;
      }
      const contentEnd = findExactBacktickRun(
        line,
        index + delimiterLength,
        delimiterLength,
      );
      if (contentEnd === -1) {
        visible += line.slice(index);
        return { visible, opensMultilineComment: false };
      }
      const spanEnd = contentEnd + delimiterLength;
      visible += line.slice(index, spanEnd);
      index = spanEnd;
      continue;
    }
    if (line.startsWith("<!--", index)) {
      const commentEnd = line.indexOf("-->", index + 4);
      if (commentEnd === -1) {
        return { visible, opensMultilineComment: true };
      }
      index = commentEnd + 3;
      continue;
    }
    visible += line[index];
    index += 1;
  }
  return { visible, opensMultilineComment: false };
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
      if (!isAsciiPunctuation(mechanism[index + 1])) {
        fail(
          "E_ROADMAP_NONCANONICAL_MECHANISM",
          location,
          "Markdown escapes are only valid before ASCII punctuation",
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
      const contentStart = index + delimiterLength;
      const contentEnd = findExactBacktickRun(
        mechanism,
        contentStart,
        delimiterLength,
      );
      if (contentEnd === -1) {
        fail(
          "E_ROADMAP_NONCANONICAL_MECHANISM",
          location,
          "mechanism contains an unterminated inline-code span",
        );
      }
      identity += mechanism
        .slice(contentStart, contentEnd)
        .replaceAll("\\|", "|");
      index = contentEnd + delimiterLength - 1;
      continue;
    }
    if (
      character === "&" &&
      MARKDOWN_CHARACTER_REFERENCE.test(mechanism.slice(index))
    ) {
      fail(
        "E_ROADMAP_NONCANONICAL_MECHANISM",
        location,
        "use the displayed character instead of a Markdown character reference",
      );
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

  const canonical = identity.replace(/\s+/gu, " ").trim().normalize("NFC");
  if (canonical.length === 0) {
    fail(
      "E_ROADMAP_EMPTY_MECHANISM",
      location,
      "mechanism cell must identify an architecture decision",
    );
  }
  return canonical;
}

function displaysMechanismHeader(mechanism, location) {
  try {
    return canonicalMechanismIdentity(mechanism, location) === "Mechanism";
  } catch (error) {
    if (error instanceof InventoryError) {
      return false;
    }
    throw error;
  }
}

function accountabilityHeaderKind(mechanism, location) {
  if (mechanism === "Mechanism") {
    return "canonical";
  }
  if (UNSUPPORTED_STYLED_MECHANISM_HEADER.test(mechanism)) {
    return "unsupported";
  }
  return displaysMechanismHeader(mechanism, location)
    ? "display-equivalent"
    : undefined;
}

function validateArchitectureAccountability(roadmap, roadmapPath) {
  const mechanisms = new Map();
  let inAccountabilitySection = false;
  let accountabilityTableState = "searching";
  let fenceCharacter;
  let fenceLength = 0;
  let inHtmlComment = false;
  let foundAccountabilitySection = false;
  let accountabilitySectionLocation;
  let displayEquivalentAccountabilitySectionLocation;
  let foundAccountabilityTable = false;
  let accountabilityTableLocation;
  let candidateAccountabilityTableLocation;
  let candidateAccountabilityTableColumnCount;
  let candidateAccountabilityHeaderKind;
  let candidateAccountabilityTableHasLeadingPipe;

  for (const [index, rawLine] of roadmap.split("\n").entries()) {
    let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
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
    if (/^(?: {4}|\t)/u.test(line)) {
      if (accountabilityTableState === "rows") {
        accountabilityTableState = "complete";
      } else if (accountabilityTableState === "delimiter") {
        accountabilityTableState = "searching";
        candidateAccountabilityTableLocation = undefined;
        candidateAccountabilityTableColumnCount = undefined;
        candidateAccountabilityHeaderKind = undefined;
        candidateAccountabilityTableHasLeadingPipe = undefined;
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (
      openingFence !== null &&
      (openingFence[1][0] === "~" || !openingFence[2].includes("`"))
    ) {
      if (accountabilityTableState === "rows") {
        accountabilityTableState = "complete";
      } else if (accountabilityTableState === "delimiter") {
        accountabilityTableState = "searching";
        candidateAccountabilityTableLocation = undefined;
        candidateAccountabilityTableColumnCount = undefined;
        candidateAccountabilityHeaderKind = undefined;
        candidateAccountabilityTableHasLeadingPipe = undefined;
      }
      fenceCharacter = openingFence[1][0];
      fenceLength = openingFence[1].length;
      continue;
    }
    if (isCanonicalAccountabilityHeading(line)) {
      const location = `${roadmapPath}:${index + 1}`;
      if (
        foundAccountabilitySection ||
        displayEquivalentAccountabilitySectionLocation !== undefined
      ) {
        const previousLocation =
          accountabilitySectionLocation ??
          displayEquivalentAccountabilitySectionLocation;
        const previousKind =
          accountabilitySectionLocation === undefined
            ? "display-equivalent heading"
            : "canonical heading";
        fail(
          "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
          location,
          `${previousKind} already appears at ${previousLocation}`,
        );
      }
      inAccountabilitySection = true;
      foundAccountabilitySection = true;
      accountabilitySectionLocation = location;
      continue;
    }
    if (isAccountabilityHeadingWithClosingHashes(line)) {
      const location = `${roadmapPath}:${index + 1}`;
      if (
        foundAccountabilitySection ||
        displayEquivalentAccountabilitySectionLocation !== undefined
      ) {
        const previousLocation =
          accountabilitySectionLocation ??
          displayEquivalentAccountabilitySectionLocation;
        const previousKind =
          accountabilitySectionLocation === undefined
            ? "display-equivalent heading"
            : "canonical heading";
        fail(
          "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
          location,
          `${previousKind} already appears at ${previousLocation}`,
        );
      }
      displayEquivalentAccountabilitySectionLocation = location;
      continue;
    }
    const commentScan = stripClosedInlineHtmlComments(line);
    if (commentScan.opensMultilineComment) {
      if (
        markdownTableCells(commentScan.visible) !== undefined ||
        isNoLeadingPipeMechanismHeader(commentScan.visible) ||
        ((accountabilityTableState === "delimiter" ||
          accountabilityTableState === "rows") &&
          isNoLeadingPipeTableRow(commentScan.visible))
      ) {
        fail(
          "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
          `${roadmapPath}:${index + 1}`,
          "a multiline HTML comment cannot begin on an accountability table row",
        );
      }
      if (accountabilityTableState === "rows") {
        accountabilityTableState = "complete";
      } else if (accountabilityTableState === "delimiter") {
        accountabilityTableState = "searching";
        candidateAccountabilityTableLocation = undefined;
        candidateAccountabilityTableColumnCount = undefined;
        candidateAccountabilityHeaderKind = undefined;
        candidateAccountabilityTableHasLeadingPipe = undefined;
      }
      inHtmlComment = true;
      continue;
    }
    line = commentScan.visible;

    if (isCanonicalAccountabilityHeading(line)) {
      const location = `${roadmapPath}:${index + 1}`;
      if (
        foundAccountabilitySection ||
        displayEquivalentAccountabilitySectionLocation !== undefined
      ) {
        const previousLocation =
          accountabilitySectionLocation ??
          displayEquivalentAccountabilitySectionLocation;
        const previousKind =
          accountabilitySectionLocation === undefined
            ? "display-equivalent heading"
            : "canonical heading";
        fail(
          "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
          location,
          `${previousKind} already appears at ${previousLocation}`,
        );
      }
      displayEquivalentAccountabilitySectionLocation = location;
      continue;
    }
    if (inAccountabilitySection && isRoadmapLevelTwoHeading(line)) {
      inAccountabilitySection = false;
      accountabilityTableState = "searching";
      candidateAccountabilityTableLocation = undefined;
      candidateAccountabilityTableColumnCount = undefined;
      candidateAccountabilityHeaderKind = undefined;
      candidateAccountabilityTableHasLeadingPipe = undefined;
      continue;
    }
    if (
      accountabilityTableState === "rows" &&
      isNoLeadingPipeTableRow(line)
    ) {
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        `${roadmapPath}:${index + 1}`,
        'canonical table rows must begin with "|"',
      );
    }

    const leadingPipeTableCells = markdownTableCells(line);
    const noLeadingTableCells =
      leadingPipeTableCells === undefined
        ? noLeadingPipeTableCells(line)
        : undefined;
    const tableCells = leadingPipeTableCells ?? noLeadingTableCells;
    const tableHasLeadingPipe = leadingPipeTableCells !== undefined;
    const mechanism = tableCells?.[0];
    const mechanismLocation = `${roadmapPath}:${index + 1}`;
    let headerKind =
      mechanism === undefined
        ? undefined
        : accountabilityHeaderKind(mechanism, mechanismLocation);
    if (headerKind !== undefined && !tableHasLeadingPipe) {
      headerKind = "no-leading";
    }
    if (accountabilityTableState === "searching") {
      if (headerKind !== undefined) {
        accountabilityTableState = "delimiter";
        candidateAccountabilityTableLocation = mechanismLocation;
        candidateAccountabilityTableColumnCount = tableCells.length;
        candidateAccountabilityHeaderKind = headerKind;
        candidateAccountabilityTableHasLeadingPipe = tableHasLeadingPipe;
      }
      continue;
    }
    if (accountabilityTableState === "delimiter") {
      if (
        tableCells !== undefined &&
        tableHasLeadingPipe ===
          candidateAccountabilityTableHasLeadingPipe &&
        tableCells.length === candidateAccountabilityTableColumnCount &&
        tableCells.every((cell) => MARKDOWN_DELIMITER_CELL.test(cell))
      ) {
        accountabilityTableState = "rows";
        if (candidateAccountabilityHeaderKind === "canonical") {
          accountabilityTableLocation ??=
            candidateAccountabilityTableLocation;
        }
        candidateAccountabilityTableColumnCount = undefined;
      } else {
        accountabilityTableState = "searching";
        candidateAccountabilityTableLocation = undefined;
        candidateAccountabilityTableColumnCount = undefined;
        candidateAccountabilityHeaderKind = undefined;
        candidateAccountabilityTableHasLeadingPipe = undefined;
      }
      continue;
    }
    if (accountabilityTableState === "complete") {
      if (headerKind !== undefined) {
        accountabilityTableState = "delimiter";
        candidateAccountabilityTableLocation = mechanismLocation;
        candidateAccountabilityTableColumnCount = tableCells.length;
        candidateAccountabilityHeaderKind = headerKind;
        candidateAccountabilityTableHasLeadingPipe = tableHasLeadingPipe;
      }
      continue;
    }
    if (mechanism === undefined) {
      accountabilityTableState = foundAccountabilityTable
        ? "complete"
        : "searching";
      candidateAccountabilityTableLocation = undefined;
      candidateAccountabilityTableColumnCount = undefined;
      candidateAccountabilityHeaderKind = undefined;
      candidateAccountabilityTableHasLeadingPipe = undefined;
      continue;
    }

    const location = `${roadmapPath}:${index + 1}`;
    if (candidateAccountabilityHeaderKind === "unsupported") {
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        candidateAccountabilityTableLocation,
        'accountability table header must use the plain-text cell "Mechanism"',
      );
    }
    if (candidateAccountabilityHeaderKind === "no-leading") {
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        candidateAccountabilityTableLocation,
        'canonical table rows must begin with "|"',
      );
    }
    if (candidateAccountabilityHeaderKind === "display-equivalent") {
      if (accountabilityTableLocation !== undefined) {
        fail(
          "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
          candidateAccountabilityTableLocation,
          `canonical table already begins at ${accountabilityTableLocation}`,
        );
      }
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        candidateAccountabilityTableLocation,
        'canonical table header must use the plain-text cell "Mechanism"',
      );
    }
    if (mechanism === "Mechanism") {
      if (foundAccountabilityTable) {
        fail(
          "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
          location,
          `canonical table already begins at ${accountabilityTableLocation}`,
        );
      }
      accountabilityTableState = "delimiter";
      candidateAccountabilityTableLocation = location;
      candidateAccountabilityTableColumnCount = tableCells.length;
      candidateAccountabilityHeaderKind = "canonical";
      candidateAccountabilityTableHasLeadingPipe = true;
      continue;
    }
    const identity = canonicalMechanismIdentity(mechanism, location);
    if (
      accountabilityTableLocation !== undefined &&
      candidateAccountabilityTableLocation !== accountabilityTableLocation
    ) {
      fail(
        "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
        candidateAccountabilityTableLocation,
        `canonical table already begins at ${accountabilityTableLocation}`,
      );
    }
    foundAccountabilityTable = true;
    accountabilityTableLocation = candidateAccountabilityTableLocation;
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
