#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { toString } from "mdast-util-to-string";
import { gfmTable } from "micromark-extension-gfm-table";

import { createRoadmapInventoryRun } from "./roadmap-inventory-runner.mjs";

const PRIMARY_MARKER =
  /^<!--\s*roadmap-primary:\s*([\s\S]*?)-->$/u;
const PRIMARY_MARKER_CANDIDATE = /^<!--\s*roadmap-primary\b/u;
const VALID_MARKER = /^(active|parked|delivered)((?:\s+#\d+)+)$/u;
const ACCOUNTABILITY_HEADING = "## Architecture accountability";
const ACCOUNTABILITY_HEADING_PATTERN = ACCOUNTABILITY_HEADING.replace(
  /[.*+?^${}()|[\]\\]/gu,
  "\\$&",
);
const CANONICAL_ACCOUNTABILITY_HEADING = new RegExp(
  `^ {0,3}${ACCOUNTABILITY_HEADING_PATTERN}[ \\t]*$`,
  "u",
);
const ATX_H2 = /^ {0,3}##(?:[ \t]+|$)/u;
const UNSUPPORTED_STYLED_MECHANISM_HEADER =
  /^(\*{1,2}|_{1,2}|~~)Mechanism\1$/u;
const MARKDOWN_CHARACTER_REFERENCE =
  /&(?:#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/u;
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

function sourceLine(lines, line) {
  return lines[line - 1]?.replace(/\r$/u, "") ?? "";
}

function renderedText(node) {
  if (
    node.type === "html" &&
    /^<!--[\s\S]*-->$/u.test(node.value)
  ) {
    return "";
  }
  if (!Array.isArray(node.children)) {
    return toString(node);
  }
  return node.children.map((child) => renderedText(child)).join("");
}

function headerCellSource(source, cell) {
  return source
    .slice(cell.position.start.offset, cell.position.end.offset)
    .replace(/^ {0,3}\|/u, "")
    .replace(/\|$/u, "")
    .replace(/^[\t ]+|[\t ]+$/gu, "");
}

function accountabilityHeaderKind(source, lines, table) {
  const cell = table.children[0]?.children[0];
  if (cell === undefined) {
    return undefined;
  }

  const content = headerCellSource(source, cell);
  const displayed = renderedText(cell);
  const equivalent =
    displayed === "Mechanism" ||
    displayed.trim() === "Mechanism" ||
    UNSUPPORTED_STYLED_MECHANISM_HEADER.test(content);
  if (!equivalent) {
    return undefined;
  }
  if (UNSUPPORTED_STYLED_MECHANISM_HEADER.test(content)) {
    return "unsupported";
  }

  const line = sourceLine(lines, table.position.start.line);
  if (!/^ {0,3}\|/u.test(line)) {
    return "no-leading";
  }
  const child = cell.children[0];
  if (
    content === "Mechanism" &&
    cell.children.length === 1 &&
    child?.type === "text" &&
    child.value === "Mechanism" &&
    source.slice(child.position.start.offset, child.position.end.offset) ===
      "Mechanism"
  ) {
    return "canonical";
  }
  return "display-equivalent";
}

function tableIsInsideSection(
  nodeIndex,
  canonicalHeadingIndex,
  sectionEndIndex,
) {
  return (
    nodeIndex > canonicalHeadingIndex && nodeIndex < sectionEndIndex
  );
}

function lineWithoutInlineComments(line, lineNumber_, commentRanges) {
  const ranges = commentRanges.filter(
    (range) =>
      range.startLine === lineNumber_ && range.endLine === lineNumber_,
  );
  let visible = line;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    visible =
      visible.slice(0, range.startColumn) +
      visible.slice(range.endColumn);
  }
  return {
    visible,
    exposedDelimiter:
      ranges.length > 0 &&
      (visible.includes("<!--") || visible.includes("-->")),
  };
}

function pipeCells(line) {
  const match = line.match(/^ {0,3}\|([\s\S]*)\|[ \t]*$/u);
  if (match === null) {
    return undefined;
  }
  return match[1]
    .split("|")
    .map((cell) => cell.replace(/^[\t ]+|[\t ]+$/gu, ""));
}

function isDelimiter(cells) {
  return (
    cells !== undefined &&
    cells.length >= 2 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell))
  );
}

