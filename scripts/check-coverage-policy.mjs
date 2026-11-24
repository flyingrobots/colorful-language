#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
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
const ARTIFACT_RETENTION_DAYS = 14;
const CHECKOUT_ACTION = "actions/checkout";
const RUST_TOOLCHAIN_ACTION = "dtolnay/rust-toolchain";
const INSTALL_ACTION = "taiki-e/install-action";
const RUST_CACHE_ACTION = "Swatinem/rust-cache";
const UPLOAD_ACTION = "actions/upload-artifact";
const PINNED_ACTION = /^(?<identity>[^@\s]+)@[0-9a-f]{40}$/u;
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
        `\`${path}\``,
        baseline,
      ),
    ),
  ];
  const expectedFragments = [
    `CI pins Rust ${checked.toolchain.rust}`,
    `\`cargo-llvm-cov\` ${checked.toolchain.cargoLlvmCov}`,
    `\`${checked.sourceCommit}\``,
    `as the \`rust-coverage\` artifact for ${ARTIFACT_RETENTION_DAYS} days`,
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

function reportFileLines(data, workspaceRoot) {
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
  return reportFiles;
}

function surfaceViolations(surface, lines, baseline, codes) {
  const violations = [];
  if (lines.percent < baseline.minimumPercent) {
    violations.push({
      surface,
      error: new CoveragePolicyError(
        codes.floor,
        codes.path,
        `${lines.percent}% is below ${baseline.minimumPercent}%`,
      ),
    });
  }
  if (lines.uncovered > baseline.maximumUncovered) {
    violations.push({
      surface,
      error: new CoveragePolicyError(
        codes.ratchet,
        codes.path,
        `${lines.uncovered} uncovered lines exceeds ${baseline.maximumUncovered}`,
      ),
    });
  }
  return violations;
}

/**
 * Measures the LLVM report against the validated policy without deciding the
 * verdict. Malformed inputs still throw; floor, ratchet, and missing-file
 * findings are collected in the order the validator has always reported them,
 * so the first violation is exactly the error `validateCoveragePolicy` throws.
 */
export function evaluateCoveragePolicy(
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
  // Floor before ratchet, workspace before files: the validator's order.
  const violations = surfaceViolations(
    "Workspace",
    workspaceLines,
    checked.workspace,
    {
      floor: "E_COVERAGE_WORKSPACE_FLOOR",
      ratchet: "E_COVERAGE_WORKSPACE_RATCHET",
      path: "coverage report.data[0].totals.lines",
    },
  );

  let reportFiles;
  try {
    reportFiles = reportFileLines(data, workspaceRoot);
  } catch (error) {
    // The validator rejected a workspace regression before reading file
    // records, so that category keeps precedence over a malformed record.
    if (violations.length > 0 && error instanceof CoveragePolicyError) {
      throw violations[0].error;
    }
    throw error;
  }

  const surfaces = [
    {
      surface: "Workspace",
      path: undefined,
      lines: workspaceLines,
      baseline: checked.workspace,
      codes: violations.map(({ error }) => error.code),
    },
  ];
  const transport = [];
  for (const [path, floor] of checked.files) {
    const lines = reportFiles.get(path);
    let fileViolations;
    if (lines === undefined) {
      fileViolations = [
        {
          surface: path,
          error: new CoveragePolicyError(
            "E_COVERAGE_FILE_MISSING",
            path,
            "monitored transport source is absent from the report",
          ),
        },
      ];
    } else {
      fileViolations = surfaceViolations(path, lines, floor, {
        floor: "E_COVERAGE_FILE_FLOOR",
        ratchet: "E_COVERAGE_FILE_RATCHET",
        path,
      });
      transport.push({ path, ...lines });
    }
    violations.push(...fileViolations);
    surfaces.push({
      surface: path,
      path,
      lines,
      baseline: floor,
      codes: fileViolations.map(({ error }) => error.code),
    });
  }

  return {
    workspace: workspaceLines,
    transport,
    surfaces,
    violations: violations.map(({ surface, error }) => ({
      surface,
      code: error.code,
      error,
    })),
  };
}

export function validateCoveragePolicy(
  policy,
  report,
  { workspaceRoot = repositoryRoot } = {},
) {
  const evaluation = evaluateCoveragePolicy(policy, report, { workspaceRoot });
  if (evaluation.violations.length > 0) {
    throw evaluation.violations[0].error;
  }
  return {
    workspace: evaluation.workspace,
    transport: evaluation.transport,
  };
}

const SUMMARY_TITLE = "Rust coverage ratchet";
const SUMMARY_PASS_SENTENCE =
  "Every surface is within its floor and uncovered-line ceiling.";
const SUMMARY_NOTE =
  "Advisory: the check-coverage-policy exit status is the gate. " +
  "Δ coverage is current minus measured baseline; " +
  "Δ uncovered is current minus ceiling.";
const SUMMARY_COLUMNS = [
  { header: "Surface", align: "left" },
  { header: "Covered / total", align: "right" },
  { header: "Coverage", align: "right" },
  { header: "Baseline", align: "right" },
  { header: "Δ coverage", align: "right" },
  { header: "Floor", align: "right" },
  { header: "Uncovered", align: "right" },
  { header: "Ceiling", align: "right" },
  { header: "Δ uncovered", align: "right" },
  { header: "Status", align: "left" },
];

function formatSignedPercentPoints(value) {
  const magnitude = Math.abs(value).toFixed(2);
  if (magnitude === "0.00") {
    return "0.00 pp";
  }
  return `${value > 0 ? "+" : "-"}${magnitude} pp`;
}

function formatSignedCount(value) {
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : "-"}${formatCount(Math.abs(value))}`;
}

// One set of cells feeds both renderings, so Markdown and plain output cannot
// disagree about a value. `code` marks cells that Markdown shows as code.
function summaryCells({ surface, path, lines, baseline, codes }) {
  const present = lines !== undefined;
  return [
    { text: surface, code: path !== undefined },
    {
      text: present
        ? `${formatCount(lines.covered)} / ${formatCount(lines.count)}`
        : "missing",
    },
    { text: present ? `${formatPercent(lines.percent)}%` : "missing" },
    { text: `${formatPercent(baseline.percent)}%` },
    {
      text: present
        ? formatSignedPercentPoints(lines.percent - baseline.percent)
        : "n/a",
    },
    { text: `${formatPercent(baseline.minimumPercent)}%` },
    { text: present ? formatCount(lines.uncovered) : "missing" },
    { text: formatCount(baseline.maximumUncovered) },
    {
      text: present
        ? formatSignedCount(lines.uncovered - baseline.maximumUncovered)
        : "n/a",
    },
    { status: codes },
  ];
}

function markdownCell(cell) {
  if (cell.status !== undefined) {
    return cell.status.length === 0
      ? "pass"
      : ["**FAIL**", ...cell.status.map((code) => `\`${code}\``)].join(" ");
  }
  return cell.code ? `\`${cell.text}\`` : cell.text;
}

