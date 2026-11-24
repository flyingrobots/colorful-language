#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";

import * as coverageChecker from "./check-coverage-policy.mjs";

const {
  CoveragePolicyError,
  evaluateCoveragePolicy,
  renderCoverageSummary,
  validateCoveragePolicy,
  validateCoverageReference,
  validateCoverageRuleset,
  validateCoverageWorkflow,
} = coverageChecker;

const CHECKOUT_ACTION =
  "actions/checkout@1111111111111111111111111111111111111111";
const RUST_TOOLCHAIN_ACTION =
  "dtolnay/rust-toolchain@2222222222222222222222222222222222222222";
const INSTALL_ACTION =
  "taiki-e/install-action@3333333333333333333333333333333333333333";
const RUST_CACHE_ACTION =
  "Swatinem/rust-cache@4444444444444444444444444444444444444444";
const UPLOAD_ACTION =
  "actions/upload-artifact@5555555555555555555555555555555555555555";
const UPDATED_ACTIONS = new Map([
  [
    "actions/checkout",
    "actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ],
  [
    "taiki-e/install-action",
    "taiki-e/install-action@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ],
  [
    "actions/upload-artifact",
    "actions/upload-artifact@cccccccccccccccccccccccccccccccccccccccc",
  ],
]);
const ACTUAL_POLICY = JSON.parse(
  readFileSync(
    new URL("../.github/coverage-policy.json", import.meta.url),
    "utf8",
  ),
);
const COVERAGE_REFERENCE = readFileSync(
  new URL(
    "../docs/workflows/repository-maintenance/README.md",
    import.meta.url,
  ),
  "utf8",
);
const CHANGELOG = readFileSync(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
);
const EXPECTED_CLI_TRANSPORT_PATHS = [
  "crates/colorful-cli/src/cli/args.rs",
  "crates/colorful-cli/src/cli/color.rs",
  "crates/colorful-cli/src/cli/diagnose.rs",
  "crates/colorful-cli/src/cli/lint.rs",
  "crates/colorful-cli/src/main.rs",
];

function lineSummary(count, covered) {
  return {
    count,
    covered,
    percent: (covered * 100) / count,
  };
}

function renderedWorkspacePercent() {
  const measuredPercent = ACTUAL_POLICY.workspace.measuredLinePercent;
  return Number.isInteger(measuredPercent)
    ? `${measuredPercent}%`
    : `${measuredPercent.toFixed(2)}%`;
}

function policy() {
  return {
    schemaVersion: "colorful.coverage-policy/v1",
    toolchain: {
      rust: "1.97.1",
      cargoLlvmCov: "0.8.7",
    },
    measurement: {
      sourceCommit: "da766e7f5dc6ceacf0141bf048594af4d6b87999",
      command:
        "cargo llvm-cov --workspace --all-features --all-targets --locked",
    },
    workspace: {
      measuredLines: 1_000,
      measuredCoveredLines: 950,
      measuredLinePercent: 95,
      minimumLinePercent: 92,
      maximumUncoveredLines: 50,
    },
    files: [
      {
        path: "crates/colorful-cli/src/lib.rs",
        measuredLines: 100,
        measuredCoveredLines: 91,
        measuredLinePercent: 91,
        minimumLinePercent: 90,
        maximumUncoveredLines: 9,
      },
      {
        path: "crates/colorful-lsp/src/main.rs",
        measuredLines: 64,
        measuredCoveredLines: 61,
        measuredLinePercent: 95.3125,
        minimumLinePercent: 94,
        maximumUncoveredLines: 3,
      },
    ],
    exclusions: [],
  };
}

function report() {
  return {
    type: "llvm.coverage.json.export",
    version: "2.0.1",
    data: [
      {
        totals: {
          lines: lineSummary(1_000, 950),
        },
        files: [
          {
            filename:
              "/checkout/colorful-language/crates/colorful-cli/src/lib.rs",
            summary: {
              lines: lineSummary(100, 91),
            },
          },
          {
            filename:
              "/checkout/colorful-language/crates/colorful-lsp/src/main.rs",
            summary: {
              lines: lineSummary(64, 61),
            },
          },
        ],
      },
    ],
  };
}

function workflow() {
  return {
    jobs: {
      coverage: {
        name: "Rust coverage",
        "runs-on": "ubuntu-latest",
        permissions: {
          contents: "read",
        },
        steps: [
          {
            uses: CHECKOUT_ACTION,
            with: {
              "persist-credentials": false,
            },
          },
          {
            uses: RUST_TOOLCHAIN_ACTION,
            with: {
              toolchain: "1.97.1",
              components: "llvm-tools-preview",
            },
          },
          { uses: RUST_CACHE_ACTION },
          {
            uses: INSTALL_ACTION,
            with: {
              tool: "cargo-llvm-cov@0.8.7",
              fallback: "none",
            },
          },
          {
            name: "Prepare coverage output",
            run: "mkdir -p target/llvm-cov",
          },
          {
            name: "Measure workspace coverage",
            run: [
              "cargo llvm-cov",
              "--workspace",
              "--all-features",
              "--all-targets",
              "--locked",
              "--json",
              "--summary-only",
              "--output-path target/llvm-cov/coverage-summary.json",
            ].join(" "),
          },
          {
            name: "Render browsable coverage",
            run: "cargo llvm-cov report --html --output-dir target/llvm-cov",
          },
          {
            name: "Enforce coverage policy",
            run: [
              "node scripts/check-coverage-policy.mjs",
              "--report target/llvm-cov/coverage-summary.json",
            ].join(" "),
          },
          {
            name: "Upload coverage report",
            if: "always()",
            uses: UPLOAD_ACTION,
            with: {
              name: "rust-coverage",
              path: [
                "target/llvm-cov/coverage-summary.json",
                "target/llvm-cov/html",
              ].join("\n"),
              "retention-days": 14,
              "if-no-files-found": "error",
            },
          },
        ],
      },
    },
  };
}

function ruleset() {
  return {
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: "Rust coverage",
              integration_id: 15368,
            },
          ],
        },
      },
    ],
  };
}

