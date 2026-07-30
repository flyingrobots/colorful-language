#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { toString } from "mdast-util-to-string";
import { gfmTable } from "micromark-extension-gfm-table";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

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
const SCOPE_BUCKETS = Object.freeze([
  "Must ship",
  "May slip",
  "Not included",
]);
const COMPLETED_EVIDENCE =
  /\b(?:available|complete|completed|created|finished|installed|landed|pass|passed|published|released|successful|successfully|uploaded|verified)\b|\b[0-9a-f]{7,40}\b|✅|https?:\/\//iu;
const EVIDENCE_STATE_GLOBAL =
  /\bEvidence state:\s*(completed|not available|pending|unavailable)\b/giu;
const UNAVAILABLE_EVIDENCE_GLOBAL =
  /\b(?:not available|pending|unavailable)\b/giu;

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

function repositoryTags(root) {
  try {
    return execFileSync(
      "git",
      ["tag", "--merged", "HEAD", "--list", "v[0-9]*"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .split(/\r?\n/u)
      .filter((tag) => tag !== "");
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      "git tags",
      `cannot enumerate public release tags: ${error.code ?? error.message}`,
    );
  }
}

function targetTagCommit(root, version, publicTags, verificationPath) {
  const targetTag = `v${version}`;
  if (!publicTags.includes(targetTag)) {
    return undefined;
  }
  let tagType;
  try {
    tagType = execFileSync(
      "git",
      ["cat-file", "-t", targetTag],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      verificationPath,
      `cannot inspect target tag object: ${error.code ?? error.message}`,
    );
  }
  if (tagType !== "tag") {
    return undefined;
  }
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--verify", `${targetTag}^{commit}`],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      verificationPath,
      `cannot resolve annotated target tag commit: ${error.code ?? error.message}`,
    );
  }
}

function baselineReleasePhase(root, verificationPath) {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  } catch (error) {
    if (error.status === 128) {
      return undefined;
    }
    reject(
      "E_RELEASE_PACKET_IO",
      root,
      `cannot inspect repository state: ${error.code ?? error.message}`,
    );
  }
  try {
    execFileSync(
      "git",
      ["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  } catch (error) {
    if (error.status === 1) {
      return undefined;
    }
    reject(
      "E_RELEASE_PACKET_IO",
      "origin/main",
      `cannot inspect branch-base authority: ${error.code ?? error.message}`,
    );
  }
  let baseline;
  try {
    baseline = execFileSync(
      "git",
      ["merge-base", "HEAD", "origin/main"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      "origin/main",
      `cannot resolve merge base: ${error.code ?? error.message}`,
    );
  }
  let baselinePaths;
  try {
    baselinePaths = execFileSync(
      "git",
      ["ls-tree", "--name-only", baseline, "--", verificationPath],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .split(/\r?\n/u)
      .filter((path) => path !== "");
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      verificationPath,
      `cannot inspect branch-base witness path: ${error.code ?? error.message}`,
    );
  }
  if (baselinePaths.length === 0) {
    return undefined;
  }
  if (
    baselinePaths.length !== 1 ||
    baselinePaths[0] !== verificationPath
  ) {
    reject(
      "E_RELEASE_PACKET_IO",
      verificationPath,
      "branch-base witness path resolved ambiguously",
    );
  }
  let source;
  try {
    source = execFileSync(
      "git",
      ["show", `${baseline}:${verificationPath}`],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_IO",
      verificationPath,
      `cannot read branch-base witness: ${error.code ?? error.message}`,
    );
  }
  const document = parseDocument(source, verificationPath);
  const status = sectionMap(document, verificationPath).get("Status");
  const phases =
    status === undefined
      ? []
      : [
          ...sectionText(status).matchAll(
            /Release phase:\s*(pre-publication|published|verified|retrospected)\b/giu,
          ),
        ];
  if (phases.length !== 1) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      verificationPath,
      `branch-base witness at ${baseline} must name exactly one admitted release phase`,
    );
  }
  return phases[0][1].toLowerCase();
}

