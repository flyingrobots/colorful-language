#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const REPOSITORY_URL = "https://github.com/flyingrobots/colorful-language";
const CARGO_DENY_ACTION =
  "taiki-e/install-action@41049aa56687c35e0afa74eed4f09cec4f9afabf";
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
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
];
const DEPENDENCY_LICENSES = [
  ...RUST_LICENSES,
  "BlueOak-1.0.0",
  "ISC",
].toSorted();
const REQUIRED_COMMANDS = [
  "node --test scripts/check-repository-maintenance.test.mjs",
  "node scripts/check-repository-maintenance.mjs",
];
const RUST_POLICY_COMMANDS = [
  "bash scripts/check-rust-advisories.test.sh",
  "bash scripts/check-rust-advisories.sh",
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

function sortedStrings(values, code, path) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    reject(code, path, "expected a string array");
  }
  return values.toSorted();
}

function sameStrings(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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

function validateIssueConfig(config) {
  const path = ".github/ISSUE_TEMPLATE/config.yml";
  requireObject(config, "E_ISSUE_CONFIG", path);
  if (config.blank_issues_enabled !== false) {
    reject(
      "E_ISSUE_BLANK",
      `${path}:blank_issues_enabled`,
      "must be false so intake uses the reviewed forms",
    );
  }
  const expected = new Map([
    [
      "support",
      `${REPOSITORY_URL}/discussions/categories/q-a`,
    ],
    [
      "design",
      `${REPOSITORY_URL}/discussions/categories/ideas`,
    ],
  ]);
  if (!Array.isArray(config.contact_links) || config.contact_links.length !== 2) {
    reject(
      "E_DISCUSSION_ROUTE",
      `${path}:contact_links`,
      "must contain exactly the support and design routes",
    );
  }
  const observed = new Map();
  for (const [index, link] of config.contact_links.entries()) {
    if (
      typeof link?.name !== "string" ||
      typeof link?.url !== "string" ||
      typeof link?.about !== "string" ||
      link.about.trim() === ""
    ) {
      reject(
        "E_DISCUSSION_ROUTE",
        `${path}:contact_links[${index}]`,
        "must provide name, URL, and explanatory text",
      );
    }
    const route = [...expected].find(([, url]) => url === link.url);
    if (route === undefined || observed.has(route[0])) {
      reject(
        "E_DISCUSSION_ROUTE",
        `${path}:contact_links[${index}].url`,
        "must target the repository Q&A or Ideas category exactly once",
      );
    }
    observed.set(route[0], link);
  }
  if ([...expected.keys()].some((route) => !observed.has(route))) {
    reject(
      "E_DISCUSSION_ROUTE",
      `${path}:contact_links`,
      "must retain both the support and design routes",
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

function validateRustPolicy(source) {
  const advisories = tomlSection(source, "advisories");
  if (tomlStringArray(advisories, "ignore", "E_RUST_ADVISORY_EXCEPTION").length) {
    reject(
      "E_RUST_ADVISORY_EXCEPTION",
      "deny.toml:advisories.ignore",
      "blanket advisory exceptions are not permitted",
    );
  }

  const licenses = tomlSection(source, "licenses");
  const allowed = tomlStringArray(licenses, "allow", "E_RUST_LICENSES");
  if (!sameStrings(allowed, RUST_LICENSES.toSorted())) {
    reject(
      "E_RUST_LICENSES",
      "deny.toml:licenses.allow",
      "must equal the reviewed Rust SPDX allowlist",
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

function validateRustSecurityJob(workflow) {
  const path = ".github/workflows/security.yml:jobs.rust-dependency-policy";
  const job = workflow?.jobs?.["rust-dependency-policy"];
  requireObject(job, "E_SECURITY_WORKFLOW", path);
  const install = stepWithUse(job, CARGO_DENY_ACTION);
  if (install?.with?.tool !== CARGO_DENY_VERSION) {
    reject(
      "E_CARGO_DENY_PIN",
      `${path}:steps`,
      `must install ${CARGO_DENY_VERSION} with the reviewed action`,
    );
  }
  for (const command of RUST_POLICY_COMMANDS) {
    if (!hasRun(job, command)) {
      reject(
        "E_SECURITY_WORKFLOW",
        `${path}:steps`,
        `must run ${JSON.stringify(command)}`,
      );
    }
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
  if (job.if !== "github.event_name == 'pull_request'") {
    reject(
      "E_DEPENDENCY_REVIEW",
      `${path}:if`,
      "must run only for pull requests",
    );
  }
  const step = stepWithUse(job, DEPENDENCY_REVIEW_ACTION);
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
  const init = stepWithUse(job, CODEQL_INIT_ACTION);
  const analyze = stepWithUse(job, CODEQL_ANALYZE_ACTION);
  if (
    init?.with?.languages !== "${{ matrix.language }}" ||
    init.with?.["build-mode"] !== "${{ matrix.build-mode }}" ||
    analyze === undefined
  ) {
    reject(
      "E_CODEQL_WORKFLOW",
      `${path}:steps`,
      "must initialize and analyze every reviewed matrix leg",
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
}

function validateOwnership(codeowners, ruleset) {
  if (codeowners !== "* @flyingrobots\n") {
    reject(
      "E_CODEOWNERS",
      ".github/CODEOWNERS",
      "must assign the repository to @flyingrobots exactly",
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
  validateIssueConfig(candidate.issueConfig);
  validateRustPolicy(candidate.rustPolicy);

  requireObject(
    candidate.securityWorkflow,
    "E_SECURITY_WORKFLOW",
    ".github/workflows/security.yml",
  );
  validateSecurityEvents(candidate.securityWorkflow);
  validateRustSecurityJob(candidate.securityWorkflow);
  validateDependencyReview(candidate.securityWorkflow);
  validateCodeQl(candidate.securityWorkflow);
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

export function repositoryCandidate() {
  return {
    bugForm: parseOptionalYaml(".github/ISSUE_TEMPLATE/bug.yml"),
    featureForm: parseOptionalYaml(".github/ISSUE_TEMPLATE/feature.yml"),
    issueConfig: parseOptionalYaml(".github/ISSUE_TEMPLATE/config.yml"),
    rustPolicy: readOptional("deny.toml"),
    securityWorkflow: parseOptionalYaml(".github/workflows/security.yml"),
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
