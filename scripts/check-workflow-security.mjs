#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  WorkflowSecurityPolicyError,
  validateWorkflowSecurityPolicy,
  zizmorConfig,
} from "./workflow-security-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const policyPath = join(
  repositoryRoot,
  ".github",
  "workflow-security-policy.yml",
);

export class WorkflowSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkflowSecurityError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new WorkflowSecurityError(code, message);
}

function readYaml(path, code) {
  try {
    return parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    reject(code, `${path}: ${error.message}`);
  }
}

function loadPolicy() {
  const policy = readYaml(policyPath, "E_WORKFLOW_SECURITY_POLICY");
  const workflowFiles = Object.fromEntries(
    workflowPaths(repositoryRoot).map((path) => [
      relative(repositoryRoot, path).split(sep).join("/"),
      readYaml(path, "E_WORKFLOW_SECURITY_EXCEPTION"),
    ]),
  );
  return validateWorkflowSecurityPolicy(policy, workflowFiles);
}

function workflowPaths(root) {
  const directory = join(root, ".github", "workflows");
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    reject("E_WORKFLOW_SECURITY_INPUT", `${directory}: ${error.message}`);
  }
  const paths = entries
    .filter(
      (entry) =>
        entry.isFile() && /\.(?:yaml|yml)$/u.test(entry.name),
    )
    .map((entry) => join(directory, entry.name))
    .toSorted();
  if (paths.length === 0) {
    reject(
      "E_WORKFLOW_SECURITY_INPUT",
      `${directory}: no workflow files found`,
    );
  }
  return paths;
}

function checkedSpawn(binary, args, code) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    reject(code, `${binary}: ${result.error.message}`);
  }
  return result;
}

function verifyVersion(binary, version) {
  const result = checkedSpawn(
    binary,
    ["--version"],
    "E_WORKFLOW_SECURITY_VERSION",
  );
  const observed = result.stdout.trim();
  const expected = `zizmor ${version}`;
  if (result.status !== 0 || observed !== expected) {
    reject(
      "E_WORKFLOW_SECURITY_VERSION",
      `${binary}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
    );
  }
}

function localFindingPath(finding, root) {
  const location = finding.locations?.find(
    (candidate) => candidate?.symbolic?.kind === "Primary",
  );
  const verbatim = location?.symbolic?.key?.Local?.verbatim_path;
  if (typeof verbatim !== "string") {
    return "<unknown>";
  }
  const absolute = resolve(root, verbatim);
  return relative(repositoryRoot, absolute).split(sep).join("/");
}

function findingAnnotation(finding) {
  const location = finding.locations?.find(
    (candidate) => candidate?.symbolic?.kind === "Primary",
  );
  return location?.symbolic?.annotation ?? finding.desc ?? "finding";
}

function reportFindings(findings, root) {
  const normalized = findings
    .map((finding) => ({
      rule: finding?.ident ?? "<unknown>",
      path: localFindingPath(finding, root),
      annotation: findingAnnotation(finding),
    }))
    .toSorted(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.rule.localeCompare(right.rule) ||
        left.annotation.localeCompare(right.annotation),
    );
  if (normalized.length === 0) {
    return;
  }
  const details = normalized
    .map(
      ({ rule, path, annotation }) =>
        `${rule}: ${path}: ${annotation}`,
    )
    .join("\n");
  reject("E_WORKFLOW_SECURITY_FINDING", details);
}

function parseArguments(argv) {
  if (argv.length === 0) {
    return { root: repositoryRoot };
  }
  if (argv.length === 2 && argv[0] === "--root") {
    return { root: resolve(argv[1]) };
  }
  reject(
    "E_WORKFLOW_SECURITY_USAGE",
    "usage: scripts/check-workflow-security.mjs [--root PATH]",
  );
}

export function auditWorkflows({
  root = repositoryRoot,
  binary = process.env.ZIZMOR_BIN ?? "zizmor",
} = {}) {
  const policy = loadPolicy();
  const workflows = workflowPaths(root);
  verifyVersion(binary, policy.analyzer.version);

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "colorful-zizmor-"),
  );
  try {
    const configPath = join(temporaryDirectory, "zizmor.yml");
    writeFileSync(configPath, stringifyYaml(zizmorConfig(policy)), "utf8");
    const invocation = policy.invocation;
    const result = checkedSpawn(
      binary,
      [
        "--config",
        configPath,
        "--persona",
        invocation.persona,
        "--min-severity",
        invocation.min_severity,
        "--min-confidence",
        invocation.min_confidence,
        "--offline",
        "--collect",
        invocation.collect,
        "--strict-collection",
        "--format",
        "json",
        "--color",
        "never",
        "--no-progress",
        "--no-exit-codes",
        ...workflows,
      ],
      "E_WORKFLOW_SECURITY_ANALYZER",
    );
    if (result.status !== 0) {
      reject(
        "E_WORKFLOW_SECURITY_ANALYZER",
        result.stderr.trim() || `zizmor exited ${result.status}`,
      );
    }
    let findings;
    try {
      findings = JSON.parse(result.stdout);
    } catch (error) {
      reject(
        "E_WORKFLOW_SECURITY_ANALYZER",
        `zizmor returned invalid JSON: ${error.message}`,
      );
    }
    if (!Array.isArray(findings)) {
      reject(
        "E_WORKFLOW_SECURITY_ANALYZER",
        "zizmor JSON output must be an array",
      );
    }
    reportFindings(findings, root);
    return {
      count: workflows.length,
      version: policy.analyzer.version,
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function main() {
  const { root } = parseArguments(process.argv.slice(2));
  const result = auditWorkflows({ root });
  const noun = result.count === 1 ? "workflow" : "workflows";
  process.stdout.write(
    `check-workflow-security: ${result.count} ${noun} passed zizmor ${result.version}\n`,
  );
}

if (process.argv[1] === scriptPath) {
  try {
    main();
  } catch (error) {
    if (
      error instanceof WorkflowSecurityError ||
      error instanceof WorkflowSecurityPolicyError
    ) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