function previousPublicRelease(root, targetVersion, publicTags) {
  const target = parseVersion(targetVersion, "Cargo.toml");
  const releases = publicTags
    .flatMap((tag) => {
      const match = RELEASE_DIRECTORY.exec(tag);
      if (match === null) {
        return [];
      }
      const version = match.slice(1).map((part) => Number.parseInt(part, 10));
      return [{ tag, version }];
    })
    .sort((left, right) => compareVersions(right.version, left.version));
  const newerRelease = releases.find(
    ({ version }) => compareVersions(version, target) > 0,
  );
  if (newerRelease !== undefined) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      "git tags",
      `public tag ${newerRelease.tag} is newer than target v${targetVersion}`,
    );
  }
  const predecessors = releases.filter(
    ({ version }) => compareVersions(version, target) < 0,
  );
  if (predecessors.length === 0) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      "git tags",
      `no public release tag precedes ${targetVersion}`,
    );
  }
  const previous = predecessors[0];
  readRequiredFile(root, `docs/goalposts/${previous.tag}/release.md`);
  const previousVerificationPath =
    `docs/goalposts/${previous.tag}/verification.md`;
  validateCompletedRetrospective(
    readRequiredFile(root, previousVerificationPath),
    previousVerificationPath,
  );
  return previous;
}

export function parseDocument(source, path) {
  try {
    return fromMarkdown(source, {
      extensions: [gfmTable()],
      mdastExtensions: [gfmTableFromMarkdown()],
    });
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
  return section.nodes
    .flatMap((node) =>
      node.type === "table"
        ? node.children.flatMap((row) =>
            row.children.map((cell) => toString(cell))
          )
        : [toString(node)],
    )
    .join("\n")
    .trim();
}

function versionDecisionMatches(section, version, previousTag) {
  const firstParagraph = section.nodes.find(
    (node) => node.type === "paragraph",
  );
  if (firstParagraph === undefined) {
    return false;
  }
  const escapedVersion = version.replaceAll(".", "\\.");
  const escapedPreviousTag = previousTag.replaceAll(".", "\\.");
  return new RegExp(
    `^Release\\s+${escapedVersion}(?![-+\\d]|\\.\\d)\\s+after\\s+${escapedPreviousTag}(?![-+\\d]|\\.\\d)(?:[.!?]|\\s|$)`,
    "u",
  ).test(toString(firstParagraph).trim());
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

function validateCompletedRetrospective(source, path) {
  const document = parseDocument(source, path);
  const retrospective = sectionMap(document, path).get("Retrospective");
  if (
    retrospective === undefined ||
    sectionText(retrospective) === ""
  ) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      "previous release must contain a non-empty retrospective",
    );
  }
  const completedStates = [
    ...sectionText(retrospective).matchAll(
      /\bRetrospective status:\s*completed\b/giu,
    ),
  ];
  if (completedStates.length !== 1) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      "previous release must declare exactly one completed retrospective status",
    );
  }
}

function normalizedEvidenceState(state) {
  return state === "completed" ? state : "unavailable";
}

function hasUnavailablePlaceholder(section) {
  let found = false;
  walk(section.nodes, (node) => {
    if (
      ["listItem", "paragraph", "tableCell"].includes(node.type) &&
      /(?:^|:\s*)(?:not available|pending|unavailable)\.?\s*$/iu.test(
        toString(node).trim(),
      )
    ) {
      found = true;
    }
  });
  return found;
}

function requireEvidenceState(
  section,
  sectionName,
  expectedState,
  definitions,
  path,
) {
  const text = sectionEvidenceText(section, definitions);
  const states = [...text.matchAll(EVIDENCE_STATE_GLOBAL)];
  if (
    states.length !== 1 ||
    normalizedEvidenceState(states[0][1].toLowerCase()) !== expectedState
  ) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section '${sectionName}' must declare exactly one ${expectedState} evidence state`,
    );
  }
  if (expectedState === "completed") {
    if (hasUnavailablePlaceholder(section)) {
      reject(
        "E_RELEASE_PACKET_EVIDENCE",
        path,
        `section '${sectionName}' cannot retain unavailable or pending evidence after completion`,
      );
    }
  } else {
    const claims = text.replace(UNAVAILABLE_EVIDENCE_GLOBAL, "");
    if (COMPLETED_EVIDENCE.test(claims)) {
      reject(
        "E_RELEASE_PACKET_EVIDENCE",
        path,
        `section '${sectionName}' contradicts its unavailable state with completed or public evidence`,
      );
    }
  }
  return text;
}

function requireOneMatch(text, expression, sectionName, description, path) {
  if ([...text.matchAll(expression)].length !== 1) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section '${sectionName}' must contain exactly one ${description}`,
    );
  }
}