function expectPolicyError(code, mutatePolicy, mutateReport = () => {}) {
  const candidatePolicy = policy();
  const candidateReport = report();
  mutatePolicy(candidatePolicy);
  mutateReport(candidateReport);
  assert.throws(
    () =>
      validateCoveragePolicy(candidatePolicy, candidateReport, {
        workspaceRoot: "/checkout/colorful-language",
      }),
    (error) => error instanceof CoveragePolicyError && error.code === code,
  );
}

function expectWorkflowError(code, mutate) {
  const candidate = workflow();
  mutate(candidate);
  assert.throws(
    () => validateCoverageWorkflow(candidate, policy()),
    (error) => error instanceof CoveragePolicyError && error.code === code,
  );
}

function namedWorkflowStep(candidate, name) {
  return candidate.jobs.coverage.steps.find((step) => step.name === name);
}

function actionWorkflowStep(candidate, action) {
  return candidate.jobs.coverage.steps.find((step) => step.uses === action);
}

function refreshWorkflowActions(candidate, updates) {
  for (const step of candidate.jobs.coverage.steps) {
    if (typeof step.uses !== "string") {
      continue;
    }
    const identity = step.uses.split("@", 1)[0];
    if (updates.has(identity)) {
      step.uses = updates.get(identity);
    }
  }
}

function assertWorkflowActionsRefreshed(candidate, updates) {
  for (const [identity, expected] of updates) {
    const matching = candidate.jobs.coverage.steps
      .map((step) => step.uses)
      .filter(
        (uses) =>
          typeof uses === "string" && uses.split("@", 1)[0] === identity,
      );
    assert.notEqual(
      matching.length,
      0,
      `coverage fixture must use ${identity}`,
    );
    assert.deepEqual(
      matching,
      Array.from({ length: matching.length }, () => expected),
      `every ${identity} use must carry the refreshed pin`,
    );
  }
}

test("accepts the reviewed workspace and transport coverage", () => {
  assert.doesNotThrow(() =>
    validateCoveragePolicy(policy(), report(), {
      workspaceRoot: "/checkout/colorful-language",
    }),
  );
});

test("resolves repository-relative report paths from the workspace root", () => {
  const relativeReport = structuredClone(report());
  for (const file of relativeReport.data[0].files) {
    file.filename = file.filename.replace("/checkout/colorful-language/", "");
  }
  assert.doesNotThrow(() =>
    validateCoveragePolicy(policy(), relativeReport, {
      workspaceRoot: "/checkout/colorful-language",
    }),
  );
});

test("accepts coverage documentation generated from the machine policy", () => {
  assert.doesNotThrow(() =>
    validateCoverageReference(COVERAGE_REFERENCE, ACTUAL_POLICY),
  );
});

test("unreleased coverage note matches the machine policy", () => {
  const start = CHANGELOG.indexOf("## [Unreleased]");
  assert.notEqual(start, -1, "missing Unreleased changelog section");
  const followingRelease = CHANGELOG.indexOf("\n## [", start + 1);
  const unreleased = CHANGELOG.slice(
    start,
    followingRelease === -1 ? undefined : followingRelease,
  );
  assert(
    unreleased.includes(
      `ratchet the ${renderedWorkspacePercent()} measured baseline`,
    ),
    "Unreleased coverage evidence must quote the current workspace baseline",
  );
});

