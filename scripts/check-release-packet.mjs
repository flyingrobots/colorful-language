#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { parse as parseToml } from "smol-toml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RELEASE_DIRECTORY = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const ISSUE_URL =
  /^https:\/\/github\.com\/flyingrobots\/colorful-language\/issues\/(?<number>[1-9]\d*)$/u;
const RELEASE_PHASES = Object.freeze([
  "pre-publication",
  "published",
  "verified",
  "retrospected",
]);

export const CHECK_COMMAND = "node scripts/check-release-packet.mjs";
export const SELF_TEST_COMMAND =
  "node --test scripts/check-release-packet.test.mjs";

export class ReleasePacketPolicyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleasePacketPolicyError";
    this.code = code;
  }
}

function reject(code, path, message) {
  throw new ReleasePacketPolicyError(code, `${path}: ${message}`);
}

function readRequiredFile(root, path) {
  try {
    return readFileSync(resolve(root, path), "utf8");
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      path,
      `cannot read required file: ${error.code ?? error.message}`,
    );
  }
}

function parseVersion(version, context) {
  const match = STABLE_VERSION.exec(version);
  if (match === null) {
    reject("E_RELEASE_PACKET_IDENTITY", context, "must be stable SemVer");
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function completedReleaseVersions(root, targetVersion) {
  const target = parseVersion(targetVersion, "Cargo.toml");
  return readdirSync(resolve(root, "docs/goalposts"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const match = RELEASE_DIRECTORY.exec(entry.name);
      if (match === null) {
        return [];
      }
      const version = match.slice(1).map((part) => Number.parseInt(part, 10));
      if (compareVersions(version, target) >= 0) {
        return [];
      }
      const releasePath = resolve(
        root,
        "docs/goalposts",
        entry.name,
        "release.md",
      );
      const verificationPath = resolve(
        root,
        "docs/goalposts",
        entry.name,
        "verification.md",
      );
      try {
        readFileSync(releasePath);
        readFileSync(verificationPath);
      } catch {
        return [];
      }
      return [{ tag: entry.name, version }];
    })
    .sort((left, right) => compareVersions(right.version, left.version));
}

function parseDocument(source, path) {
  try {
    return fromMarkdown(source);
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_MARKDOWN",
      path,
      `cannot parse Markdown: ${error.message}`,
    );
  }
}

function rootTitle(document, path) {
  const titles = document.children.filter(
    (node) => node.type === "heading" && node.depth === 1,
  );
  if (titles.length !== 1 || document.children[0] !== titles[0]) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      path,
      "must begin with exactly one level-one title",
    );
  }
  return toString(titles[0]).trim();
}

function sectionMap(document, path) {
  const sections = new Map();
  let current;
  for (const node of document.children) {
    if (node.type === "heading" && node.depth === 2) {
      const name = toString(node).trim();
      if (sections.has(name)) {
        reject(
          "E_RELEASE_PACKET_SECTION",
          path,
          `contains duplicate section '${name}'`,
        );
      }
      current = { heading: node, nodes: [] };
      sections.set(name, current);
    } else if (current !== undefined) {
      current.nodes.push(node);
    }
  }
  return sections;
}

function sectionText(section) {
  return section.nodes.map((node) => toString(node)).join("\n").trim();
}

function requireSection(sections, name, path) {
  const section = sections.get(name);
  if (section === undefined) {
    reject(
      "E_RELEASE_PACKET_SECTION",
      path,
      `missing required section '${name}'`,
    );
  }
  if (sectionText(section) === "") {
    reject(
      "E_RELEASE_PACKET_SECTION",
      path,
      `section '${name}' must not be empty`,
    );
  }
  return section;
}

function subsectionMap(section, path) {
  const subsections = new Map();
  let current;
  for (const node of section.nodes) {
    if (node.type === "heading" && node.depth === 3) {
      const name = toString(node).trim();
      if (subsections.has(name)) {
        reject(
          "E_RELEASE_PACKET_SCOPE",
          path,
          `contains duplicate scope bucket '${name}'`,
        );
      }
      current = { heading: node, nodes: [] };
      subsections.set(name, current);
    } else if (current !== undefined) {
      current.nodes.push(node);
    }
  }
  return subsections;
}

function requireScopeBucket(subsections, name, path) {
  const bucket = subsections.get(name);
  if (bucket === undefined || sectionText(bucket) === "") {
    reject(
      "E_RELEASE_PACKET_SCOPE",
      path,
      `scope bucket '${name}' must exist and be non-empty`,
    );
  }
  return bucket;
}