function requireOneUniqueMatch(
  text,
  expression,
  sectionName,
  description,
  path,
) {
  const matches = new Set(
    [...text.matchAll(expression)].map((match) => match[0]),
  );
  if (matches.size !== 1) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section '${sectionName}' must contain exactly one ${description}`,
    );
  }
}

function requirePublicationEvidence(
  section,
  definitions,
  version,
  targetCommit,
  path,
) {
  const sectionName = "Publication evidence";
  const text = requireEvidenceState(
    section,
    sectionName,
    "completed",
    definitions,
    path,
  );
  const targetCommitMatches = [
    ...text.matchAll(
      /\bTag target commit:\s*([0-9a-f]{40})(?![0-9a-f])/giu,
    ),
  ];
  if (typeof targetCommit !== "string") {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `annotated tag v${version} must resolve before section '${sectionName}' can be completed`,
    );
  }
  if (
    targetCommitMatches.length !== 1 ||
    targetCommitMatches[0][1].toLowerCase() !== targetCommit.toLowerCase()
  ) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section '${sectionName}' must contain the full commit behind annotated tag v${version}`,
    );
  }
  requireOneUniqueMatch(
    text,
    /https:\/\/github\.com\/flyingrobots\/colorful-language\/actions\/runs\/[1-9]\d*(?![/#?\w-]|\.[0-9A-Za-z])/gu,
    sectionName,
    "immutable publish workflow run URL",
    path,
  );
  const escapedVersion = version.replaceAll(".", "\\.");
  requireOneUniqueMatch(
    text,
    new RegExp(
      `https://github\\.com/flyingrobots/colorful-language/releases/tag/v${escapedVersion}(?![/#?\\w-]|\\.[0-9A-Za-z])`,
      "gu",
    ),
    sectionName,
    `GitHub Release URL for v${version}`,
    path,
  );
}

function validCalendarDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function requireDatedResult(text, label, sectionName, path) {
  const matches = [
    ...text.matchAll(
      new RegExp(
        `\\b${label} result:\\s*passed on (\\d{4}-\\d{2}-\\d{2})(?!\\d)`,
        "giu",
      ),
    ),
  ];
  if (matches.length !== 1 || !validCalendarDate(matches[0][1])) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section '${sectionName}' must contain exactly one dated passed ${label.toLowerCase()} result`,
    );
  }
}

function requirePublicVerificationEvidence(section, definitions, path) {
  const sectionName = "Public verification";
  const text = requireEvidenceState(
    section,
    sectionName,
    "completed",
    definitions,
    path,
  );
  requireDatedResult(text, "Verification", sectionName, path);
  const fallbackMatches = [
    ...text.matchAll(
      /\b(?:Rollback|Patch-forward) result:\s*passed on (\d{4}-\d{2}-\d{2})(?!\d)/giu,
    ),
  ];
  if (
    fallbackMatches.length !== 1 ||
    !validCalendarDate(fallbackMatches[0][1])
  ) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section '${sectionName}' must contain exactly one dated passed rollback or patch-forward result`,
    );
  }
}

function requireListEntry(section, label, path) {
  const items = [];
  walk(section.nodes, (node) => {
    if (node.type === "listItem") {
      items.push(toString(node).trim());
    }
  });
  const matches = items.filter((item) =>
    new RegExp(`^${label}:\\s*\\S`, "iu").test(item),
  );
  if (matches.length !== 1) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      path,
      `section 'Retrospective' must contain exactly one non-empty '${label}' entry`,
    );
  }
}

function requireRetrospectiveEvidence(section, definitions, path) {
  const sectionName = "Retrospective";
  const text = requireEvidenceState(
    section,
    sectionName,
    "completed",
    definitions,
    path,
  );
  requireOneMatch(
    text,
    /\bRetrospective status:\s*completed\b/giu,
    sectionName,
    "completed retrospective status",
    path,
  );
  for (const label of [
    "Planned versus actual",
    "Fallout",
    "Repeatable wins",
    "Next recommendation",
  ]) {
    requireListEntry(section, label, path);
  }
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

function leadingStrongLabel(item) {
  const paragraph = item.children?.find(
    (node) => node.type === "paragraph",
  );
  const strong = paragraph?.children?.[0];
  if (strong?.type !== "strong") {
    return undefined;
  }
  return toString(strong).trim().replace(/:\s*$/u, "").normalize("NFC");
}

function walk(nodes, visitor) {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children)) {
      walk(node.children, visitor);
    }
  }
}