test("coverage follows every executable CLI source owner", () => {
  const cliPaths = ACTUAL_POLICY.files
    .map((entry) => entry.path)
    .filter((path) => path.startsWith("crates/colorful-cli/"))
    .sort();
  assert.deepEqual(cliPaths, EXPECTED_CLI_TRANSPORT_PATHS);
  assert.doesNotMatch(
    cliPaths.join("\n"),
    /^crates\/colorful-cli\/src\/lib\.rs$/mu,
  );
});

test("rejects stale coverage measurements in the maintained reference", () => {
  const measuredPercent = ACTUAL_POLICY.workspace.measuredLinePercent;
  const renderedPercent = renderedWorkspacePercent();
  const staleReference = COVERAGE_REFERENCE.replaceAll(
    renderedPercent,
    `${(measuredPercent - 0.01).toFixed(2)}%`,
  );
  assert.notEqual(staleReference, COVERAGE_REFERENCE);
  assert(!staleReference.includes(renderedPercent));
  assert.throws(
    () => validateCoverageReference(staleReference, ACTUAL_POLICY),
    (error) =>
      error instanceof CoveragePolicyError &&
      error.code === "E_COVERAGE_REFERENCE",
  );
});

test("rejects coverage rows without exact repository-relative paths", () => {
  const staleReference = COVERAGE_REFERENCE.replaceAll("`crates/", "`");
  assert.notEqual(staleReference, COVERAGE_REFERENCE);
  assert.throws(
    () => validateCoverageReference(staleReference, ACTUAL_POLICY),
    (error) =>
      error instanceof CoveragePolicyError &&
      error.code === "E_COVERAGE_REFERENCE",
  );
});

test("rejects a workspace line percentage below the reviewed floor", () => {
  expectPolicyError(
    "E_COVERAGE_WORKSPACE_FLOOR",
    () => {},
    (candidate) => {
      candidate.data[0].totals.lines = lineSummary(1_000, 919);
    },
  );
});

test("rejects an increase in uncovered workspace lines", () => {
  expectPolicyError(
    "E_COVERAGE_WORKSPACE_RATCHET",
    () => {},
    (candidate) => {
      candidate.data[0].totals.lines = lineSummary(1_001, 950);
    },
  );
});

test("rejects a transport file below its reviewed floor", () => {
  expectPolicyError(
    "E_COVERAGE_FILE_FLOOR",
    () => {},
    (candidate) => {
      candidate.data[0].files[0].summary.lines = lineSummary(100, 89);
    },
  );
});

test("rejects an increase in uncovered transport lines", () => {
  expectPolicyError(
    "E_COVERAGE_FILE_RATCHET",
    () => {},
    (candidate) => {
      candidate.data[0].files[1].summary.lines = lineSummary(70, 66);
    },
  );
});

test("rejects a missing transport file", () => {
  expectPolicyError(
    "E_COVERAGE_FILE_MISSING",
    () => {},
    (candidate) => {
      candidate.data[0].files.pop();
    },
  );
});

test("rejects malformed line counters instead of producing NaN", () => {
  expectPolicyError(
    "E_COVERAGE_REPORT",
    () => {},
    (candidate) => {
      candidate.data[0].totals.lines.covered = Number.NaN;
    },
  );
});

test("rejects generated-source exclusions", () => {
  expectPolicyError("E_COVERAGE_EXCLUSIONS", (candidate) => {
    candidate.exclusions.push("crates/colorful-ir/src/generated/**");
  });
});

test("accepts the pinned coverage workflow", () => {
  assert.doesNotThrow(() => validateCoverageWorkflow(workflow(), policy()));
});

test("accepts a full-SHA action refresh without checker edits", () => {
  const candidate = workflow();
  refreshWorkflowActions(candidate, UPDATED_ACTIONS);
  assertWorkflowActionsRefreshed(candidate, UPDATED_ACTIONS);
  assert.doesNotThrow(() => validateCoverageWorkflow(candidate, policy()));
});

test("rejects coverage jobs without explicit read-only permissions", () => {
  expectWorkflowError("E_COVERAGE_WORKFLOW", (candidate) => {
    delete candidate.jobs.coverage.permissions;
  });
});

test("rejects checkout credential persistence in the coverage job", () => {
  expectWorkflowError("E_COVERAGE_ACTION", (candidate) => {
    delete actionWorkflowStep(candidate, CHECKOUT_ACTION).with[
      "persist-credentials"
    ];
  });
});

test("rejects a workflow that omits clean-checkout output preparation", () => {
  expectWorkflowError("E_COVERAGE_COMMAND", (candidate) => {
    candidate.jobs.coverage.steps = candidate.jobs.coverage.steps.filter(
      (step) => step.name !== "Prepare coverage output",
    );
  });
});