function listItems(nodes) {
  return nodes.flatMap((node) =>
    node.type === "list" ? node.children : [],
  );
}

function walk(nodes, visitor) {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children)) {
      walk(node.children, visitor);
    }
  }
}

function issueNumbers(nodes) {
  const numbers = new Set();
  walk(nodes, (node) => {
    if (node.type !== "link") {
      return;
    }
    const match = ISSUE_URL.exec(node.url);
    if (match !== null) {
      numbers.add(Number.parseInt(match.groups.number, 10));
    }
  });
  return numbers;
}

function validatePacketDocument(snapshot) {
  const document = parseDocument(snapshot.release, snapshot.releasePath);
  const expectedTitle = `colorful-language v${snapshot.version} — Release Packet`;
  if (rootTitle(document, snapshot.releasePath) !== expectedTitle) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.releasePath,
      `title must be '${expectedTitle}'`,
    );
  }
  const sections = sectionMap(document, snapshot.releasePath);
  const thesis = requireSection(
    sections,
    "Release thesis",
    snapshot.releasePath,
  );
  const version = requireSection(
    sections,
    "Version decision",
    snapshot.releasePath,
  );
  const scope = requireSection(sections, "Scope", snapshot.releasePath);
  const goalposts = requireSection(
    sections,
    "Goalposts",
    snapshot.releasePath,
  );
  const scopedSlices = requireSection(
    sections,
    "Scoped slices",
    snapshot.releasePath,
  );
  requireSection(
    sections,
    "Explicit non-claims",
    snapshot.releasePath,
  );
  requireSection(
    sections,
    "Risks and rollback",
    snapshot.releasePath,
  );
  requireSection(
    sections,
    "Acceptance evidence",
    snapshot.releasePath,
  );

  if (sectionText(thesis).length < 40) {
    reject(
      "E_RELEASE_PACKET_SECTION",
      snapshot.releasePath,
      "section 'Release thesis' must state a concrete release promise",
    );
  }
  const versionText = sectionText(version);
  if (
    !versionText.includes(snapshot.version) ||
    !versionText.includes(snapshot.previousTag)
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.releasePath,
      `version decision must name ${snapshot.version} and ${snapshot.previousTag}`,
    );
  }

  const scopeBuckets = subsectionMap(scope, snapshot.releasePath);
  const scopedNodes = [
    ...requireScopeBucket(scopeBuckets, "Must ship", snapshot.releasePath)
      .nodes,
    ...requireScopeBucket(scopeBuckets, "May slip", snapshot.releasePath)
      .nodes,
    ...requireScopeBucket(scopeBuckets, "Not included", snapshot.releasePath)
      .nodes,
  ];
  const goalpostItems = listItems(goalposts.nodes);
  if (goalpostItems.length < 2 || goalpostItems.length > 5) {
    reject(
      "E_RELEASE_PACKET_GOALPOSTS",
      snapshot.releasePath,
      `section 'Goalposts' must contain two to five list items; found ${goalpostItems.length}`,
    );
  }

  const scopedIssueNumbers = issueNumbers(scopedSlices.nodes);
  if (scopedIssueNumbers.size === 0) {
    reject(
      "E_RELEASE_PACKET_SCOPE",
      snapshot.releasePath,
      "section 'Scoped slices' must contain at least one repository issue link",
    );
  }
  const referencedIssueNumbers = issueNumbers([
    ...scopedNodes,
    ...goalposts.nodes,
  ]);
  for (const issue of referencedIssueNumbers) {
    if (!scopedIssueNumbers.has(issue)) {
      reject(
        "E_RELEASE_PACKET_SCOPE",
        snapshot.releasePath,
        `issue #${issue} appears in scope or goalposts but not in 'Scoped slices'`,
      );
    }
  }
  return {
    goalpostCount: goalpostItems.length,
    scopedIssueCount: scopedIssueNumbers.size,
  };
}