function definitionDestinations(document) {
  const destinations = new Map();
  walk(document.children, (node) => {
    if (node.type !== "definition") {
      return;
    }
    const urls = destinations.get(node.identifier) ?? [];
    urls.push(node.url);
    destinations.set(node.identifier, urls);
  });
  return destinations;
}

function sectionEvidenceText(section, definitions) {
  const fragments = [];
  walk(section.nodes, (node) => {
    if (
      ["code", "heading", "html", "paragraph", "tableCell"].includes(
        node.type,
      )
    ) {
      fragments.push(toString(node));
    }
    if (
      ["definition", "image", "link"].includes(node.type) &&
      typeof node.url === "string"
    ) {
      fragments.push(node.url);
    } else if (
      ["imageReference", "linkReference"].includes(node.type) &&
      typeof node.identifier === "string"
    ) {
      fragments.push(...(definitions.get(node.identifier) ?? []));
    }
  });
  return fragments.join("\n");
}

function issueNumbers(nodes, definitions) {
  const numbers = new Set();
  walk(nodes, (node) => {
    let urls = [];
    if (node.type === "link") {
      urls = [node.url];
    } else if (
      node.type === "linkReference" &&
      typeof node.identifier === "string"
    ) {
      urls = definitions.get(node.identifier) ?? [];
    }
    for (const url of urls) {
      const match = ISSUE_URL.exec(url);
      if (match !== null) {
        numbers.add(Number.parseInt(match.groups.number, 10));
      }
    }
  });
  return numbers;
}

function hasObservableOracle(item, definitions) {
  let found = false;
  walk([item], (node) => {
    if (node.type === "inlineCode" && node.value.trim() !== "") {
      found = true;
      return;
    }
    let urls = [];
    if (node.type === "link") {
      urls = [node.url];
    } else if (
      node.type === "linkReference" &&
      typeof node.identifier === "string"
    ) {
      urls = definitions.get(node.identifier) ?? [];
    }
    if (urls.some((url) => ISSUE_URL.exec(url) === null)) {
      found = true;
    }
  });
  return found;
}

function validateGoalpostEvidence(
  goalpostItems,
  evidenceItems,
  definitions,
  path,
) {
  const evidenceByLabel = new Map();
  for (const item of evidenceItems) {
    const label = leadingStrongLabel(item);
    if (label === undefined) {
      continue;
    }
    if (evidenceByLabel.has(label)) {
      reject(
        "E_RELEASE_PACKET_GOALPOSTS",
        path,
        `acceptance evidence duplicates goalpost '${label}'`,
      );
    }
    evidenceByLabel.set(label, item);
  }
  const goalpostLabels = new Set();
  for (const goalpost of goalpostItems) {
    const label = leadingStrongLabel(goalpost);
    if (label !== undefined && goalpostLabels.has(label)) {
      reject(
        "E_RELEASE_PACKET_GOALPOSTS",
        path,
        `goalposts contain duplicate label '${label}'`,
      );
    }
    if (label !== undefined) {
      goalpostLabels.add(label);
    }
    const evidence = label === undefined
      ? undefined
      : evidenceByLabel.get(label);
    if (
      label === undefined ||
      evidence === undefined ||
      !hasObservableOracle(evidence, definitions)
    ) {
      reject(
        "E_RELEASE_PACKET_GOALPOSTS",
        path,
        `goalpost '${label ?? toString(goalpost).trim()}' requires labeled acceptance evidence with an observable oracle`,
      );
    }
  }
}