test("rejects a coverage command that omits all targets", () => {
  expectWorkflowError("E_COVERAGE_COMMAND", (candidate) => {
    const measurement = namedWorkflowStep(
      candidate,
      "Measure workspace coverage",
    );
    measurement.run = measurement.run.replace(" --all-targets", "");
  });
});

test("rejects a floating or wrong upload action", () => {
  expectWorkflowError("E_COVERAGE_ACTION", (candidate) => {
    namedWorkflowStep(candidate, "Upload coverage report").uses =
      "actions/upload-artifact@v7";
  });
});

test("rejects an artifact without both machine and browsable reports", () => {
  expectWorkflowError("E_COVERAGE_ARTIFACT", (candidate) => {
    namedWorkflowStep(candidate, "Upload coverage report").with.path =
      "target/llvm-cov/coverage-summary.json";
  });
});

test("rejects artifact retention that drifts from the reference", () => {
  expectWorkflowError("E_COVERAGE_ARTIFACT", (candidate) => {
    namedWorkflowStep(candidate, "Upload coverage report").with[
      "retention-days"
    ] = 15;
  });
});

test("rejects an unbounded artifact retention period", () => {
  expectWorkflowError("E_COVERAGE_ARTIFACT", (candidate) => {
    delete namedWorkflowStep(candidate, "Upload coverage report").with[
      "retention-days"
    ];
  });
});

test("requires the coverage result in the protected-branch gate", () => {
  assert.doesNotThrow(() => validateCoverageRuleset(ruleset()));
  const candidate = ruleset();
  candidate.rules[0].parameters.required_status_checks = [];
  assert.throws(
    () => validateCoverageRuleset(candidate),
    (error) =>
      error instanceof CoveragePolicyError &&
      error.code === "E_COVERAGE_RULESET",
  );
});

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECKER_PATH = fileURLToPath(
  new URL("./check-coverage-policy.mjs", import.meta.url),
);
const FIXTURE_ROOT = "/checkout/colorful-language";
const SUMMARY_NOTE =
  "Advisory: the check-coverage-policy exit status is the gate. " +
  "Δ coverage is current minus measured baseline; " +
  "Δ uncovered is current minus ceiling.";
const PASSING_VERDICT =
  "pass. Every surface is within its floor and uncovered-line ceiling.";

function improvedReport() {
  const candidate = report();
  candidate.data[0].totals.lines = lineSummary(1_000, 960);
  candidate.data[0].files[1].summary.lines = lineSummary(64, 62);
  return candidate;
}

function regressedReport() {
  const candidate = report();
  candidate.data[0].files[0].summary.lines = lineSummary(100, 89);
  return candidate;
}

function summaryOf(candidatePolicy, candidateReport, format, options = {}) {
  return renderCoverageSummary(
    evaluateCoveragePolicy(candidatePolicy, candidateReport, {
      workspaceRoot: FIXTURE_ROOT,
      ...options,
    }),
    { format },
  );
}

function markdownRows(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| ---"))
    .slice(1)
    .map((line) =>
      line
        .slice(2, -2)
        .split(" | ")
        .map((cell) => cell.replaceAll("**", "").replaceAll("`", "")),
    );
}

function textRows(text) {
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line.startsWith("Surface  "));
  assert.notEqual(header, -1, "plain summary must carry a header row");
  const rows = [];
  for (const line of lines.slice(header + 1)) {
    if (line === "") {
      break;
    }
    rows.push(line.trim().split(/ {2,}/u));
  }
  return rows;
}

function signedNumber(cell) {
  return Number(cell.replace(/ pp$/u, ""));
}