function corruptedCanonicalTableLine(
  lines,
  startLine,
  endLine,
  commentRanges,
) {
  for (let index = startLine - 1; index < endLine - 1; index += 1) {
    const hiddenByMultilineComment = commentRanges.some(
      (range) =>
        range.startLine < index + 1 && index + 1 <= range.endLine,
    );
    if (hiddenByMultilineComment) {
      continue;
    }
    const literalHeader = sourceLine(lines, index + 1);
    const literalDelimiter = sourceLine(lines, index + 2);
    const headerView = lineWithoutInlineComments(
      literalHeader,
      index + 1,
      commentRanges,
    );
    const delimiterView = lineWithoutInlineComments(
      literalDelimiter,
      index + 2,
      commentRanges,
    );
    const visibleHeaderCells = pipeCells(headerView.visible);
    if (headerView.exposedDelimiter) {
      return index + 1;
    }
    if (delimiterView.exposedDelimiter) {
      return index + 2;
    }
    if (
      visibleHeaderCells?.[0] !== "Mechanism" ||
      !isDelimiter(pipeCells(delimiterView.visible))
    ) {
      continue;
    }
    if (headerView.visible !== literalHeader) {
      return index + 1;
    }
    if (delimiterView.visible !== literalDelimiter) {
      return index + 2;
    }
  }
  return undefined;
}

function validateTextSource(source, location) {
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) {
        fail(
          "E_ROADMAP_NONCANONICAL_MECHANISM",
          location,
          "mechanism ends with an incomplete Markdown escape",
        );
      }
      const codePoint = escaped.codePointAt(0);
      const isAsciiPunctuation =
        (codePoint >= 33 && codePoint <= 47) ||
        (codePoint >= 58 && codePoint <= 64) ||
        (codePoint >= 91 && codePoint <= 96) ||
        (codePoint >= 123 && codePoint <= 126);
      if (!isAsciiPunctuation) {
        fail(
          "E_ROADMAP_NONCANONICAL_MECHANISM",
          location,
          "Markdown escapes are only valid before ASCII punctuation",
        );
      }
      index += 1;
      continue;
    }
    if (
      character === "&" &&
      MARKDOWN_CHARACTER_REFERENCE.test(source.slice(index))
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
  }
}

function canonicalMechanismIdentity(source, cell, location) {
  for (const child of cell.children) {
    if (child.type === "inlineCode") {
      continue;
    }
    if (
      child.type === "html" &&
      /^<!--[\s\S]*-->$/u.test(child.value)
    ) {
      continue;
    }
    if (child.type !== "text") {
      fail(
        "E_ROADMAP_NONCANONICAL_MECHANISM",
        location,
        "use plain text, escaped punctuation, or inline code in mechanism cells",
      );
    }
    validateTextSource(
      source.slice(child.position.start.offset, child.position.end.offset),
      location,
    );
  }

  const canonical = renderedText(cell)
    .replace(/\s+/gu, " ")
    .trim()
    .normalize("NFC");
  if (canonical.length === 0) {
    fail(
      "E_ROADMAP_EMPTY_MECHANISM",
      location,
      "mechanism cell must identify an architecture decision",
    );
  }
  return canonical;
}

function parseMarkdown(source) {
  return fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
}

function markdownCommentRanges(source, tree) {
  const excludedRanges = [];
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node.type === "inlineCode" ||
      node.type === "code" ||
      (node.type === "html" && !node.value.trimStart().startsWith("<!--"))
    ) {
      excludedRanges.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
    }
    if (Array.isArray(node.children)) {
      stack.push(...node.children);
    }
  }
  const insideExcludedSyntax = (offset) =>
    excludedRanges.some(
      (range) => range.start <= offset && offset < range.end,
    );

  const ranges = [];
  for (let searchFrom = 0; searchFrom < source.length; ) {
    const start = source.indexOf("<!--", searchFrom);
    if (start === -1) {
      break;
    }
    if (insideExcludedSyntax(start)) {
      searchFrom = start + 4;
      continue;
    }

    let closing = source.indexOf("-->", start + 4);
    while (closing !== -1 && insideExcludedSyntax(closing)) {
      closing = source.indexOf("-->", closing + 3);
    }
    const end = closing === -1 ? source.length : closing + 3;
    ranges.push({
      start,
      end,
      closing: closing === -1 ? undefined : closing,
      startLine: lineNumber(source, start),
      endLine: lineNumber(source, end),
      startColumn:
        start - (source.lastIndexOf("\n", start - 1) + 1),
      endColumn:
        end - (source.lastIndexOf("\n", end - 1) + 1),
    });
    searchFrom = end;
  }
  return ranges;
}