function validatePacketDocument(snapshot) {
  const document = parseDocument(snapshot.release, snapshot.releasePath);
  const definitions = definitionDestinations(document);
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
  const acceptanceEvidence = requireSection(
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
  if (
    !versionDecisionMatches(
      version,
      snapshot.version,
      snapshot.previousTag,
    )
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.releasePath,
      `version decision must begin with exact tokens ${snapshot.version} and ${snapshot.previousTag}`,
    );
  }

  const scopeBuckets = subsectionMap(scope, snapshot.releasePath);
  const scopedNodes = SCOPE_BUCKETS.flatMap(
    (name) => requireScopeBucket(scopeBuckets, name, snapshot.releasePath).nodes,
  );
  for (const name of scopeBuckets.keys()) {
    if (!SCOPE_BUCKETS.includes(name)) {
      reject(
        "E_RELEASE_PACKET_SCOPE",
        snapshot.releasePath,
        `scope contains undeclared bucket '${name}'`,
      );
    }
  }
  const goalpostItems = listItems(goalposts.nodes);
  if (goalpostItems.length < 2 || goalpostItems.length > 5) {
    reject(
      "E_RELEASE_PACKET_GOALPOSTS",
      snapshot.releasePath,
      `section 'Goalposts' must contain two to five list items; found ${goalpostItems.length}`,
    );
  }
  validateGoalpostEvidence(
    goalpostItems,
    listItems(acceptanceEvidence.nodes),
    definitions,
    snapshot.releasePath,
  );

  const scopedIssueNumbers = issueNumbers(scopedSlices.nodes, definitions);
  if (scopedIssueNumbers.size === 0) {
    reject(
      "E_RELEASE_PACKET_SCOPE",
      snapshot.releasePath,
      "section 'Scoped slices' must contain at least one repository issue link",
    );
  }
  const referencedIssueNumbers = issueNumbers(
    [...scopedNodes, ...goalposts.nodes],
    definitions,
  );
  for (const issue of referencedIssueNumbers) {
    if (!scopedIssueNumbers.has(issue)) {
      reject(
        "E_RELEASE_PACKET_SCOPE",
        snapshot.releasePath,
        `issue #${issue} appears in scope or goalposts but not in 'Scoped slices'`,
      );
    }
  }
  for (const issue of scopedIssueNumbers) {
    if (!referencedIssueNumbers.has(issue)) {
      reject(
        "E_RELEASE_PACKET_SCOPE",
        snapshot.releasePath,
        `issue #${issue} appears in 'Scoped slices' but not in scope or goalposts`,
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
  const definitions = definitionDestinations(document);
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
  const statusText = sectionText(status);
  const targetMatches = [
    ...statusText.matchAll(
      /Target version:\s*(\d+\.\d+\.\d+)(?![\d.])/giu,
    ),
  ];
  if (
    targetMatches.length !== 1 ||
    targetMatches[0][1] !== snapshot.version
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.verificationPath,
      `section 'Status' must name target version ${snapshot.version} exactly once`,
    );
  }
  const previousTagMatches = [
    ...statusText.matchAll(
      /Previous public tag:\s*(v\d+\.\d+\.\d+)(?![\d.])/giu,
    ),
  ];
  if (
    previousTagMatches.length !== 1 ||
    previousTagMatches[0][1] !== snapshot.previousTag
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.verificationPath,
      `section 'Status' must name previous public tag ${snapshot.previousTag} exactly once`,
    );
  }
  const targetTagMatches = [
    ...statusText.matchAll(
      /Annotated\s+(v\d+\.\d+\.\d+)\s+tag:\s*(not available|unavailable|pending|available)\b/giu,
    ),
  ];
  const expectedTargetTag = `v${snapshot.version}`;
  if (
    targetTagMatches.length !== 1 ||
    targetTagMatches[0][1] !== expectedTargetTag
  ) {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      snapshot.verificationPath,
      `section 'Status' must name annotated target tag ${expectedTargetTag} exactly once`,
    );
  }
  const phaseMatches = [
    ...statusText.matchAll(
      /Release phase:\s*(pre-publication|published|verified|retrospected)\b/giu,
    ),
  ];
  if (phaseMatches.length !== 1) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      snapshot.verificationPath,
      `section 'Status' must name exactly one release phase: ${RELEASE_PHASES.join(", ")}`,
    );
  }
  const phase = phaseMatches[0][1].toLowerCase();
  const phaseIndex = RELEASE_PHASES.indexOf(phase);
  if (phaseIndex === 0 && snapshot.targetCommit !== undefined) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      snapshot.verificationPath,
      `release phase ${phase} cannot be pre-publication while ${expectedTargetTag} already resolves to ${snapshot.targetCommit}`,
    );
  }
  if (snapshot.previousPhase !== undefined) {
    const previousPhaseIndex = RELEASE_PHASES.indexOf(
      snapshot.previousPhase,
    );
    if (
      previousPhaseIndex === -1 ||
      phaseIndex < previousPhaseIndex
    ) {
      reject(
        "E_RELEASE_PACKET_EVIDENCE",
        snapshot.verificationPath,
        `release phase ${phase} cannot regress from branch-base phase ${snapshot.previousPhase}`,
      );
    }
  }
  const targetTagState = targetTagMatches[0][2].toLowerCase();
  const expectedTargetTagState = phaseIndex === 0 ? "unavailable" : "available";
  if (
    (targetTagState === "available" ? "available" : "unavailable") !==
    expectedTargetTagState
  ) {
    reject(
      "E_RELEASE_PACKET_EVIDENCE",
      snapshot.verificationPath,
      `section 'Status' must keep annotated target tag ${expectedTargetTag} ${expectedTargetTagState} during the ${phase} phase`,
    );
  }
  const evidenceSections = [
    {
      name: "Publication evidence",
      section: publication,
      completedFrom: 1,
      validate: () =>
        requirePublicationEvidence(
          publication,
          definitions,
          snapshot.version,
          snapshot.targetCommit,
          snapshot.verificationPath,
        ),
    },
    {
      name: "Public verification",
      section: publicVerification,
      completedFrom: 2,
      validate: () =>
        requirePublicVerificationEvidence(
          publicVerification,
          definitions,
          snapshot.verificationPath,
        ),
    },
    {
      name: "Retrospective",
      section: retrospective,
      completedFrom: 3,
      validate: () =>
        requireRetrospectiveEvidence(
          retrospective,
          definitions,
          snapshot.verificationPath,
        ),
    },
  ];
  for (const evidence of evidenceSections) {
    if (phaseIndex >= evidence.completedFrom) {
      evidence.validate();
    } else {
      requireEvidenceState(
        evidence.section,
        evidence.name,
        "unavailable",
        definitions,
        snapshot.verificationPath,
      );
    }
  }
  return { phase };
}

