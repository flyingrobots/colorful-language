#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPolicyPath = resolve(
  repositoryRoot,
  ".github/coverage-policy.json",
);
const defaultWorkflowPath = resolve(
  repositoryRoot,
  ".github/workflows/ci.yml",
);
const defaultRulesetPath = resolve(
  repositoryRoot,
  ".github/rulesets/mainline.json",
);
const defaultReferencePath = resolve(
  repositoryRoot,
  "docs/workflows/repository-maintenance/README.md",
);

const COVERAGE_SCHEMA = "colorful.coverage-policy/v1";
const COVERAGE_COMMAND =
  "cargo llvm-cov --workspace --all-features --all-targets --locked";
const SUMMARY_PATH = "target/llvm-cov/coverage-summary.json";
const REPORT_DIRECTORY = "target/llvm-cov";
const HTML_PATH = "target/llvm-cov/html";
const PREPARE_OUTPUT_COMMAND = `mkdir -p ${REPORT_DIRECTORY}`;
const CHECKOUT_ACTION =
  "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const RUST_TOOLCHAIN_ACTION =
  "dtolnay/rust-toolchain@4cda84d5c5c54efe2404f9d843567869ab1699d4";
const INSTALL_ACTION =
  "taiki-e/install-action@41049aa56687c35e0afa74eed4f09cec4f9afabf";
const RUST_CACHE_ACTION =
  "Swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32";
const UPLOAD_ACTION =
  "actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f";
const REQUIRED_CONTEXT = {
  context: "Rust coverage",
  integration_id: 15368,
};

export class CoveragePolicyError extends Error {
  constructor(code, path, detail) {
    super(`${code}: ${path}: ${detail}`);
    this.name = "CoveragePolicyError";
    this.code = code;
  }
}

function reject(code, path, detail) {
  throw new CoveragePolicyError(code, path, detail);
}

function requireObject(value, code, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(code, path, "expected an object");
  }
  return value;
}

function requireString(value, code, path) {
  if (typeof value !== "string" || value.trim() === "") {
    reject(code, path, "expected a non-empty string");
  }
  return value;
}

function requireFiniteNumber(value, code, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject(code, path, "expected a finite number");
  }
  return value;
}

function requireCount(value, code, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    reject(code, path, "expected a nonnegative safe integer");
  }
  return value;
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= 1e-9;
}

function checkedLines(lines, code, path) {
  requireObject(lines, code, path);
  const count = requireCount(lines.count, code, `${path}.count`);
  const covered = requireCount(lines.covered, code, `${path}.covered`);
  if (count === 0) {
    reject(code, `${path}.count`, "must be positive");
  }
  if (covered > count) {
    reject(code, `${path}.covered`, "must not exceed line count");
  }
  const reportedPercent = requireFiniteNumber(
    lines.percent,
    code,
    `${path}.percent`,
  );
  const percent = (covered * 100) / count;
  if (!approximatelyEqual(reportedPercent, percent)) {
    reject(
      code,
      `${path}.percent`,
      `expected ${percent}, found ${reportedPercent}`,
    );
  }
  return {
    count,
    covered,
    uncovered: count - covered,
    percent,
  };
}

function checkedBaseline(entry, code, path) {
  requireObject(entry, code, path);
  const count = requireCount(entry.measuredLines, code, `${path}.measuredLines`);
  const covered = requireCount(
    entry.measuredCoveredLines,
    code,
    `${path}.measuredCoveredLines`,
  );
  if (count === 0 || covered > count) {
    reject(
      code,
      path,
      "measured lines must be positive and covered lines must fit",
    );
  }
  const measuredPercent = requireFiniteNumber(
    entry.measuredLinePercent,
    code,
    `${path}.measuredLinePercent`,
  );
  const expectedPercent = (covered * 100) / count;
  if (!approximatelyEqual(measuredPercent, expectedPercent)) {
    reject(
      code,
      `${path}.measuredLinePercent`,
      `expected ${expectedPercent}, found ${measuredPercent}`,
    );
  }
  const minimumPercent = requireFiniteNumber(
    entry.minimumLinePercent,
    code,
    `${path}.minimumLinePercent`,
  );
  if (minimumPercent < 0 || minimumPercent > measuredPercent) {
    reject(
      code,
      `${path}.minimumLinePercent`,
      "must be between zero and the measured percentage",
    );
  }
  const maximumUncovered = requireCount(
    entry.maximumUncoveredLines,
    code,
    `${path}.maximumUncoveredLines`,
  );
  const measuredUncovered = count - covered;
  if (maximumUncovered !== measuredUncovered) {
    reject(
      code,
      `${path}.maximumUncoveredLines`,
      `must ratchet from the measured uncovered count ${measuredUncovered}`,
    );
  }
  return {
    count,
    covered,
    percent: measuredPercent,
    minimumPercent,
    maximumUncovered,
  };
}