function plainCell(cell) {
  if (cell.status !== undefined) {
    return cell.status.length === 0
      ? "pass"
      : ["FAIL", ...cell.status].join(" ");
  }
  return cell.text;
}

function renderMarkdownSummary(evaluation, rows) {
  const first = evaluation.violations[0];
  const verdict =
    first === undefined
      ? `Verdict: **pass**. ${SUMMARY_PASS_SENTENCE}`
      : `Verdict: **FAIL** \`${first.code}\` on ${
          first.surface === "Workspace" ? "Workspace" : `\`${first.surface}\``
        }.`;
  const tableRow = (cells) => `| ${cells.join(" | ")} |`;
  return [
    `### ${SUMMARY_TITLE}`,
    "",
    verdict,
    "",
    tableRow(SUMMARY_COLUMNS.map((column) => column.header)),
    tableRow(
      SUMMARY_COLUMNS.map((column) =>
        column.align === "right" ? "---:" : "---",
      ),
    ),
    ...rows.map((cells) => tableRow(cells.map(markdownCell))),
    "",
    SUMMARY_NOTE,
    "",
  ].join("\n");
}

function renderPlainSummary(evaluation, rows) {
  const first = evaluation.violations[0];
  const verdict =
    first === undefined
      ? `${SUMMARY_TITLE} verdict: pass. ${SUMMARY_PASS_SENTENCE}`
      : `${SUMMARY_TITLE} verdict: FAIL ${first.code} on ${first.surface}.`;
  const table = [
    SUMMARY_COLUMNS.map((column) => column.header),
    ...rows.map((cells) => cells.map(plainCell)),
  ];
  const widths = SUMMARY_COLUMNS.map((_, index) =>
    Math.max(...table.map((cells) => cells[index].length)),
  );
  const line = (cells) =>
    cells
      .map((cell, index) =>
        SUMMARY_COLUMNS[index].align === "right"
          ? cell.padStart(widths[index])
          : cell.padEnd(widths[index]),
      )
      .join("  ")
      .trimEnd();
  return [
    verdict,
    "",
    ...table.map(line),
    "",
    SUMMARY_NOTE,
    "",
  ].join("\n");
}