function shellCodeBeforeComment(line, initialQuote) {
  let quote = initialQuote;
  let escaped = false;
  const syntax = [];
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      syntax.push(quote === null ? character : " ");
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      syntax.push(quote === null ? character : " ");
      escaped = true;
      continue;
    }
    if (quote === null && ["'", '"', "`"].includes(character)) {
      quote = character;
      syntax.push(" ");
    } else if (character === quote) {
      quote = null;
      syntax.push(" ");
    } else if (
      quote === null &&
      character === "#" &&
      (index === 0 || /[ \t;&|()<>]/u.test(line[index - 1]))
    ) {
      return {
        code: line.slice(0, index),
        quote,
        syntax: syntax.join(""),
      };
    } else {
      syntax.push(quote === null ? character : " ");
    }
  }
  return { code: line, quote, syntax: syntax.join("") };
}

function hereDocumentDelimiter(scannedLine) {
  const pattern =
    /<<-?\s*['"]?(?<delimiter>[A-Za-z_][A-Za-z0-9_]*)['"]?/gu;
  for (const match of scannedLine.code.matchAll(pattern)) {
    if (scannedLine.syntax.slice(match.index, match.index + 2) === "<<") {
      return match.groups.delimiter;
    }
  }
  return undefined;
}

function topLevelShellCommands(source) {
  const commands = [];
  let depth = 0;
  let hereDocument;
  let quote = null;
  for (const line of source.split(/\r?\n/u)) {
    if (hereDocument !== undefined) {
      if (line.trim() === hereDocument) {
        hereDocument = undefined;
      }
      continue;
    }
    const startedInsideQuote = quote !== null;
    const scannedLine = shellCodeBeforeComment(line, quote);
    quote = scannedLine.quote;
    if (startedInsideQuote || quote !== null) {
      continue;
    }
    const trimmed = scannedLine.syntax.trim();
    hereDocument = hereDocumentDelimiter(scannedLine);
    if (
      /^(?:done|esac|fi)\b/u.test(trimmed) ||
      trimmed === "}" ||
      trimmed === ")"
    ) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      depth === 0 &&
      /^(?:exec|exit|return)(?:\s|$)/u.test(trimmed)
    ) {
      break;
    }
    if (
      depth === 0 &&
      (trimmed === SELF_TEST_COMMAND || trimmed === CHECK_COMMAND)
    ) {
      commands.push(trimmed);
    }
    if (
      /^(?:case|for|if|select|until|while)\b/u.test(trimmed) ||
      /^(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*(?:\s*\(\s*\))?\s*\{/u.test(
        trimmed,
      ) ||
      trimmed === "(" ||
      trimmed === "{" ||
      /(?:&&|\|\||;|&)\s*[({]\s*(?:#.*)?$/u.test(trimmed)
    ) {
      depth += 1;
    }
  }
  return commands;
}

function commandsRunInOrder(commands) {
  const selfTestIndex = commands.indexOf(SELF_TEST_COMMAND);
  const checkIndex = commands.indexOf(CHECK_COMMAND);
  return (
    selfTestIndex !== -1 &&
    checkIndex !== -1 &&
    selfTestIndex < checkIndex
  );
}

function isFailClosedWorkflowEntry(entry) {
  return (
    !Object.hasOwn(entry, "if") &&
    (entry["continue-on-error"] === undefined ||
      entry["continue-on-error"] === false)
  );
}

function workflowJobRunsCommandsInOrder(job) {
  if (
    job === null ||
    typeof job !== "object" ||
    Array.isArray(job) ||
    !Array.isArray(job.steps) ||
    !isFailClosedWorkflowEntry(job)
  ) {
    return false;
  }
  const commands = job.steps.flatMap((step) =>
    step !== null &&
    typeof step === "object" &&
    !Array.isArray(step) &&
    typeof step.run === "string" &&
    isFailClosedWorkflowEntry(step)
      ? topLevelShellCommands(step.run)
      : [],
  );
  return commandsRunInOrder(commands);
}

function workflowJobNeeds(job) {
  if (
    job === null ||
    typeof job !== "object" ||
    Array.isArray(job) ||
    job.needs === undefined
  ) {
    return [];
  }
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
  return needs.every((dependency) => typeof dependency === "string")
    ? needs
    : [];
}

function workflowJobDependsOn(jobs, jobName, dependency, visited = new Set()) {
  if (visited.has(jobName)) {
    return false;
  }
  visited.add(jobName);
  return workflowJobNeeds(jobs[jobName]).some(
    (neededJob) =>
      neededJob === dependency ||
      workflowJobDependsOn(jobs, neededJob, dependency, visited),
  );
}

function workflowRunsCommandsInOrder(source, gate) {
  let workflow;
  try {
    workflow = parseYaml(source);
  } catch (error) {
    reject(
      "E_RELEASE_PACKET_GATE",
      gate,
      `cannot parse workflow YAML: ${error.message}`,
    );
  }
  if (
    workflow === null ||
    typeof workflow !== "object" ||
    workflow.jobs === null ||
    typeof workflow.jobs !== "object"
  ) {
    return false;
  }
  if (gate === ".github/workflows/release.yml") {
    const admissionJob = "validate-release";
    return (
      workflowJobRunsCommandsInOrder(workflow.jobs[admissionJob]) &&
      Object.keys(workflow.jobs).every(
        (jobName) =>
          jobName === admissionJob ||
          workflowJobDependsOn(workflow.jobs, jobName, admissionJob),
      )
    );
  }
  return Object.values(workflow.jobs).some(workflowJobRunsCommandsInOrder);
}

function validateGateWiring(snapshot) {
  for (const [gate, source] of Object.entries(snapshot.gateSources)) {
    const commandsAreExecutable = gate.endsWith(".yml")
      ? workflowRunsCommandsInOrder(source, gate)
      : commandsRunInOrder(topLevelShellCommands(source));
    if (!commandsAreExecutable) {
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

export function loadRepositorySnapshot(
  root = ROOT,
  { publicTags = repositoryTags(root) } = {},
) {
  const manifest = parseToml(readRequiredFile(root, "Cargo.toml"));
  const version = manifest.workspace?.package?.version;
  if (typeof version !== "string") {
    reject(
      "E_RELEASE_PACKET_IDENTITY",
      "Cargo.toml",
      "workspace.package.version must be a string",
    );
  }
  const previous = previousPublicRelease(root, version, publicTags);
  const releasePath = `docs/goalposts/v${version}/release.md`;
  const verificationPath =
    `docs/goalposts/v${version}/verification.md`;
  return {
    version,
    previousTag: previous.tag,
    previousPhase: baselineReleasePhase(root, verificationPath),
    targetCommit: targetTagCommit(root, version, publicTags),
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
