#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  WorkflowSecurityPolicyError,
  WORKFLOW_SECURITY_COMMANDS,
  validateWorkflowSecurityPolicy,
} from "./workflow-security-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const REPOSITORY_URL = "https://github.com/flyingrobots/colorful-language";
const REPOSITORY_HOMEPAGE = `${REPOSITORY_URL}#readme`;
const REPOSITORY_OWNER = "@flyingrobots";
const DELIVERY_ISSUE_ROLES = ["release-trains", "slices"];
const DELIVERY_MILESTONE_ROLE = "goalposts";
const RELEASE_ISSUE_FORMAT = "[release] v{version}";
const RELEASE_TRACKING_LABELS = [
  "area:core",
  "documentation",
  "slice",
];
const DELIVERY_REFERENCE_CLAIMS = [
  "GitHub milestones are goalposts.",
  "Release trains use one versioned tracking issue; slice issues keep their goalpost milestone.",
];
const COMPETING_DELIVERY_REFERENCE_PATTERNS = [
  /\buse\s+GitHub milestones?\s+as\s+release buckets?\b/i,
  /\bGitHub milestones?\s+are\s+release buckets?\b/i,
  /\brelease trains?\s+use\s+(?:GitHub )?milestones?\b/i,
  /\btrack\s+releases?\s+(?:in|using|with)\s+GitHub milestones?\b/i,
  /\bassign\s+releases?\s+to\s+GitHub milestones?\b/i,
];
const RELEASE_TRACKING_REFERENCE_CLAIMS = [
  "complete and review the packet's release thesis",
  "bash scripts/release-prep.sh",
];
const RELEASE_TRACKING_LABEL_PATTERN =
  /--label (?<label>[a-z0-9][a-z0-9:._-]*)/gu;
const RELEASE_TRACKING_REFERENCE_PATTERNS = [
  /--title "\[release\] v(?<version>\d+\.\d+\.\d+)"/u,
  /--body-file docs\/goalposts\/v(?<version>\d+\.\d+\.\d+)\/release\.md/u,
  /git switch -c release\/v(?<version>\d+\.\d+\.\d+)/u,
];
const DELIVERY_REFERENCE_PATHS = Object.freeze({
  agents: "AGENTS.md",
  contributing: "CONTRIBUTING.md",
  maintenance: "docs/workflows/repository-maintenance/README.md",
  releasing: "docs/RELEASING.md",
  releaseProcess: "docs/workflows/release-process/README.md",
  roadmap: "ROADMAP.md",
});
const DEPLOYMENT_CREDENTIALS = [
  "CARGO_REGISTRY_TOKEN",
  "OVSX_PAT",
  "VSCE_PAT",
];
const DEPLOYMENT_EVIDENCE = [
  "bash scripts/release-prep.sh",
  "node scripts/verify-editor-publication.mjs",
  "npm --prefix editors/vscode run smoke:package",
];
const CHECKOUT_ACTION =
  "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const RUST_TOOLCHAIN_ACTION =
  "dtolnay/rust-toolchain@4cda84d5c5c54efe2404f9d843567869ab1699d4";
const INSTALL_ACTION =
  "taiki-e/install-action@41049aa56687c35e0afa74eed4f09cec4f9afabf";
const SETUP_NODE_ACTION =
  "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444";
const DEPENDENCY_REVIEW_ACTION =
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294";
const CODEQL_INIT_ACTION =
  "github/codeql-action/init@e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81";
const CODEQL_ANALYZE_ACTION =
  "github/codeql-action/analyze@e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81";
const CARGO_DENY_VERSION = "cargo-deny@0.18.9";
const RUST_LICENSES = [
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "MIT",
  "NCSA",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
];
const DEPENDENCY_LICENSES = [
  ...RUST_LICENSES,
  "Artistic-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-3.0",
  "CC0-1.0",
  "ISC",
  "Python-2.0",
].toSorted();
const DEPENDENCY_LICENSE_EXCEPTIONS = [
  "pkg:npm/@azu/style-format@1.0.1",
  "pkg:npm/@vscode/vsce-sign@2.0.9",
  "pkg:npm/@vscode/vsce-sign-alpine-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-alpine-x64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-darwin-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-darwin-x64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-linux-arm@2.0.6",
  "pkg:npm/@vscode/vsce-sign-linux-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-linux-x64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-win32-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-win32-x64@2.0.6",
  "pkg:npm/ovsx@1.0.2",
  "pkg:npm/typed-rest-client@1.8.11",
  "pkg:npm/xmlbuilder@11.0.1",
].toSorted();
const REQUIRED_COMMANDS = [
  "node --test scripts/check-repository-maintenance.test.mjs",
  "node scripts/check-repository-maintenance.mjs",
];
const RUST_POLICY_COMMANDS = [
  "bash scripts/check-rust-dependency-policy.test.sh",
  "bash scripts/check-rust-dependency-policy.sh",
];

export class RepositoryMaintenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RepositoryMaintenanceError";
    this.code = code;
  }
}