function checkedPolicy(policy) {
  requireObject(policy, "E_COVERAGE_POLICY", "coverage policy");
  if (policy.schemaVersion !== COVERAGE_SCHEMA) {
    reject(
      "E_COVERAGE_POLICY",
      "coverage policy.schemaVersion",
      `expected ${COVERAGE_SCHEMA}`,
    );
  }

  const toolchain = requireObject(
    policy.toolchain,
    "E_COVERAGE_POLICY",
    "coverage policy.toolchain",
  );
  const rust = requireString(
    toolchain.rust,
    "E_COVERAGE_POLICY",
    "coverage policy.toolchain.rust",
  );
  const cargoLlvmCov = requireString(
    toolchain.cargoLlvmCov,
    "E_COVERAGE_POLICY",
    "coverage policy.toolchain.cargoLlvmCov",
  );

  const measurement = requireObject(
    policy.measurement,
    "E_COVERAGE_POLICY",
    "coverage policy.measurement",
  );
  const sourceCommit = requireString(
    measurement.sourceCommit,
    "E_COVERAGE_POLICY",
    "coverage policy.measurement.sourceCommit",
  );
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    reject(
      "E_COVERAGE_POLICY",
      "coverage policy.measurement.sourceCommit",
      "expected a full lowercase Git SHA",
    );
  }
  if (measurement.command !== COVERAGE_COMMAND) {
    reject(
      "E_COVERAGE_POLICY",
      "coverage policy.measurement.command",
      `expected ${JSON.stringify(COVERAGE_COMMAND)}`,
    );
  }

  const workspace = checkedBaseline(
    policy.workspace,
    "E_COVERAGE_POLICY",
    "coverage policy.workspace",
  );
  if (!Array.isArray(policy.files) || policy.files.length === 0) {
    reject(
      "E_COVERAGE_POLICY",
      "coverage policy.files",
      "expected at least one transport file",
    );
  }
  const files = new Map();
  for (const [index, entry] of policy.files.entries()) {
    const path = `coverage policy.files[${index}]`;
    requireObject(entry, "E_COVERAGE_POLICY", path);
    const file = requireString(
      entry.path,
      "E_COVERAGE_POLICY",
      `${path}.path`,
    ).replaceAll("\\", "/");
    if (
      isAbsolute(file) ||
      file.startsWith("../") ||
      file.includes("/../") ||
      !file.startsWith("crates/")
    ) {
      reject(
        "E_COVERAGE_POLICY",
        `${path}.path`,
        "expected a repository-relative crate source path",
      );
    }
    if (files.has(file)) {
      reject(
        "E_COVERAGE_POLICY",
        `${path}.path`,
        `duplicate file ${file}`,
      );
    }
    files.set(
      file,
      checkedBaseline(entry, "E_COVERAGE_POLICY", path),
    );
  }
  if (![...files.keys()].some((path) => path.startsWith("crates/colorful-cli/"))) {
    reject(
      "E_COVERAGE_POLICY",
      "coverage policy.files",
      "must include a colorful-cli transport path",
    );
  }
  if (![...files.keys()].some((path) => path.startsWith("crates/colorful-lsp/"))) {
    reject(
      "E_COVERAGE_POLICY",
      "coverage policy.files",
      "must include a colorful-lsp transport path",
    );
  }

  if (!Array.isArray(policy.exclusions) || policy.exclusions.length !== 0) {
    reject(
      "E_COVERAGE_EXCLUSIONS",
      "coverage policy.exclusions",
      "generated and authored Rust source must remain in the baseline",
    );
  }

  return {
    toolchain: { rust, cargoLlvmCov },
    sourceCommit,
    workspace,
    files,
  };
}

