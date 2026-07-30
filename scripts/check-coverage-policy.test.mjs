#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CoveragePolicyError,
  validateCoveragePolicy,
  validateCoverageReference,
  validateCoverageRuleset,
  validateCoverageWorkflow,
} from "./check-coverage-policy.mjs";

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
const UPDATED_ACTIONS = new Map([
  [
    "actions/checkout",
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  ],
  [
    "taiki-e/install-action",
    "taiki-e/install-action@065d6a08a14e61e89fb0a4c10eecdbdef39c7d8e",
  ],
  [
    "actions/upload-artifact",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
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
