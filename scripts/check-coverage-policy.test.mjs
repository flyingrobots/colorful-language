#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  CoveragePolicyError,
  validateCoveragePolicy,
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

function lineSummary(count, covered) {
  return {
    count,
    covered,
    percent: (covered * 100) / count,
  };
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
        steps: [
          { uses: CHECKOUT_ACTION },
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
            run: "cargo llvm-cov report --html --output-dir target/llvm-cov/html",
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
    (error) =>
      error instanceof CoveragePolicyError && error.code === code,
  );
}

function expectWorkflowError(code, mutate) {
  const candidate = workflow();
  mutate(candidate);
  assert.throws(
    () => validateCoverageWorkflow(candidate, policy()),
    (error) =>
      error instanceof CoveragePolicyError && error.code === code,
  );
}

test("accepts the reviewed workspace and transport coverage", () => {
  assert.doesNotThrow(() =>
    validateCoveragePolicy(policy(), report(), {
      workspaceRoot: "/checkout/colorful-language",
    }),
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
      candidate.data[0].files[1].summary.lines = lineSummary(65, 61);
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

test("rejects a coverage command that omits all targets", () => {
  expectWorkflowError("E_COVERAGE_COMMAND", (candidate) => {
    candidate.jobs.coverage.steps[4].run =
      candidate.jobs.coverage.steps[4].run.replace(" --all-targets", "");
  });
});

test("rejects a floating or wrong upload action", () => {
  expectWorkflowError("E_COVERAGE_ACTION", (candidate) => {
    candidate.jobs.coverage.steps[7].uses = "actions/upload-artifact@v7";
  });
});

test("rejects an artifact without both machine and browsable reports", () => {
  expectWorkflowError("E_COVERAGE_ARTIFACT", (candidate) => {
    candidate.jobs.coverage.steps[7].with.path =
      "target/llvm-cov/coverage-summary.json";
  });
});

test("rejects an unbounded artifact retention period", () => {
  expectWorkflowError("E_COVERAGE_ARTIFACT", (candidate) => {
    delete candidate.jobs.coverage.steps[7].with["retention-days"];
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