function formatCount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function formatPercent(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function coverageReferenceRow(surface, baseline) {
  return [
    `| ${surface}`,
    `${formatCount(baseline.covered)} / ${formatCount(baseline.count)}`,
    `${formatPercent(baseline.percent)}%`,
    `${formatPercent(baseline.minimumPercent)}%`,
    `${formatCount(baseline.maximumUncovered)} |`,
  ].join(" | ");
}

export function validateCoverageReference(reference, policy) {
  const checked = checkedPolicy(policy);
  const text = requireString(
    reference,
    "E_COVERAGE_REFERENCE",
    "coverage reference",
  );
  const expectedRows = [
    coverageReferenceRow("Workspace", checked.workspace),
    ...[...checked.files].map(([path, baseline]) =>
      coverageReferenceRow(
        `\`${path.replace(/^crates\//u, "")}\``,
        baseline,
      ),
    ),
  ];
  const expectedFragments = [
    `CI pins Rust ${checked.toolchain.rust}`,
    `\`cargo-llvm-cov\` ${checked.toolchain.cargoLlvmCov}`,
    `\`${checked.sourceCommit}\``,
    "as the `rust-coverage` artifact for 14 days",
    "policy has no exclusions",
    ...expectedRows,
  ];
  for (const fragment of expectedFragments) {
    if (!text.includes(fragment)) {
      reject(
        "E_COVERAGE_REFERENCE",
        "docs/workflows/repository-maintenance/README.md",
        `missing policy-derived text ${JSON.stringify(fragment)}`,
      );
    }
  }
  const documentedCommand = normalizedCommand(text.replace(/\\\s+/gu, " "));
  if (!documentedCommand.includes(COVERAGE_COMMAND)) {
    reject(
      "E_COVERAGE_REFERENCE",
      "docs/workflows/repository-maintenance/README.md",
      `missing measurement command ${JSON.stringify(COVERAGE_COMMAND)}`,
    );
  }
}

function reportRelativePath(filename, workspaceRoot) {
  const normalizedFilename = requireString(
    filename,
    "E_COVERAGE_REPORT",
    "coverage report filename",
  );
  const absolute = isAbsolute(normalizedFilename)
    ? resolve(normalizedFilename)
    : resolve(workspaceRoot, normalizedFilename);
  const relativePath = relative(resolve(workspaceRoot), absolute)
    .replaceAll("\\", "/");
  if (relativePath.startsWith("../") || isAbsolute(relativePath)) {
    reject(
      "E_COVERAGE_REPORT",
      normalizedFilename,
      "coverage source is outside the workspace",
    );
  }
  return relativePath;
}

export function validateCoveragePolicy(
  policy,
  report,
  { workspaceRoot = repositoryRoot } = {},
) {
  const checked = checkedPolicy(policy);
  requireObject(report, "E_COVERAGE_REPORT", "coverage report");
  if (report.type !== "llvm.coverage.json.export") {
    reject(
      "E_COVERAGE_REPORT",
      "coverage report.type",
      "expected llvm.coverage.json.export",
    );
  }
  if (!Array.isArray(report.data) || report.data.length !== 1) {
    reject(
      "E_COVERAGE_REPORT",
      "coverage report.data",
      "expected exactly one export record",
    );
  }
  const data = requireObject(
    report.data[0],
    "E_COVERAGE_REPORT",
    "coverage report.data[0]",
  );
  const totals = requireObject(
    data.totals,
    "E_COVERAGE_REPORT",
    "coverage report.data[0].totals",
  );
  const workspaceLines = checkedLines(
    totals.lines,
    "E_COVERAGE_REPORT",
    "coverage report.data[0].totals.lines",
  );
  if (workspaceLines.percent < checked.workspace.minimumPercent) {
    reject(
      "E_COVERAGE_WORKSPACE_FLOOR",
      "coverage report.data[0].totals.lines",
      `${workspaceLines.percent}% is below ${checked.workspace.minimumPercent}%`,
    );
  }
  if (workspaceLines.uncovered > checked.workspace.maximumUncovered) {
    reject(
      "E_COVERAGE_WORKSPACE_RATCHET",
      "coverage report.data[0].totals.lines",
      `${workspaceLines.uncovered} uncovered lines exceeds ${checked.workspace.maximumUncovered}`,
    );
  }

  if (!Array.isArray(data.files)) {
    reject(
      "E_COVERAGE_REPORT",
      "coverage report.data[0].files",
      "expected an array",
    );
  }
  const reportFiles = new Map();
  for (const [index, file] of data.files.entries()) {
    requireObject(
      file,
      "E_COVERAGE_REPORT",
      `coverage report.data[0].files[${index}]`,
    );
    const path = reportRelativePath(file.filename, workspaceRoot);
    if (reportFiles.has(path)) {
      reject(
        "E_COVERAGE_REPORT",
        `coverage report.data[0].files[${index}].filename`,
        `duplicate source path ${path}`,
      );
    }
    const summary = requireObject(
      file.summary,
      "E_COVERAGE_REPORT",
      `coverage report.data[0].files[${index}].summary`,
    );
    reportFiles.set(
      path,
      checkedLines(
        summary.lines,
        "E_COVERAGE_REPORT",
        `coverage report.data[0].files[${index}].summary.lines`,
      ),
    );
  }

  const transport = [];
  for (const [path, floor] of checked.files) {
    const lines = reportFiles.get(path);
    if (lines === undefined) {
      reject(
        "E_COVERAGE_FILE_MISSING",
        path,
        "monitored transport source is absent from the report",
      );
    }
    if (lines.percent < floor.minimumPercent) {
      reject(
        "E_COVERAGE_FILE_FLOOR",
        path,
        `${lines.percent}% is below ${floor.minimumPercent}%`,
      );
    }
    if (lines.uncovered > floor.maximumUncovered) {
      reject(
        "E_COVERAGE_FILE_RATCHET",
        path,
        `${lines.uncovered} uncovered lines exceeds ${floor.maximumUncovered}`,
      );
    }
    transport.push({ path, ...lines });
  }

  return {
    workspace: workspaceLines,
    transport,
  };
}

function normalizedCommand(command) {
  return typeof command === "string"
    ? command.split(/\s+/u).filter(Boolean).join(" ")
    : "";
}

function actionStep(steps, action) {
  return steps.find((step) => step?.uses === action);
}

function commandStep(steps, command) {
  const expected = normalizedCommand(command);
  return steps.find((step) => normalizedCommand(step?.run) === expected);
}

export function validateCoverageWorkflow(workflow, policy) {
  const checked = checkedPolicy(policy);
  requireObject(workflow, "E_COVERAGE_WORKFLOW", "CI workflow");
  const jobs = requireObject(
    workflow.jobs,
    "E_COVERAGE_WORKFLOW",
    "CI workflow.jobs",
  );
  const job = requireObject(
    jobs.coverage,
    "E_COVERAGE_WORKFLOW",
    "CI workflow.jobs.coverage",
  );
  if (
    job.name !== REQUIRED_CONTEXT.context ||
    job["runs-on"] !== "ubuntu-latest" ||
    job["continue-on-error"] !== undefined
  ) {
    reject(
      "E_COVERAGE_WORKFLOW",
      "CI workflow.jobs.coverage",
      "must be a blocking ubuntu-latest Rust coverage job",
    );
  }
  if (!Array.isArray(job.steps)) {
    reject(
      "E_COVERAGE_WORKFLOW",
      "CI workflow.jobs.coverage.steps",
      "expected an array",
    );
  }
  const steps = job.steps;
  for (const action of [
    CHECKOUT_ACTION,
    RUST_TOOLCHAIN_ACTION,
    RUST_CACHE_ACTION,
    INSTALL_ACTION,
    UPLOAD_ACTION,
  ]) {
    if (actionStep(steps, action) === undefined) {
      reject(
        "E_COVERAGE_ACTION",
        "CI workflow.jobs.coverage.steps",
        `missing reviewed action ${action}`,
      );
    }
  }

  const toolchain = actionStep(steps, RUST_TOOLCHAIN_ACTION);
  if (
    toolchain.with?.toolchain !== checked.toolchain.rust ||
    !String(toolchain.with?.components ?? "")
      .split(",")
      .map((component) => component.trim())
      .includes("llvm-tools-preview")
  ) {
    reject(
      "E_COVERAGE_TOOLCHAIN",
      "CI workflow.jobs.coverage.steps",
      "Rust version and llvm-tools-preview must match the policy",
    );
  }
  const install = actionStep(steps, INSTALL_ACTION);
  if (
    install.with?.tool !==
      `cargo-llvm-cov@${checked.toolchain.cargoLlvmCov}` ||
    install.with?.fallback !== "none"
  ) {
    reject(
      "E_COVERAGE_TOOLCHAIN",
      "CI workflow.jobs.coverage.steps",
      "cargo-llvm-cov must use the exact policy version without fallback",
    );
  }

  const measurementCommand = [
    COVERAGE_COMMAND,
    "--json",
    "--summary-only",
    `--output-path ${SUMMARY_PATH}`,
  ].join(" ");
  if (
    commandStep(steps, PREPARE_OUTPUT_COMMAND) === undefined ||
    commandStep(steps, measurementCommand) === undefined
  ) {
    reject(
      "E_COVERAGE_COMMAND",
      "CI workflow.jobs.coverage.steps",
      "missing clean-checkout output preparation or the locked workspace measurement",
    );
  }
  if (
    commandStep(
      steps,
      `cargo llvm-cov report --html --output-dir ${REPORT_DIRECTORY}`,
    ) === undefined ||
    commandStep(
      steps,
      `node scripts/check-coverage-policy.mjs --report ${SUMMARY_PATH}`,
    ) === undefined
  ) {
    reject(
      "E_COVERAGE_COMMAND",
      "CI workflow.jobs.coverage.steps",
      "missing HTML rendering or policy enforcement",
    );
  }

  const upload = actionStep(steps, UPLOAD_ACTION);
  const artifactPaths = String(upload.with?.path ?? "")
    .split(/\s+/u)
    .filter(Boolean);
  const retention = upload.with?.["retention-days"];
  if (
    upload.if !== "always()" ||
    upload.with?.name !== "rust-coverage" ||
    upload.with?.["if-no-files-found"] !== "error" ||
    !artifactPaths.includes(SUMMARY_PATH) ||
    !artifactPaths.includes(HTML_PATH) ||
    !Number.isSafeInteger(retention) ||
    retention < 1 ||
    retention > 30
  ) {
    reject(
      "E_COVERAGE_ARTIFACT",
      "CI workflow.jobs.coverage.steps",
      "artifact must retain both reports for one to thirty days even after a floor failure",
    );
  }
}

export function validateCoverageRuleset(ruleset) {
  requireObject(ruleset, "E_COVERAGE_RULESET", "mainline ruleset");
  if (!Array.isArray(ruleset.rules)) {
    reject(
      "E_COVERAGE_RULESET",
      "mainline ruleset.rules",
      "expected an array",
    );
  }
  const statusRules = ruleset.rules.filter(
    (rule) => rule?.type === "required_status_checks",
  );
  if (statusRules.length !== 1) {
    reject(
      "E_COVERAGE_RULESET",
      "mainline ruleset.rules",
      "expected exactly one required_status_checks rule",
    );
  }
  const checks =
    statusRules[0].parameters?.required_status_checks;
  if (
    !Array.isArray(checks) ||
    !checks.some(
      (check) =>
        check?.context === REQUIRED_CONTEXT.context &&
        check?.integration_id === REQUIRED_CONTEXT.integration_id,
    )
  ) {
    reject(
      "E_COVERAGE_RULESET",
      "mainline ruleset.required_status_checks",
      `missing ${REQUIRED_CONTEXT.context} from GitHub Actions`,
    );
  }
}

function parseArguments(args) {
  const options = {
    policyPath: defaultPolicyPath,
    reportPath: undefined,
    workflowPath: defaultWorkflowPath,
    rulesetPath: defaultRulesetPath,
    referencePath: defaultReferencePath,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = () => {
      const candidate = args[index + 1];
      if (candidate === undefined || candidate.startsWith("--")) {
        reject(
          "E_COVERAGE_USAGE",
          "arguments",
          `${argument} requires a path`,
        );
      }
      index += 1;
      return resolve(candidate);
    };
    if (argument === "--policy") {
      options.policyPath = value();
    } else if (argument === "--report") {
      options.reportPath = value();
    } else if (argument === "--workflow") {
      options.workflowPath = value();
    } else if (argument === "--ruleset") {
      options.rulesetPath = value();
    } else if (argument === "--reference") {
      options.referencePath = value();
    } else {
      reject(
        "E_COVERAGE_USAGE",
        "arguments",
        `unknown argument ${JSON.stringify(argument)}`,
      );
    }
  }
  if (options.reportPath === undefined) {
    reject(
      "E_COVERAGE_USAGE",
      "arguments",
      "--report requires a path",
    );
  }
  return options;
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    reject(
      "E_COVERAGE_INPUT",
      path,
      `could not read ${description}: ${error.message}`,
    );
  }
}

function readText(path, description) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    reject(
      "E_COVERAGE_INPUT",
      path,
      `could not read ${description}: ${error.message}`,
    );
  }
}

export function run(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const policy = readJson(options.policyPath, "coverage policy");
  const report = readJson(options.reportPath, "coverage report");
  const workflow = parseYaml(readText(options.workflowPath, "CI workflow"));
  const ruleset = readJson(options.rulesetPath, "mainline ruleset");
  const reference = readText(
    options.referencePath,
    "repository-maintenance reference",
  );

  validateCoverageWorkflow(workflow, policy);
  validateCoverageRuleset(ruleset);
  validateCoverageReference(reference, policy);
  const result = validateCoveragePolicy(policy, report, {
    workspaceRoot: repositoryRoot,
  });
  process.stdout.write(
    [
      "check-coverage-policy passed:",
      `${result.workspace.covered}/${result.workspace.count}`,
      `lines (${result.workspace.percent.toFixed(2)}%)`,
      `with ${result.workspace.uncovered} uncovered`,
    ].join(" ") + "\n",
  );
  for (const file of result.transport) {
    process.stdout.write(
      `  ${file.path}: ${file.covered}/${file.count} (${file.percent.toFixed(2)}%)\n`,
    );
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