function reject(code, path, message) {
  throw new RepositoryMaintenanceError(code, `${path}: ${message}`);
}

function requireObject(value, code, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(code, path, "expected an object");
  }
  return value;
}

function sameStrings(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameStringSet(actual, expected) {
  return (
    new Set(actual).size === actual.length &&
    new Set(expected).size === expected.length &&
    sameStrings(actual.toSorted(), expected.toSorted())
  );
}

function requireExactKeys(value, expected, code, path) {
  const wanted = expected.toSorted();
  const keys = Object.keys(requireObject(value, code, path)).toSorted();
  if (!sameStrings(keys, wanted)) {
    reject(
      code,
      path,
      `must contain only ${wanted.join(", ")}`,
    );
  }
}

function containsKey(value, key) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([candidate, nested]) =>
      candidate === key || containsKey(nested, key),
  );
}

function oneVersionMatch(reference, pattern) {
  const matches = [
    ...reference.matchAll(
      new RegExp(pattern.source, `${pattern.flags}g`),
    ),
  ];
  return matches.length === 1
    ? matches[0].groups?.version
    : undefined;
}

function normalizeReference(reference) {
  return typeof reference === "string"
    ? reference.replace(/`/gu, "").replace(/\s+/gu, " ")
    : reference;
}

function validateDeliveryTracking(
  profile,
  releaseProfile,
  deliveryReferences,
) {
  const trackerPath = ".github/repository-profile.yml:delivery_tracker";
  requireExactKeys(
    profile.delivery_tracker,
    ["issue_roles", "milestone_role", "release_issue_format"],
    "E_DELIVERY_TRACKING",
    trackerPath,
  );
  if (
    !Array.isArray(profile.delivery_tracker.issue_roles) ||
    !sameStringSet(
      profile.delivery_tracker.issue_roles,
      DELIVERY_ISSUE_ROLES,
    ) ||
    profile.delivery_tracker.milestone_role !==
      DELIVERY_MILESTONE_ROLE ||
    profile.delivery_tracker.release_issue_format !==
      RELEASE_ISSUE_FORMAT
  ) {
    reject(
      "E_DELIVERY_TRACKING",
      trackerPath,
      "must keep slices and release trains on issues, with goalposts on milestones",
    );
  }

  const versioning = requireObject(
    releaseProfile?.versioning,
    "E_DELIVERY_TRACKING",
    ".continuum/release.yml:versioning",
  );
  if (
    containsKey(versioning, "milestone_format") ||
    versioning.release_tracking_issue_format !==
      RELEASE_ISSUE_FORMAT
  ) {
    reject(
      "E_DELIVERY_TRACKING",
      ".continuum/release.yml:versioning",
      "must name the versioned tracking issue without a competing release-milestone format",
    );
  }

  requireExactKeys(
    deliveryReferences,
    Object.keys(DELIVERY_REFERENCE_PATHS),
    "E_DELIVERY_TRACKING",
    "delivery references",
  );
  for (const [key, path] of Object.entries(
    DELIVERY_REFERENCE_PATHS,
  )) {
    const reference = normalizeReference(deliveryReferences[key]);
    if (
      typeof reference !== "string" ||
      DELIVERY_REFERENCE_CLAIMS.some(
        (claim) => !reference.includes(claim),
      ) ||
      COMPETING_DELIVERY_REFERENCE_PATTERNS.some((pattern) =>
        pattern.test(reference),
      )
    ) {
      reject(
        "E_DELIVERY_TRACKING",
        path,
        "must distinguish goalpost milestones from versioned release-tracking issues",
      );
    }
  }
  const releasingReference = normalizeReference(
    deliveryReferences.releasing,
  );
  const releaseExampleVersions =
    RELEASE_TRACKING_REFERENCE_PATTERNS.map(
      (pattern) => oneVersionMatch(releasingReference, pattern),
    );
  const releaseTrackingLabels = [
    ...releasingReference.matchAll(RELEASE_TRACKING_LABEL_PATTERN),
  ].map((match) => match.groups?.label);
  if (
    RELEASE_TRACKING_REFERENCE_CLAIMS.some(
      (claim) => !releasingReference.includes(claim),
    ) ||
    releaseExampleVersions.some((version) => version === undefined) ||
    new Set(releaseExampleVersions).size !== 1 ||
    !sameStringSet(releaseTrackingLabels, RELEASE_TRACKING_LABELS)
  ) {
    reject(
      "E_DELIVERY_TRACKING",
      DELIVERY_REFERENCE_PATHS.releasing,
      "must retain one aligned release-tracking example, its exact role and area labels, and its preparation command",
    );
  }
}

function validateRepositoryProfile(
  profile,
  maintenanceReference,
  releaseProfile,
  deliveryReferences,
) {
  const path = ".github/repository-profile.yml";
  requireExactKeys(
    profile,
    [
      "delivery_tracker",
      "deployment",
      "discussions",
      "homepage",
      "version",
    ],
    "E_REPOSITORY_PROFILE",
    path,
  );
  if (
    profile.version !== 2 ||
    profile.homepage !== REPOSITORY_HOMEPAGE
  ) {
    reject(
      "E_REPOSITORY_PROFILE",
      path,
      "must retain the reviewed version, homepage, and delivery authority",
    );
  }
  validateDeliveryTracking(
    profile,
    releaseProfile,
    deliveryReferences,
  );

  const discussionsPath = `${path}:discussions`;
  requireExactKeys(
    profile.discussions,
    ["owner", "promoted_categories", "supported_intake"],
    "E_DISCUSSION_ROUTE",
    discussionsPath,
  );
  if (
    profile.discussions.supported_intake !== false ||
    profile.discussions.owner !== null ||
    !Array.isArray(profile.discussions.promoted_categories) ||
    profile.discussions.promoted_categories.length !== 0
  ) {
    reject(
      "E_DISCUSSION_ROUTE",
      discussionsPath,
      "must not promote Discussions without a supported intake owner",
    );
  }

  const deploymentPath = `${path}:deployment`;
  requireExactKeys(
    profile.deployment,
    [
      "create_environment_when",
      "credential_owner",
      "credential_secrets",
      "environment",
      "evidence",
      "owner",
      "rollback_owner",
    ],
    "E_DEPLOYMENT_OWNERSHIP",
    deploymentPath,
  );
  if (
    profile.deployment.environment !== null ||
    profile.deployment.owner !== REPOSITORY_OWNER ||
    profile.deployment.credential_owner !== REPOSITORY_OWNER ||
    profile.deployment.rollback_owner !== REPOSITORY_OWNER
  ) {
    reject(
      "E_DEPLOYMENT_OWNERSHIP",
      deploymentPath,
      "must name the solo owner and must not claim an environment exists",
    );
  }
  if (
    !Array.isArray(profile.deployment.credential_secrets) ||
    !sameStringSet(
      profile.deployment.credential_secrets,
      DEPLOYMENT_CREDENTIALS,
    )
  ) {
    reject(
      "E_DEPLOYMENT_CREDENTIALS",
      `${deploymentPath}.credential_secrets`,
      "must equal the reviewed release-secret inventory",
    );
  }
  if (
    !Array.isArray(profile.deployment.evidence) ||
    !sameStringSet(profile.deployment.evidence, DEPLOYMENT_EVIDENCE)
  ) {
    reject(
      "E_DEPLOYMENT_EVIDENCE",
      `${deploymentPath}.evidence`,
      "must equal the reviewed release-evidence inventory",
    );
  }
  if (
    typeof profile.deployment.create_environment_when !== "string" ||
    profile.deployment.create_environment_when.trim() === ""
  ) {
    reject(
      "E_DEPLOYMENT_OWNERSHIP",
      `${deploymentPath}.create_environment_when`,
      "must name the environment-creation threshold",
    );
  }

  const requiredReference = [
    "Issues and milestones are the delivery authority",
    "Discussions are not a supported intake channel",
    REPOSITORY_HOMEPAGE,
    "No GitHub deployment environment exists",
    `${REPOSITORY_OWNER} owns release execution`,
    "rollback decisions",
    ...DEPLOYMENT_CREDENTIALS,
    ...DEPLOYMENT_EVIDENCE,
  ];
  const normalizedReference = normalizeReference(maintenanceReference);
  if (
    typeof normalizedReference !== "string" ||
    requiredReference.some(
      (required) => !normalizedReference.includes(required),
    )
  ) {
    reject(
      "E_REPOSITORY_REFERENCE",
      "docs/workflows/repository-maintenance/README.md",
      "must describe the reviewed public and deployment posture",
    );
  }
}

function validateIssueForm(form, { path, label, requiredFields }) {
  requireObject(form, "E_ISSUE_FORM", path);
  for (const key of ["name", "description", "title"]) {
    if (typeof form[key] !== "string" || form[key].trim() === "") {
      reject("E_ISSUE_FORM", `${path}:${key}`, "must be a non-empty string");
    }
  }
  if (!Array.isArray(form.labels) || !form.labels.includes(label)) {
    reject(
      "E_ISSUE_FORM_LABEL",
      `${path}:labels`,
      `must include ${JSON.stringify(label)}`,
    );
  }
  if (!Array.isArray(form.body)) {
    reject("E_ISSUE_FORM", `${path}:body`, "must be an array");
  }

  const fields = new Map();
  for (const [index, entry] of form.body.entries()) {
    if (entry?.id === undefined) {
      continue;
    }
    if (typeof entry.id !== "string" || fields.has(entry.id)) {
      reject(
        "E_ISSUE_FORM_FIELD",
        `${path}:body[${index}].id`,
        "must be a unique string",
      );
    }
    fields.set(entry.id, entry);
  }

  for (const id of requiredFields) {
    const field = fields.get(id);
    if (
      field === undefined ||
      !["input", "textarea"].includes(field.type) ||
      field.attributes === null ||
      typeof field.attributes !== "object" ||
      typeof field.attributes.label !== "string" ||
      field.attributes.label.trim() === "" ||
      field.validations?.required !== true
    ) {
      reject(
        "E_ISSUE_FORM_REQUIRED",
        `${path}:body.${id}`,
        "must be a required input or textarea with a label",
      );
    }
  }
}

function validateIssueConfig(config, repositoryProfile) {
  const path = ".github/ISSUE_TEMPLATE/config.yml";
  requireObject(config, "E_ISSUE_CONFIG", path);
  if (config.blank_issues_enabled !== false) {
    reject(
      "E_ISSUE_BLANK",
      `${path}:blank_issues_enabled`,
      "must be false so intake uses the reviewed forms",
    );
  }
  if (
    repositoryProfile?.discussions?.supported_intake !== false ||
    !Array.isArray(config.contact_links) ||
    config.contact_links.length !== 0
  ) {
    reject(
      "E_DISCUSSION_ROUTE",
      `${path}:contact_links`,
      "must stay empty while Discussions have no supported intake owner",
    );
  }
}

function validateIssueFormDiscussionClaims(
  forms,
  repositoryProfile,
) {
  const markdown = forms.flatMap((form) =>
    Array.isArray(form?.body)
      ? form.body
        .filter((entry) => entry?.type === "markdown")
        .map((entry) => String(entry.attributes?.value ?? ""))
      : [],
  );
  const claims = markdown.join("\n");
  const advertisesDiscussion =
    /\b(?:Discussions?|Q&A)\b/u.test(claims) ||
    /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/discussions(?:[/?#]|\b)/iu
      .test(claims);
  if (
    repositoryProfile?.discussions?.supported_intake === false &&
    advertisesDiscussion
  ) {
    reject(
      "E_DISCUSSION_ROUTE",
      ".github/ISSUE_TEMPLATE",
      "forms must not advertise an unowned Discussion intake surface",
    );
  }
}

function tomlSection(source, name) {
  const path = "deny.toml";
  if (typeof source !== "string") {
    reject("E_RUST_POLICY", path, "file is missing");
  }
  const header = `[${name}]`;
  const start = source
    .split(/\r?\n/u)
    .findIndex((line) => line.trim() === header);
  if (start === -1) {
    reject("E_RUST_POLICY", `${path}:${header}`, "section is missing");
  }
  const lines = source.split(/\r?\n/u).slice(start + 1);
  const end = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/u.test(line));
  return (end === -1 ? lines : lines.slice(0, end)).join("\n");
}

function tomlStringArray(section, key, code) {
  const match = section.match(
    new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "mu"),
  );
  if (match === null) {
    reject(code, `deny.toml:${key}`, "string array is missing");
  }
  const values = [...match[1].matchAll(/"([^"]+)"/gu)].map(
    (value) => value[1],
  );
  const residue = match[1].replace(/"[^"]+"/gu, "").replace(/[\s,]/gu, "");
  if (residue !== "") {
    reject(code, `deny.toml:${key}`, "contains unsupported TOML syntax");
  }
  return values.toSorted();
}

function tomlString(section, key, code) {
  const match = section.match(
    new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "mu"),
  );
  if (match === null) {
    reject(code, `deny.toml:${key}`, "string value is missing");
  }
  return match[1];
}

function tomlBoolean(section, key, code) {
  const match = section.match(
    new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, "mu"),
  );
  if (match === null) {
    reject(code, `deny.toml:${key}`, "boolean value is missing");
  }
  return match[1] === "true";
}

function validateAdvisoryExceptions(ignored, policy) {
  const path = ".github/rust-advisory-exceptions.yml";
  requireObject(policy, "E_RUST_ADVISORY_EXCEPTION", path);
  if (policy.version !== 1 || !Array.isArray(policy.exceptions)) {
    reject(
      "E_RUST_ADVISORY_EXCEPTION",
      path,
      "must use version 1 with an exceptions array",
    );
  }

  const ids = new Set();
  for (const [index, exception] of policy.exceptions.entries()) {
    const entryPath = `${path}:exceptions[${index}]`;
    requireObject(exception, "E_RUST_ADVISORY_EXCEPTION", entryPath);
    const keys = Object.keys(exception).toSorted();
    if (!sameStrings(keys, ["id", "owner", "reason", "remove_when"])) {
      reject(
        "E_RUST_ADVISORY_EXCEPTION",
        entryPath,
        "must contain only id, owner, reason, and remove_when",
      );
    }
    if (
      typeof exception.id !== "string" ||
      !/^RUSTSEC-\d{4}-\d{4}$/u.test(exception.id) ||
      ids.has(exception.id)
    ) {
      reject(
        "E_RUST_ADVISORY_EXCEPTION",
        `${entryPath}.id`,
        "must be a unique RustSec advisory ID",
      );
    }
    if (
      typeof exception.owner !== "string" ||
      !/^@[A-Za-z0-9-]+$/u.test(exception.owner)
    ) {
      reject(
        "E_RUST_ADVISORY_EXCEPTION",
        `${entryPath}.owner`,
        "must name one GitHub owner",
      );
    }
    for (const key of ["reason", "remove_when"]) {
      if (
        typeof exception[key] !== "string" ||
        exception[key].trim() === ""
      ) {
        reject(
          "E_RUST_ADVISORY_EXCEPTION",
          `${entryPath}.${key}`,
          "must be a non-empty string",
        );
      }
    }
    ids.add(exception.id);
  }

  if (!sameStrings([...ids].toSorted(), ignored)) {
    reject(
      "E_RUST_ADVISORY_EXCEPTION",
      path,
      "metadata IDs must exactly match deny.toml advisories.ignore",
    );
  }
}

function validateRustPolicy(source, advisoryExceptions) {
  const advisories = tomlSection(source, "advisories");
  const ignored = tomlStringArray(
    advisories,
    "ignore",
    "E_RUST_ADVISORY_EXCEPTION",
  );
  validateAdvisoryExceptions(ignored, advisoryExceptions);

  const licenses = tomlSection(source, "licenses");
  const allowed = tomlStringArray(licenses, "allow", "E_RUST_LICENSES");
  if (!sameStrings(allowed, RUST_LICENSES.toSorted())) {
    reject(
      "E_RUST_LICENSES",
      "deny.toml:licenses.allow",
      "must equal the reviewed Rust SPDX allowlist",
    );
  }
  if (
    tomlString(
      licenses,
      "unused-allowed-license",
      "E_RUST_LICENSES",
    ) !== "allow"
  ) {
    reject(
      "E_RUST_LICENSES",
      "deny.toml:licenses.unused-allowed-license",
      "must permit reviewed licenses used by a different workspace",
    );
  }
  if (!tomlBoolean(licenses, "include-dev", "E_RUST_LICENSES")) {
    reject(
      "E_RUST_LICENSES",
      "deny.toml:licenses.include-dev",
      "must include workspace development dependencies",
    );
  }
  if (tomlStringArray(licenses, "exceptions", "E_RUST_LICENSES").length) {
    reject(
      "E_RUST_LICENSES",
      "deny.toml:licenses.exceptions",
      "per-crate license exceptions are not permitted",
    );
  }

  const sources = tomlSection(source, "sources");
  if (
    tomlString(sources, "unknown-registry", "E_RUST_SOURCES") !== "deny" ||
    tomlString(sources, "unknown-git", "E_RUST_SOURCES") !== "deny"
  ) {
    reject(
      "E_RUST_SOURCES",
      "deny.toml:sources",
      "unknown registries and Git sources must be denied",
    );
  }
  if (
    !sameStrings(
      tomlStringArray(sources, "allow-registry", "E_RUST_SOURCES"),
      ["https://github.com/rust-lang/crates.io-index"],
    ) ||
    tomlStringArray(sources, "allow-git", "E_RUST_SOURCES").length !== 0
  ) {
    reject(
      "E_RUST_SOURCES",
      "deny.toml:sources",
      "only the public crates.io registry may be allowed",
    );
  }
}

function workflowEvents(workflow) {
  return workflow?.on;
}

function validateSecurityEvents(workflow) {
  const events = requireObject(
    workflowEvents(workflow),
    "E_SECURITY_EVENTS",
    ".github/workflows/security.yml:on",
  );
  for (const event of ["push", "pull_request"]) {
    const branches = events[event]?.branches;
    if (!Array.isArray(branches) || !branches.includes("main")) {
      reject(
        "E_SECURITY_EVENTS",
        `.github/workflows/security.yml:on.${event}.branches`,
        "must include main",
      );
    }
  }
  if (
    !Array.isArray(events.schedule) ||
    events.schedule.length !== 1 ||
    events.schedule[0]?.cron !== "17 14 * * 1"
  ) {
    reject(
      "E_SECURITY_EVENTS",
      ".github/workflows/security.yml:on.schedule",
      "must run on the reviewed weekly schedule",
    );
  }
}

function stepWithUse(job, value) {
  return job?.steps?.find((step) => step?.uses === value);
}

function requireBlockingStep(step, path) {
  if (
    step?.if !== undefined ||
    (step?.["continue-on-error"] !== undefined &&
      step["continue-on-error"] !== false)
  ) {
    reject(
      "E_SECURITY_SUPPRESSION",
      path,
      "must run without an if guard or continue-on-error",
    );
  }
}

function requireBlockingJob(job, path, allowedIf) {
  if (
    (allowedIf === undefined && job.if !== undefined) ||
    (allowedIf !== undefined && job.if !== allowedIf) ||
    (job["continue-on-error"] !== undefined &&
      job["continue-on-error"] !== false)
  ) {
    reject(
      "E_SECURITY_SUPPRESSION",
      path,
      "must be failure-blocking with only its reviewed event guard",
    );
  }
}

function requireAction(job, action, path) {
  const step = stepWithUse(job, action);
  if (step === undefined) {
    reject(
      "E_SECURITY_ACTION_PIN",
      path,
      `must use ${action}`,
    );
  }
  requireBlockingStep(step, path);
  return step;
}

function hasRun(job, command) {
  return (
    Array.isArray(job?.steps) &&
    job.steps.some(
      (step) =>
        typeof step?.run === "string" &&
        step.run
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .includes(command),
    )
  );
}

function containsCredentialExpression(value) {
  if (typeof value === "string") {
    return /\$\{\{[^}]*\b(?:secrets|github\.token)\b[^}]*\}\}/u.test(
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.some(containsCredentialExpression);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsCredentialExpression);
  }
  return false;
}

function requireBlockingRun(
  job,
  command,
  path,
  code = "E_SECURITY_WORKFLOW",
) {
  const step = job?.steps?.find(
    (candidate) =>
      typeof candidate?.run === "string" &&
      candidate.run
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .includes(command),
  );
  if (step === undefined) {
    reject(code, path, `must run ${JSON.stringify(command)}`);
  }
  requireBlockingStep(step, path);
}

function validateRustSecurityJob(workflow) {
  const path = ".github/workflows/security.yml:jobs.rust-dependency-policy";
  const job = workflow?.jobs?.["rust-dependency-policy"];
  requireObject(job, "E_SECURITY_WORKFLOW", path);
  requireBlockingJob(job, path);
  requireAction(job, CHECKOUT_ACTION, `${path}:steps`);
  requireAction(job, RUST_TOOLCHAIN_ACTION, `${path}:steps`);
  const install = requireAction(job, INSTALL_ACTION, `${path}:steps`);
  if (install?.with?.tool !== CARGO_DENY_VERSION) {
    reject(
      "E_CARGO_DENY_PIN",
      `${path}:steps`,
      `must install ${CARGO_DENY_VERSION} with the reviewed action`,
    );
  }
  for (const command of RUST_POLICY_COMMANDS) {
    requireBlockingRun(job, command, `${path}:steps`);
  }
}

function commaList(value, code, path) {
  if (typeof value !== "string") {
    reject(code, path, "must be a comma-separated string");
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .toSorted();
}

function validateDependencyReview(workflow) {
  const path = ".github/workflows/security.yml:jobs.dependency-review";
  const job = workflow?.jobs?.["dependency-review"];
  requireObject(job, "E_DEPENDENCY_REVIEW", path);
  requireBlockingJob(job, path, "github.event_name == 'pull_request'");
  const step = requireAction(job, DEPENDENCY_REVIEW_ACTION, `${path}:steps`);
  if (
    step?.with?.["fail-on-severity"] !== "moderate" ||
    step.with?.["fail-on-scopes"] !== "runtime, development, unknown" ||
    step.with?.["license-check"] !== true ||
    step.with?.["vulnerability-check"] !== true ||
    !sameStrings(
      commaList(
        step.with?.["allow-licenses"],
        "E_DEPENDENCY_REVIEW",
        `${path}:allow-licenses`,
      ),
      DEPENDENCY_LICENSES,
    ) ||
    !sameStrings(
      commaList(
        step.with?.["allow-dependencies-licenses"],
        "E_DEPENDENCY_REVIEW",
        `${path}:allow-dependencies-licenses`,
      ),
      DEPENDENCY_LICENSE_EXCEPTIONS,
    )
  ) {
    reject(
      "E_DEPENDENCY_REVIEW",
      `${path}:steps`,
      "must enforce the reviewed vulnerability, scope, and license policy",
    );
  }
}

function validateCodeQl(workflow) {
  const path = ".github/workflows/security.yml:jobs.codeql";
  const job = workflow?.jobs?.codeql;
  requireObject(job, "E_CODEQL_WORKFLOW", path);
  requireBlockingJob(job, path);
  requireAction(job, CHECKOUT_ACTION, `${path}:steps`);
  if (
    job.permissions?.contents !== "read" ||
    job.permissions?.["security-events"] !== "write"
  ) {
    reject(
      "E_CODEQL_PERMISSIONS",
      `${path}:permissions`,
      "must grant read-only contents and code-scanning result upload",
    );
  }
  const include = job.strategy?.matrix?.include;
  if (!Array.isArray(include)) {
    reject("E_CODEQL_LANGUAGES", `${path}:strategy.matrix.include`, "is missing");
  }
  const observed = include
    .map((entry) => `${entry?.language}\u0000${entry?.["build-mode"]}`)
    .toSorted();
  const expected = [
    "javascript-typescript\u0000none",
    "rust\u0000none",
  ];
  if (!sameStrings(observed, expected)) {
    reject(
      observed.some((entry) => !entry.endsWith("\u0000none"))
        ? "E_CODEQL_BUILD_MODE"
        : "E_CODEQL_LANGUAGES",
      `${path}:strategy.matrix.include`,
      "must analyze Rust and JavaScript/TypeScript with build-mode none",
    );
  }
  const init = requireAction(job, CODEQL_INIT_ACTION, `${path}:steps`);
  requireAction(job, CODEQL_ANALYZE_ACTION, `${path}:steps`);
  if (
    init?.with?.languages !== "${{ matrix.language }}" ||
    init.with?.["build-mode"] !== "${{ matrix.build-mode }}"
  ) {
    reject(
      "E_CODEQL_WORKFLOW",
      `${path}:steps`,
      "must initialize and analyze every reviewed matrix leg",
    );
  }
}

function validateWorkflowSecurityJob(workflow, policy) {
  const path = ".github/workflows/security.yml:jobs.workflow-security";
  const job = workflow?.jobs?.["workflow-security"];
  requireObject(job, "E_WORKFLOW_SECURITY_WIRING", path);
  requireBlockingJob(job, path);
  if (containsCredentialExpression(job)) {
    reject(
      "E_WORKFLOW_SECURITY_CREDENTIALS",
      path,
      "must not receive an explicit secret or GitHub token expression",
    );
  }
  const permissionKeys = Object.keys(job.permissions ?? {}).toSorted();
  if (
    !sameStrings(permissionKeys, ["contents"]) ||
    job.permissions.contents !== "read"
  ) {
    reject(
      "E_WORKFLOW_SECURITY_PERMISSIONS",
      `${path}:permissions`,
      "must grant only read access to repository contents",
    );
  }

  const checkout = requireAction(job, CHECKOUT_ACTION, `${path}:steps`);
  if (checkout?.with?.["persist-credentials"] !== false) {
    reject(
      "E_WORKFLOW_SECURITY_CREDENTIALS",
      `${path}:steps`,
      "checkout must set persist-credentials to false",
    );
  }
  const setupNode = requireAction(job, SETUP_NODE_ACTION, `${path}:steps`);
  if (setupNode?.with?.["node-version-file"] !== ".node-version") {
    reject(
      "E_WORKFLOW_SECURITY_WIRING",
      `${path}:steps`,
      "must use the reviewed Node version file",
    );
  }
  const install = requireAction(job, INSTALL_ACTION, `${path}:steps`);
  if (
    install?.with?.tool !== `zizmor@${policy.analyzer.version}` ||
    install.with?.fallback !== "none"
  ) {
    reject(
      "E_WORKFLOW_SECURITY_POLICY",
      `${path}:steps`,
      "installed analyzer must equal the versioned policy with no fallback",
    );
  }
  for (const command of ["npm ci", ...WORKFLOW_SECURITY_COMMANDS]) {
    requireBlockingRun(
      job,
      command,
      `${path}:steps`,
      "E_WORKFLOW_SECURITY_WIRING",
    );
  }
}

function validateCommandWiring(ciWorkflow, releasePrep) {
  const docsJob = ciWorkflow?.jobs?.docs;
  for (const command of REQUIRED_COMMANDS) {
    if (!hasRun(docsJob, command)) {
      reject(
        "E_CI_POLICY",
        ".github/workflows/ci.yml:jobs.docs.steps",
        `must run ${JSON.stringify(command)}`,
      );
    }
    if (
      typeof releasePrep !== "string" ||
      !releasePrep.split(/\r?\n/u).includes(command)
    ) {
      reject(
        "E_RELEASE_PREP",
        "scripts/release-prep.sh",
        `must run ${JSON.stringify(command)}`,
      );
    }
  }
  for (const command of RUST_POLICY_COMMANDS) {
    if (
      typeof releasePrep !== "string" ||
      !releasePrep.split(/\r?\n/u).includes(command)
    ) {
      reject(
        "E_RELEASE_PREP",
        "scripts/release-prep.sh",
        `must run ${JSON.stringify(command)}`,
      );
    }
  }
  for (const command of WORKFLOW_SECURITY_COMMANDS) {
    if (
      typeof releasePrep !== "string" ||
      !releasePrep.split(/\r?\n/u).includes(command)
    ) {
      reject(
        "E_WORKFLOW_SECURITY_WIRING",
        "scripts/release-prep.sh",
        `must run ${JSON.stringify(command)}`,
      );
    }
  }
}

function validateOwnership(codeowners, ruleset) {
  if (codeowners !== `* ${REPOSITORY_OWNER}\n`) {
    reject(
      "E_CODEOWNERS",
      ".github/CODEOWNERS",
      `must assign the repository to ${REPOSITORY_OWNER} exactly`,
    );
  }
  const pullRequestRule = ruleset?.rules?.find(
    (rule) => rule?.type === "pull_request",
  );
  if (pullRequestRule?.parameters?.required_approving_review_count !== 0) {
    reject(
      "E_SOLO_APPROVAL",
      ".github/rulesets/mainline.json:pull_request",
      "must not require a second approval while ownership is solo",
    );
  }
  if (pullRequestRule.parameters?.require_code_owner_review !== false) {
    reject(
      "E_SOLO_CODEOWNERS",
      ".github/rulesets/mainline.json:pull_request",
      "must not require code-owner review while ownership is solo",
    );
  }
}

export function validateRepositoryMaintenance(candidate) {
  validateRepositoryProfile(
    candidate.repositoryProfile,
    candidate.maintenanceReference,
    candidate.releaseProfile,
    candidate.deliveryReferences,
  );
  validateIssueForm(candidate.bugForm, {
    path: ".github/ISSUE_TEMPLATE/bug.yml",
    label: "bug",
    requiredFields: [
      "reproduction",
      "expected",
      "actual",
      "version",
      "environment",
    ],
  });
  validateIssueForm(candidate.featureForm, {
    path: ".github/ISSUE_TEMPLATE/feature.yml",
    label: "enhancement",
    requiredFields: ["problem", "outcome", "alternatives"],
  });
  validateIssueConfig(candidate.issueConfig, candidate.repositoryProfile);
  validateIssueFormDiscussionClaims(
    [candidate.bugForm, candidate.featureForm],
    candidate.repositoryProfile,
  );
  validateRustPolicy(candidate.rustPolicy, candidate.advisoryExceptions);
  let workflowSecurityPolicy;
  try {
    workflowSecurityPolicy = validateWorkflowSecurityPolicy(
      candidate.workflowSecurityPolicy,
      candidate.workflowFiles,
    );
  } catch (error) {
    if (error instanceof WorkflowSecurityPolicyError) {
      reject(error.code, error.path, error.detail);
    }
    throw error;
  }

  requireObject(
    candidate.securityWorkflow,
    "E_SECURITY_WORKFLOW",
    ".github/workflows/security.yml",
  );
  validateSecurityEvents(candidate.securityWorkflow);
  validateRustSecurityJob(candidate.securityWorkflow);
  validateDependencyReview(candidate.securityWorkflow);
  validateCodeQl(candidate.securityWorkflow);
  validateWorkflowSecurityJob(
    candidate.securityWorkflow,
    workflowSecurityPolicy,
  );
  validateCommandWiring(candidate.ciWorkflow, candidate.releasePrep);
  validateOwnership(candidate.codeowners, candidate.ruleset);
}

function readOptional(path) {
  const url = new URL(`../${path}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : undefined;
}

function parseOptionalYaml(path) {
  const source = readOptional(path);
  return source === undefined ? undefined : parseYaml(source);
}

function parseOptionalJson(path) {
  const source = readOptional(path);
  return source === undefined ? undefined : JSON.parse(source);
}

function parseWorkflowFiles() {
  const directory = new URL("../.github/workflows/", import.meta.url);
  if (!existsSync(directory)) {
    return undefined;
  }
  const names = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /\.(?:yaml|yml)$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .toSorted();
  return Object.fromEntries(
    names.map((name) => [
      `.github/workflows/${name}`,
      parseOptionalYaml(`.github/workflows/${name}`),
    ]),
  );
}

export function repositoryCandidate() {
  const workflowFiles = parseWorkflowFiles();
  return {
    repositoryProfile: parseOptionalYaml(
      ".github/repository-profile.yml",
    ),
    maintenanceReference: readOptional(
      "docs/workflows/repository-maintenance/README.md",
    ),
    releaseProfile: parseOptionalYaml(".continuum/release.yml"),
    deliveryReferences: {
      agents: readOptional("AGENTS.md"),
      contributing: readOptional("CONTRIBUTING.md"),
      maintenance: readOptional(
        "docs/workflows/repository-maintenance/README.md",
      ),
      releasing: readOptional("docs/RELEASING.md"),
      releaseProcess: readOptional(
        "docs/workflows/release-process/README.md",
      ),
      roadmap: readOptional("ROADMAP.md"),
    },
    bugForm: parseOptionalYaml(".github/ISSUE_TEMPLATE/bug.yml"),
    featureForm: parseOptionalYaml(".github/ISSUE_TEMPLATE/feature.yml"),
    issueConfig: parseOptionalYaml(".github/ISSUE_TEMPLATE/config.yml"),
    rustPolicy: readOptional("deny.toml"),
    advisoryExceptions: parseOptionalYaml(
      ".github/rust-advisory-exceptions.yml",
    ),
    workflowSecurityPolicy: parseOptionalYaml(
      ".github/workflow-security-policy.yml",
    ),
    workflowFiles,
    securityWorkflow: workflowFiles?.[".github/workflows/security.yml"],
    ciWorkflow: parseOptionalYaml(".github/workflows/ci.yml"),
    releasePrep: readOptional("scripts/release-prep.sh"),
    codeowners: readOptional(".github/CODEOWNERS"),
    ruleset: parseOptionalJson(".github/rulesets/mainline.json"),
  };
}

function main() {
  validateRepositoryMaintenance(repositoryCandidate());
  process.stdout.write("check-repository-maintenance: policy satisfied\n");
}

if (process.argv[1] === scriptPath) {
  try {
    main();
  } catch (error) {
    if (error instanceof RepositoryMaintenanceError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`E_REPOSITORY_MAINTENANCE_IO: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