function percentText(value) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2)}%`;
}

function countText(value) {
  return value.toLocaleString("en-US");
}

function reportFromPolicy(candidatePolicy) {
  const entryLines = (entry) =>
    lineSummary(entry.measuredLines, entry.measuredCoveredLines);
  return {
    type: "llvm.coverage.json.export",
    version: "2.0.1",
    data: [
      {
        totals: { lines: entryLines(candidatePolicy.workspace) },
        files: candidatePolicy.files.map((entry) => ({
          filename: entry.path,
          summary: { lines: entryLines(entry) },
        })),
      },
    ],
  };
}

const EXPECTED_PASSING_MARKDOWN = [
  "### Rust coverage ratchet",
  "",
  `Verdict: **pass**. Every surface is within its floor and uncovered-line ceiling.`,
  "",
  "| Surface | Covered / total | Coverage | Baseline | Δ coverage | Floor | Uncovered | Ceiling | Δ uncovered | Status |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  "| Workspace | 960 / 1,000 | 96% | 95% | +1.00 pp | 92% | 40 | 50 | -10 | pass |",
  "| `crates/colorful-cli/src/lib.rs` | 91 / 100 | 91% | 91% | 0.00 pp | 90% | 9 | 9 | 0 | pass |",
  "| `crates/colorful-lsp/src/main.rs` | 62 / 64 | 96.88% | 95.31% | +1.56 pp | 94% | 2 | 3 | -1 | pass |",
  "",
  SUMMARY_NOTE,
  "",
].join("\n");

const EXPECTED_PASSING_TEXT = [
  `Rust coverage ratchet verdict: ${PASSING_VERDICT}`,
  "",
  "Surface                          Covered / total  Coverage  Baseline  Δ coverage  Floor  Uncovered  Ceiling  Δ uncovered  Status",
  "Workspace                            960 / 1,000       96%       95%    +1.00 pp    92%         40       50          -10  pass",
  "crates/colorful-cli/src/lib.rs          91 / 100       91%       91%     0.00 pp    90%          9        9            0  pass",
  "crates/colorful-lsp/src/main.rs          62 / 64    96.88%    95.31%    +1.56 pp    94%          2        3           -1  pass",
  "",
  SUMMARY_NOTE,
  "",
].join("\n");

const EXPECTED_REGRESSED_MARKDOWN = [
  "### Rust coverage ratchet",
  "",
  "Verdict: **FAIL** `E_COVERAGE_FILE_FLOOR` on `crates/colorful-cli/src/lib.rs`.",
  "",
  "| Surface | Covered / total | Coverage | Baseline | Δ coverage | Floor | Uncovered | Ceiling | Δ uncovered | Status |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  "| Workspace | 950 / 1,000 | 95% | 95% | 0.00 pp | 92% | 50 | 50 | 0 | pass |",
  "| `crates/colorful-cli/src/lib.rs` | 89 / 100 | 89% | 91% | -2.00 pp | 90% | 11 | 9 | +2 | **FAIL** `E_COVERAGE_FILE_FLOOR` `E_COVERAGE_FILE_RATCHET` |",
  "| `crates/colorful-lsp/src/main.rs` | 61 / 64 | 95.31% | 95.31% | 0.00 pp | 94% | 3 | 3 | 0 | pass |",
  "",
  SUMMARY_NOTE,
  "",
].join("\n");

const EXPECTED_REGRESSED_TEXT = [
  "Rust coverage ratchet verdict: FAIL E_COVERAGE_FILE_FLOOR on crates/colorful-cli/src/lib.rs.",
  "",
  "Surface                          Covered / total  Coverage  Baseline  Δ coverage  Floor  Uncovered  Ceiling  Δ uncovered  Status",
  "Workspace                            950 / 1,000       95%       95%     0.00 pp    92%         50       50            0  pass",
  "crates/colorful-cli/src/lib.rs          89 / 100       89%       91%    -2.00 pp    90%         11        9           +2  FAIL E_COVERAGE_FILE_FLOOR E_COVERAGE_FILE_RATCHET",
  "crates/colorful-lsp/src/main.rs          61 / 64    95.31%    95.31%     0.00 pp    94%          3        3            0  pass",
  "",
  SUMMARY_NOTE,
  "",
].join("\n");

test("renders the golden passing coverage delta summary", () => {
  assert.equal(
    summaryOf(policy(), improvedReport(), "markdown"),
    EXPECTED_PASSING_MARKDOWN,
  );
  assert.equal(
    summaryOf(policy(), improvedReport(), "text"),
    EXPECTED_PASSING_TEXT,
  );
});

test("renders the golden regressed coverage delta summary", () => {
  assert.equal(
    summaryOf(policy(), regressedReport(), "markdown"),
    EXPECTED_REGRESSED_MARKDOWN,
  );
  assert.equal(
    summaryOf(policy(), regressedReport(), "text"),
    EXPECTED_REGRESSED_TEXT,
  );
});

test("marks a missing monitored file without inventing measurements", () => {
  const candidate = report();
  candidate.data[0].files.pop();
  const markdown = summaryOf(policy(), candidate, "markdown");
  assert(
    markdown.includes(
      "Verdict: **FAIL** `E_COVERAGE_FILE_MISSING` on `crates/colorful-lsp/src/main.rs`.",
    ),
  );
  assert(
    markdown.includes(
      "| `crates/colorful-lsp/src/main.rs` | missing | missing | 95.31% | n/a | 94% | missing | 3 | n/a | **FAIL** `E_COVERAGE_FILE_MISSING` |",
    ),
  );
});

test("renders the same report deterministically in local and hosted runs", () => {
  const formats = ["markdown", "text"];
  for (const format of formats) {
    const baseline = summaryOf(policy(), regressedReport(), format);
    assert.equal(summaryOf(policy(), regressedReport(), format), baseline);

    const reordered = regressedReport();
    reordered.data[0].files.reverse();
    assert.equal(summaryOf(policy(), reordered, format), baseline);

    const relative = regressedReport();
    for (const file of relative.data[0].files) {
      file.filename = file.filename.replace(`${FIXTURE_ROOT}/`, "");
    }
    assert.equal(summaryOf(policy(), relative, format), baseline);

    mock.timers.enable({ apis: ["Date"], now: 0 });
    const epoch = summaryOf(policy(), regressedReport(), format);
    mock.timers.setTime(4_102_444_800_000);
    const later = summaryOf(policy(), regressedReport(), format);
    mock.timers.reset();
    assert.equal(epoch, baseline);
    assert.equal(later, baseline);
  }
});

test("markdown and plain summaries carry identical cells", () => {
  for (const candidate of [improvedReport(), regressedReport()]) {
    const markdown = markdownRows(summaryOf(policy(), candidate, "markdown"));
    const text = textRows(summaryOf(policy(), candidate, "text"));
    assert.equal(markdown.length, 3);
    assert.deepEqual(text, markdown);
  }
});

test("summary keeps exactly one row per policy surface in policy order", () => {
  const candidatePolicy = structuredClone(ACTUAL_POLICY);
  const candidateReport = reportFromPolicy(candidatePolicy);
  const expectedSurfaces = [
    "Workspace",
    ...candidatePolicy.files.map((entry) => entry.path),
  ];
  for (const format of ["markdown", "text"]) {
    const rendered = renderCoverageSummary(
      evaluateCoveragePolicy(candidatePolicy, candidateReport, {
        workspaceRoot: REPOSITORY_ROOT,
      }),
      { format },
    );
    const rows =
      format === "markdown" ? markdownRows(rendered) : textRows(rendered);
    assert.deepEqual(
      rows.map((row) => row[0]),
      expectedSurfaces,
    );
    for (const path of expectedSurfaces.slice(1)) {
      assert.equal(rendered.split(path).length - 1, 1, `${path} once`);
    }
  }
});

test("summary rows carry every policy field for their surface", () => {
  const candidatePolicy = structuredClone(ACTUAL_POLICY);
  const rows = markdownRows(
    renderCoverageSummary(
      evaluateCoveragePolicy(candidatePolicy, reportFromPolicy(candidatePolicy), {
        workspaceRoot: REPOSITORY_ROOT,
      }),
      { format: "markdown" },
    ),
  );
  const entries = [candidatePolicy.workspace, ...candidatePolicy.files];
  assert.equal(rows.length, entries.length);
  for (const [index, entry] of entries.entries()) {
    const [
      ,
      coveredTotal,
      coverage,
      baseline,
      deltaCoverage,
      floor,
      uncovered,
      ceiling,
      deltaUncovered,
      status,
    ] = rows[index];
    assert.equal(
      coveredTotal,
      `${countText(entry.measuredCoveredLines)} / ${countText(entry.measuredLines)}`,
    );
    assert.equal(coverage, percentText(entry.measuredLinePercent));
    assert.equal(baseline, percentText(entry.measuredLinePercent));
    assert.equal(floor, percentText(entry.minimumLinePercent));
    assert.equal(uncovered, countText(entry.maximumUncoveredLines));
    assert.equal(ceiling, countText(entry.maximumUncoveredLines));
    assert.equal(deltaCoverage, "0.00 pp");
    assert.equal(deltaUncovered, "0");
    assert.equal(status, "pass");
  }
});

test("summary deltas equal the validated report minus the policy", () => {
  const candidatePolicy = structuredClone(ACTUAL_POLICY);
  const candidateReport = reportFromPolicy(candidatePolicy);
  const shifts = [7, -3, 0, 2, -1, 1, 0, -2, 4, -5];
  const records = [
    candidateReport.data[0].totals,
    ...candidateReport.data[0].files.map((file) => file.summary),
  ];
  for (const [index, record] of records.entries()) {
    const shift = shifts[index % shifts.length];
    // A positive shift adds covered lines; a negative shift adds uncovered
    // lines, so both delta columns move in both directions.
    record.lines = lineSummary(
      record.lines.count + Math.abs(shift),
      record.lines.covered + Math.max(shift, 0),
    );
  }
  const evaluation = evaluateCoveragePolicy(candidatePolicy, candidateReport, {
    workspaceRoot: REPOSITORY_ROOT,
  });
  const rows = markdownRows(
    renderCoverageSummary(evaluation, { format: "markdown" }),
  );
  const entries = [candidatePolicy.workspace, ...candidatePolicy.files];
  for (const [index, entry] of entries.entries()) {
    const lines = records[index].lines;
    const row = rows[index];
    const expectedPercentDelta = lines.percent - entry.measuredLinePercent;
    assert(
      Math.abs(signedNumber(row[4]) - expectedPercentDelta) <= 0.005,
      `${row[0]} coverage delta ${row[4]} must equal ${expectedPercentDelta}`,
    );
    assert.equal(
      signedNumber(row[8]),
      lines.count - lines.covered - entry.maximumUncoveredLines,
      `${row[0]} uncovered delta`,
    );
    assert.equal(row[1], `${countText(lines.covered)} / ${countText(lines.count)}`);
  }
});

test("adding or removing a monitored file adds or removes exactly its row", () => {
  const added = policy();
  added.files.push({
    path: "crates/colorful-lsp/src/lib.rs",
    measuredLines: 10,
    measuredCoveredLines: 9,
    measuredLinePercent: 90,
    minimumLinePercent: 90,
    maximumUncoveredLines: 1,
  });
  const addedReport = report();
  addedReport.data[0].files.push({
    filename: `${FIXTURE_ROOT}/crates/colorful-lsp/src/lib.rs`,
    summary: { lines: lineSummary(10, 9) },
  });
  const removed = policy();
  removed.files.splice(0, 1, {
    ...removed.files[0],
    path: "crates/colorful-cli/src/main.rs",
  });
  const removedReport = report();
  removedReport.data[0].files[0].filename =
    `${FIXTURE_ROOT}/crates/colorful-cli/src/main.rs`;

  const surfaces = (candidatePolicy, candidateReport) =>
    markdownRows(summaryOf(candidatePolicy, candidateReport, "markdown")).map(
      (row) => row[0],
    );
  const original = surfaces(policy(), report());
  assert.deepEqual(surfaces(added, addedReport), [
    ...original,
    "crates/colorful-lsp/src/lib.rs",
  ]);
  assert.deepEqual(surfaces(removed, removedReport), [
    "Workspace",
    "crates/colorful-cli/src/main.rs",
    "crates/colorful-lsp/src/main.rs",
  ]);
});

test("summary verdicts agree with the validator's machine category", () => {
  const mutations = [
    ["E_COVERAGE_WORKSPACE_FLOOR", "Workspace", (candidate) => {
      candidate.data[0].totals.lines = lineSummary(1_000, 919);
    }],
    ["E_COVERAGE_WORKSPACE_RATCHET", "Workspace", (candidate) => {
      candidate.data[0].totals.lines = lineSummary(1_001, 950);
    }],
    ["E_COVERAGE_FILE_FLOOR", "crates/colorful-cli/src/lib.rs", (candidate) => {
      candidate.data[0].files[0].summary.lines = lineSummary(100, 89);
    }],
    ["E_COVERAGE_FILE_RATCHET", "crates/colorful-lsp/src/main.rs", (candidate) => {
      candidate.data[0].files[1].summary.lines = lineSummary(70, 66);
    }],
    ["E_COVERAGE_FILE_MISSING", "crates/colorful-lsp/src/main.rs", (candidate) => {
      candidate.data[0].files.pop();
    }],
  ];
  for (const [code, surface, mutate] of mutations) {
    const candidate = report();
    mutate(candidate);
    assert.throws(
      () =>
        validateCoveragePolicy(policy(), candidate, {
          workspaceRoot: FIXTURE_ROOT,
        }),
      (error) => error instanceof CoveragePolicyError && error.code === code,
    );
    const evaluation = evaluateCoveragePolicy(policy(), candidate, {
      workspaceRoot: FIXTURE_ROOT,
    });
    assert.equal(evaluation.violations[0].code, code);
    const text = renderCoverageSummary(evaluation, { format: "text" });
    assert(
      text.startsWith(
        `Rust coverage ratchet verdict: FAIL ${code} on ${surface}.\n`,
      ),
      `${code} verdict`,
    );
    const failing = textRows(text).filter((row) => row.at(-1) !== "pass");
    assert.deepEqual(
      failing.map((row) => row[0]),
      [surface],
    );
    assert.match(failing[0].at(-1), new RegExp(`^FAIL .*\\b${code}\\b`, "u"));
  }
  const passing = evaluateCoveragePolicy(policy(), report(), {
    workspaceRoot: FIXTURE_ROOT,
  });
  assert.deepEqual(passing.violations, []);
  assert.doesNotMatch(
    renderCoverageSummary(passing, { format: "markdown" }),
    /FAIL/u,
  );
});

function runChecker(reportBody, summaryPath) {
  const scratch = mkdtempSync(join(tmpdir(), "colorful-coverage-summary-"));
  try {
    const reportPath = join(scratch, "coverage-summary.json");
    writeFileSync(reportPath, JSON.stringify(reportBody));
    const env = { ...process.env };
    delete env.GITHUB_STEP_SUMMARY;
    if (summaryPath !== undefined) {
      env.GITHUB_STEP_SUMMARY = summaryPath(scratch);
    }
    const result = spawnSync(
      process.execPath,
      [CHECKER_PATH, "--report", reportPath],
      { cwd: REPOSITORY_ROOT, encoding: "utf8", env },
    );
    const summaryFile = env.GITHUB_STEP_SUMMARY;
    return {
      ...result,
      summary:
        summaryFile !== undefined &&
        existsSync(summaryFile) &&
        statSync(summaryFile).isFile()
          ? readFileSync(summaryFile, "utf8")
          : undefined,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function actualEvaluation(candidateReport) {
  return evaluateCoveragePolicy(ACTUAL_POLICY, candidateReport, {
    workspaceRoot: REPOSITORY_ROOT,
  });
}

test("command prints the plain summary and appends Markdown in CI", () => {
  const candidateReport = reportFromPolicy(ACTUAL_POLICY);
  const evaluation = actualEvaluation(candidateReport);
  const result = runChecker(candidateReport, (scratch) => {
    const path = join(scratch, "step-summary.md");
    writeFileSync(path, "existing step output\n");
    return path;
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert(
    result.stdout.startsWith(
      renderCoverageSummary(evaluation, { format: "text" }),
    ),
  );
  assert.match(result.stdout, /^check-coverage-policy passed: /mu);
  assert.equal(
    result.summary,
    `existing step output\n${renderCoverageSummary(evaluation, { format: "markdown" })}`,
  );
});

test("command prints the plain summary without a step summary file", () => {
  const candidateReport = reportFromPolicy(ACTUAL_POLICY);
  const result = runChecker(candidateReport);
  assert.equal(result.status, 0, result.stderr);
  assert(
    result.stdout.startsWith(
      renderCoverageSummary(actualEvaluation(candidateReport), {
        format: "text",
      }),
    ),
  );
});

test("command keeps the validator's error and exit status on a regression", () => {
  const candidateReport = reportFromPolicy(ACTUAL_POLICY);
  const regressed = candidateReport.data[0].files.find(
    (file) => file.filename === "crates/colorful-lsp/src/lib.rs",
  );
  regressed.summary.lines = lineSummary(
    regressed.summary.lines.count + 1,
    regressed.summary.lines.covered,
  );
  let expected;
  try {
    validateCoveragePolicy(ACTUAL_POLICY, candidateReport, {
      workspaceRoot: REPOSITORY_ROOT,
    });
  } catch (error) {
    expected = error;
  }
  assert(expected instanceof CoveragePolicyError);
  assert.equal(expected.code, "E_COVERAGE_FILE_RATCHET");

  const result = runChecker(candidateReport, (scratch) =>
    join(scratch, "step-summary.md"),
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, `${expected.message}\n`);
  assert.doesNotMatch(result.stdout, /check-coverage-policy passed/u);
  assert.equal(
    result.stdout,
    renderCoverageSummary(actualEvaluation(candidateReport), {
      format: "text",
    }),
  );
  assert.equal(
    result.summary,
    renderCoverageSummary(actualEvaluation(candidateReport), {
      format: "markdown",
    }),
  );
  assert(
    result.summary.includes(
      "Verdict: **FAIL** `E_COVERAGE_FILE_RATCHET` on `crates/colorful-lsp/src/lib.rs`.",
    ),
  );
});

test("an unwritable step summary cannot change the gate's verdict", () => {
  const candidateReport = reportFromPolicy(ACTUAL_POLICY);
  const result = runChecker(candidateReport, (scratch) => {
    const directory = join(scratch, "not-a-file");
    mkdirSync(directory);
    return directory;
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^check-coverage-policy passed: /mu);
  assert.match(
    result.stderr,
    /^check-coverage-policy: could not append the advisory step summary: /u,
  );
});

test("a workspace regression keeps precedence over malformed file records", () => {
  expectPolicyError(
    "E_COVERAGE_WORKSPACE_FLOOR",
    () => {},
    (candidate) => {
      candidate.data[0].totals.lines = lineSummary(1_000, 919);
      candidate.data[0].files[0].summary.lines.covered = Number.NaN;
    },
  );
  expectPolicyError(
    "E_COVERAGE_REPORT",
    () => {},
    (candidate) => {
      candidate.data[0].files[0].summary.lines.covered = Number.NaN;
    },
  );
});