/**
 * Renders an evaluation from `evaluateCoveragePolicy` as one deterministic
 * table: `markdown` for `$GITHUB_STEP_SUMMARY`, `text` for local stdout. The
 * summary is presentation only; it never changes the validator's verdict.
 */
export function renderCoverageSummary(evaluation, { format = "text" } = {}) {
  const rows = evaluation.surfaces.map(summaryCells);
  if (format === "markdown") {
    return renderMarkdownSummary(evaluation, rows);
  }
  if (format === "text") {
    return renderPlainSummary(evaluation, rows);
  }
  throw new TypeError(`unknown coverage summary format ${format}`);
}

function normalizedCommand(command) {
  return typeof command === "string"
    ? command.split(/\s+/u).filter(Boolean).join(" ")
    : "";
}

function actionStep(steps, action) {
  return steps.find((step) => {
    const match =
      typeof step?.uses === "string"
        ? step.uses.match(PINNED_ACTION)
        : null;
    return match?.groups?.identity === action;
  });
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
  const permissions = requireObject(
    job.permissions,
    "E_COVERAGE_WORKFLOW",
    "CI workflow.jobs.coverage.permissions",
  );
  if (
    permissions.contents !== "read" ||
    Object.keys(permissions).length !== 1
  ) {
    reject(
      "E_COVERAGE_WORKFLOW",
      "CI workflow.jobs.coverage.permissions",
      "must grant only read access to repository contents",
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
        `missing full-SHA action ${action}`,
      );
    }
  }

  const checkout = actionStep(steps, CHECKOUT_ACTION);
  if (checkout.with?.["persist-credentials"] !== false) {
    reject(
      "E_COVERAGE_ACTION",
      "CI workflow.jobs.coverage.steps",
      "checkout must not persist the GitHub token",
    );
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
    retention > 30 ||
    retention !== ARTIFACT_RETENTION_DAYS
  ) {
    reject(
      "E_COVERAGE_ARTIFACT",
      "CI workflow.jobs.coverage.steps",
      `artifact must retain both reports for exactly ${ARTIFACT_RETENTION_DAYS} days even after a floor failure`,
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

function appendStepSummary(markdown, env) {
  const path = env.GITHUB_STEP_SUMMARY;
  if (typeof path !== "string" || path === "") {
    return;
  }
  try {
    appendFileSync(path, markdown, "utf8");
  } catch (error) {
    // The summary is advisory presentation: failing to publish it must not
    // become a second gate or change the validator's exit status.
    process.stderr.write(
      `check-coverage-policy: could not append the advisory step summary: ${error.message}\n`,
    );
  }
}

export function run(args = process.argv.slice(2), { env = process.env } = {}) {
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
  const evaluation = evaluateCoveragePolicy(policy, report, {
    workspaceRoot: repositoryRoot,
  });
  process.stdout.write(renderCoverageSummary(evaluation, { format: "text" }));
  appendStepSummary(
    renderCoverageSummary(evaluation, { format: "markdown" }),
    env,
  );
  if (evaluation.violations.length > 0) {
    throw evaluation.violations[0].error;
  }
  const result = {
    workspace: evaluation.workspace,
    transport: evaluation.transport,
  };
  process.stdout.write(
    [
      "check-coverage-policy passed:",
      `${result.workspace.covered}/${result.workspace.count}`,
      `lines (${result.workspace.percent.toFixed(2)}%)`,
      `with ${result.workspace.uncovered} uncovered`,
    ].join(" ") + "\n",
  );
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