function validateVerificationDocument(snapshot) {
  const document = parseDocument(
    snapshot.verification,
    snapshot.verificationPath,
  );
  const expectedTitle =
    `colorful-language v${snapshot.version} — Verification Witness`;
  if (rootTitle(document, snapshot.verificationPath) !== expectedTitle) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.verificationPath,
      `title must be '${expectedTitle}'`,
    );
  }
  const sections = sectionMap(document, snapshot.verificationPath);
  const status = requireSection(
    sections,
    "Status",
    snapshot.verificationPath,
  );
  requireSection(
    sections,
    "Pre-publication evidence",
    snapshot.verificationPath,
  );
  const publication = requireSection(
    sections,
    "Publication evidence",
    snapshot.verificationPath,
  );
  const publicVerification = requireSection(
    sections,
    "Public verification",
    snapshot.verificationPath,
  );
  const retrospective = requireSection(
    sections,
    "Retrospective",
    snapshot.verificationPath,
  );
  const phaseMatch = sectionText(status).match(
    /Release phase:\s*(pre-publication|published|verified|retrospected)\b/iu,
  );
  if (phaseMatch === null) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      snapshot.verificationPath,
      `section 'Status' must name one release phase: ${RELEASE_PHASES.join(", ")}`,
    );
  }
  const phase = phaseMatch[1].toLowerCase();
  if (phase === "pre-publication") {
    for (const [name, section] of [
      ["Publication evidence", publication],
      ["Public verification", publicVerification],
      ["Retrospective", retrospective],
    ]) {
      const text = sectionText(section).toLowerCase();
      if (!text.includes("not available") && !text.includes("pending")) {
        reject(
          "E_RELEASE_PACKET_EVIDENCE",
          snapshot.verificationPath,
          `section '${name}' must remain explicitly unavailable or pending before publication`,
        );
      }
    }
  }
  return { phase };
}

function commandLineIndex(source, command) {
  return source.split(/\r?\n/u).findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === command || trimmed === `run: ${command}`;
  });
}

function validateGateWiring(snapshot) {
  for (const [gate, source] of Object.entries(snapshot.gateSources)) {
    const selfTestIndex = commandLineIndex(source, SELF_TEST_COMMAND);
    const checkIndex = commandLineIndex(source, CHECK_COMMAND);
    if (selfTestIndex === -1 || checkIndex === -1 || selfTestIndex > checkIndex) {
      reject(
        "E_RELEASE_PACKET_GATE",
        gate,
        `must run '${SELF_TEST_COMMAND}' before '${CHECK_COMMAND}'`,
      );
    }
  }
}

export function validateReleasePacket(snapshot) {
  if (
    snapshot.releasePath !==
      `docs/goalposts/v${snapshot.version}/release.md` ||
    snapshot.verificationPath !==
      `docs/goalposts/v${snapshot.version}/verification.md`
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      "release snapshot",
      "packet paths must derive from the workspace version",
    );
  }
  parseVersion(snapshot.version, "Cargo.toml");
  const previousVersion = snapshot.previousTag.slice(1);
  parseVersion(previousVersion, "previous public tag");
  if (
    compareVersions(
      parseVersion(previousVersion, "previous public tag"),
      parseVersion(snapshot.version, "Cargo.toml"),
    ) >= 0
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.releasePath,
      "previous public tag must precede the target version",
    );
  }
  const packet = validatePacketDocument(snapshot);
  const verification = validateVerificationDocument(snapshot);
  validateGateWiring(snapshot);
  return {
    version: snapshot.version,
    previousTag: snapshot.previousTag,
    ...packet,
    ...verification,
  };
}

export function loadRepositorySnapshot(root = ROOT) {
  const manifest = parseToml(readRequiredFile(root, "Cargo.toml"));
  const version = manifest.workspace?.package?.version;
  if (typeof version !== "string") {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      "Cargo.toml",
      "workspace.package.version must be a string",
    );
  }
  const completed = completedReleaseVersions(root, version);
  if (completed.length === 0) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      "docs/goalposts",
      `no completed release precedes ${version}`,
    );
  }
  const releasePath = `docs/goalposts/v${version}/release.md`;
  const verificationPath =
    `docs/goalposts/v${version}/verification.md`;
  return {
    version,
    previousTag: completed[0].tag,
    releasePath,
    release: readRequiredFile(root, releasePath),
    verificationPath,
    verification: readRequiredFile(root, verificationPath),
    gateSources: {
      ".github/workflows/ci.yml": readRequiredFile(
        root,
        ".github/workflows/ci.yml",
      ),
      ".github/workflows/release.yml": readRequiredFile(
        root,
        ".github/workflows/release.yml",
      ),
      "scripts/release-prep.sh": readRequiredFile(
        root,
        "scripts/release-prep.sh",
      ),
    },
  };
}

function main() {
  try {
    const result = validateReleasePacket(loadRepositorySnapshot());
    console.log(
      `check-release-packet: v${result.version} ${result.phase} packet satisfied ` +
        `(${result.goalpostCount} goalposts, ${result.scopedIssueCount} scoped issues)`,
    );
  } catch (error) {
    if (error instanceof ReleasePacketPolicyError) {
      console.error(`check-release-packet: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