function hasStructuralPipe(line) {
  // GFM tables are omitted: this parse only locates inline-code ranges.
  const tree = fromMarkdown(line);
  const inlineCodeRanges = [];
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === "inlineCode") {
      inlineCodeRanges.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
    }
    if (Array.isArray(node.children)) {
      stack.push(...node.children);
    }
  }

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "|") {
      continue;
    }
    let precedingBackslashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && line[cursor] === "\\";
      cursor -= 1
    ) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 2 === 1) {
      continue;
    }
    const insideInlineCode = inlineCodeRanges.some(
      (range) => range.start <= index && index < range.end,
    );
    if (!insideInlineCode) {
      return true;
    }
  }
  return false;
}

function validateArchitectureAccountability(roadmap, roadmapPath) {
  const tree = parseMarkdown(roadmap);
  const lines = roadmap.split("\n");
  const commentRanges = markdownCommentRanges(roadmap, tree);
  const renderedHeadings = [];
  const canonicalHeadingIndexes = [];

  for (const [index, node] of tree.children.entries()) {
    const hiddenByComment = commentRanges.some(
      (range) =>
        range.start < node.position.start.offset &&
        node.position.start.offset < range.end,
    );
    if (
      hiddenByComment ||
      node.type !== "heading" ||
      node.depth !== 2 ||
      node.position.start.line !== node.position.end.line ||
      !ATX_H2.test(sourceLine(lines, node.position.start.line)) ||
      renderedText(node) !== "Architecture accountability"
    ) {
      continue;
    }
    const literal = sourceLine(lines, node.position.start.line);
    const canonical = CANONICAL_ACCOUNTABILITY_HEADING.test(literal);
    renderedHeadings.push({ index, node, canonical });
    if (canonical) {
      canonicalHeadingIndexes.push(index);
    }
  }

  if (canonicalHeadingIndexes.length === 0) {
    fail(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_SECTION",
      roadmapPath,
      `expected canonical heading "${ACCOUNTABILITY_HEADING}"`,
    );
  }
  if (renderedHeadings.length > 1) {
    const [previous, duplicate] = renderedHeadings;
    const previousLocation =
      `${roadmapPath}:${previous.node.position.start.line}`;
    const previousKind = previous.canonical
      ? "canonical heading"
      : "display-equivalent heading";
    fail(
      "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
      `${roadmapPath}:${duplicate.node.position.start.line}`,
      `${previousKind} already appears at ${previousLocation}`,
    );
  }

  const canonicalHeadingIndex = canonicalHeadingIndexes[0];
  let sectionEndIndex = tree.children.length;
  for (
    let index = canonicalHeadingIndex + 1;
    index < tree.children.length;
    index += 1
  ) {
    const node = tree.children[index];
    if (node.type === "heading" && node.depth <= 2) {
      sectionEndIndex = index;
      break;
    }
  }

  let accountabilityTableLocation;
  let foundAccountabilityTable = false;
  const mechanisms = new Map();

  for (const [index, node] of tree.children.entries()) {
    const hiddenByComment = commentRanges.some(
      (range) =>
        range.start < node.position.start.offset &&
        node.position.start.offset < range.end,
    );
    if (hiddenByComment || node.type !== "table") {
      continue;
    }
    const headerKind = accountabilityHeaderKind(roadmap, lines, node);
    if (headerKind === undefined) {
      continue;
    }

    const location = `${roadmapPath}:${node.position.start.line}`;
    const delimiter = sourceLine(
      lines,
      node.position.start.line + 1,
    );
    if (
      headerKind !== "no-leading" &&
      !isDelimiter(pipeCells(delimiter))
    ) {
      continue;
    }
    const complete = node.children.length > 1;
    if (!complete) {
      if (headerKind === "canonical") {
        accountabilityTableLocation ??= location;
      }
      continue;
    }
    if (headerKind === "unsupported") {
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        location,
        'accountability table header must use the plain-text cell "Mechanism"',
      );
    }
    if (headerKind === "no-leading") {
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        location,
        'canonical table rows must begin with "|"',
      );
    }
    if (headerKind === "display-equivalent") {
      if (accountabilityTableLocation !== undefined) {
        fail(
          "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
          location,
          `canonical table already begins at ${accountabilityTableLocation}`,
        );
      }
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        location,
        'canonical table header must use the plain-text cell "Mechanism"',
      );
    }
    if (accountabilityTableLocation !== undefined) {
      fail(
        "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
        location,
        `canonical table already begins at ${accountabilityTableLocation}`,
      );
    }
    accountabilityTableLocation = location;

    if (
      !tableIsInsideSection(
        index,
        canonicalHeadingIndex,
        sectionEndIndex,
      )
    ) {
      continue;
    }

    for (const row of node.children.slice(1)) {
      const rowLine = sourceLine(lines, row.position.start.line);
      const rowLocation = `${roadmapPath}:${row.position.start.line}`;
      if (!/^ {0,3}\|/u.test(rowLine)) {
        if (!hasStructuralPipe(rowLine)) {
          continue;
        }
        fail(
          "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
          rowLocation,
          'canonical table rows must begin with "|"',
        );
      }
      if (
        rowLine.includes("<!--") &&
        !rowLine.slice(rowLine.indexOf("<!--") + 4).includes("-->")
      ) {
        fail(
          "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
          rowLocation,
          "a multiline HTML comment cannot begin on an accountability table row",
        );
      }

      const mechanismCell = row.children[0];
      const identity = canonicalMechanismIdentity(
        roadmap,
        mechanismCell,
        rowLocation,
      );
      const previous = mechanisms.get(identity);
      if (previous !== undefined) {
        fail(
          "E_ROADMAP_DUPLICATE_MECHANISM",
          rowLocation,
          `architecture-accountability mechanism "${identity}" already appears at ${previous}`,
        );
      }
      mechanisms.set(identity, rowLocation);
      foundAccountabilityTable = true;
    }
  }

  for (const range of commentRanges) {
    if (range.closing === undefined) {
      continue;
    }
    const closingLine = sourceLine(lines, range.endLine);
    const closingLineStart =
      roadmap.lastIndexOf("\n", range.closing - 1) + 1;
    const closerColumn = range.closing - closingLineStart;
    const visibleSuffix = closingLine.slice(closerColumn + 3);
    const header = pipeCells(visibleSuffix);
    const delimiter = pipeCells(sourceLine(lines, range.endLine + 1));
    const data = pipeCells(sourceLine(lines, range.endLine + 2));
    if (
      header?.[0] !== "Mechanism" ||
      !isDelimiter(delimiter) ||
      data === undefined
    ) {
      continue;
    }
    const location = `${roadmapPath}:${range.endLine}`;
    if (accountabilityTableLocation !== undefined) {
      fail(
        "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
        location,
        `canonical table already begins at ${accountabilityTableLocation}`,
      );
    }
    fail(
      "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
      location,
      "a canonical table cannot begin on an HTML-comment closing line",
    );
  }

  if (!foundAccountabilityTable) {
    const headingLine =
      tree.children[canonicalHeadingIndex].position.start.line;
    const sectionEndLine =
      tree.children[sectionEndIndex]?.position.start.line ??
      lines.length + 1;
    const corruptedLine = corruptedCanonicalTableLine(
      lines,
      headingLine + 1,
      sectionEndLine,
      commentRanges,
    );
    if (corruptedLine !== undefined) {
      fail(
        "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
        `${roadmapPath}:${corruptedLine}`,
        "accountability table header and delimiter must be valid in literal source",
      );
    }
    fail(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE",
      roadmapPath,
      'expected a table whose first header cell is "Mechanism"',
    );
  }
  return tree;
}

export function parseRoadmapInventory(
  roadmap,
  { roadmapPath = "ROADMAP.md" } = {},
) {
  const tree = validateArchitectureAccountability(roadmap, roadmapPath);
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
