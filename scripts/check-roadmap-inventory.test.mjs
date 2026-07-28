import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  closingIssueNumbersForRepository,
  InventoryError,
  run,
  validateRoadmapInventory,
} from "./check-roadmap-inventory.mjs";

const fixtureRoot = new URL("./fixtures/roadmap-inventory/", import.meta.url);
const roadmap = readFileSync(new URL("roadmap.md", fixtureRoot), "utf8");
const issues = JSON.parse(
  readFileSync(new URL("issues.json", fixtureRoot), "utf8"),
);

function expectCategory(category, mutation, options = {}) {
  assert.throws(
    () =>
      validateRoadmapInventory({
        roadmap: mutation(roadmap),
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
        ...options,
      }),
    (error) => {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, category);
      assert.match(error.message, /^E_ROADMAP_[A-Z_]+: /u);
      assert.match(error.message, /fixture\/(?:roadmap\.md|issues\.json)/u);
      return true;
    },
  );
}

test("accepts one primary home for every open non-epic slice", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("rejects an open slice missing from the primary inventory", () => {
  expectCategory("E_ROADMAP_MISSING_OPEN", (source) =>
    source.replace("  <!-- roadmap-primary: active #101 -->\n", ""),
  );
});

test("rejects duplicate primary homes", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_PRIMARY",
    (source) => `${source}\n<!-- roadmap-primary: active #101 -->\n`,
  );
});

test("rejects a closed slice presented as active", () => {
  expectCategory("E_ROADMAP_CLOSED_ACTIVE", (source) =>
    source.replace(
      "roadmap-primary: delivered #103",
      "roadmap-primary: active #103",
    ),
  );
});

test("rejects an open slice presented as delivered", () => {
  expectCategory("E_ROADMAP_OPEN_DELIVERED", (source) =>
    source.replace(
      "roadmap-primary: active #101",
      "roadmap-primary: delivered #101",
    ),
  );
});

test("rejects a primary marker for an unknown issue", () => {
  expectCategory(
    "E_ROADMAP_UNKNOWN_ISSUE",
    (source) => `${source}\n<!-- roadmap-primary: active #999 -->\n`,
  );
});

test("rejects an unrecognized primary disposition", () => {
  expectCategory("E_ROADMAP_INVALID_MARKER", (source) =>
    source.replace(
      "roadmap-primary: active #101",
      "roadmap-primary: someday #101",
    ),
  );
});

test("treats issues closed by the current pull request as delivered", () => {
  const transitioningRoadmap = roadmap.replace(
    "roadmap-primary: active #101",
    "roadmap-primary: delivered #101",
  );

  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: transitioningRoadmap,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
      closingIssueNumbers: new Set([101]),
    }),
  );
});

test("requires a delivered marker for a slice closed by the pull request", () => {
  expectCategory(
    "E_ROADMAP_MISSING_DELIVERED",
    (source) =>
      source.replace("  <!-- roadmap-primary: active #101 -->\n", ""),
    { closingIssueNumbers: new Set([101]) },
  );
});

test("ignores closing references to a different repository", () => {
  const references = [
    {
      number: 101,
      repository: {
        name: "colorful-language",
        owner: { login: "flyingrobots" },
      },
    },
    {
      number: 101,
      repository: {
        name: "other-project",
        owner: { login: "someone-else" },
      },
    },
    {
      number: 202,
      repository: {
        name: "other-project",
        owner: { login: "someone-else" },
      },
    },
  ];

  assert.deepEqual(
    closingIssueNumbersForRepository(
      references,
      "flyingrobots/colorful-language",
    ),
    new Set([101]),
  );
});

test("rejects a missing option value with a stable usage error", () => {
  assert.throws(
    () => run(["--roadmap"]),
    (error) => {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, "E_ROADMAP_USAGE");
      assert.match(error.message, /arguments/u);
      assert.match(error.message, /--roadmap/u);
      return true;
    },
  );
});

test("rejects malformed issue JSON with a stable snapshot error", () => {
  const roadmapPath = fileURLToPath(new URL("roadmap.md", fixtureRoot));
  const issuePath = fileURLToPath(
    new URL("invalid-issues.txt", fixtureRoot),
  );

  assert.throws(
    () => run(["--roadmap", roadmapPath, "--issues", issuePath]),
    (error) => {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, "E_ROADMAP_INVALID_ISSUE_SNAPSHOT");
      assert.match(error.message, /invalid-issues\.txt/u);
      return true;
    },
  );
});

test("bounds live GitHub calls by time and response size", () => {
  const checker = readFileSync(
    new URL("./check-roadmap-inventory.mjs", import.meta.url),
    "utf8",
  );

  assert.match(checker, /timeout:\s*30_000/u);
  assert.match(checker, /maxBuffer:\s*16 \* 1024 \* 1024/u);
});

test("the repository wires offline and live reconciliation into distinct lanes", () => {
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const maintenance = readFileSync(
    new URL("../.github/workflows/maintenance.yml", import.meta.url),
    "utf8",
  );
  const releasePrep = readFileSync(
    new URL("./release-prep.sh", import.meta.url),
    "utf8",
  );

  for (const source of [ci, releasePrep]) {
    assert.match(
      source,
      /node --test scripts\/check-roadmap-inventory\.test\.mjs/u,
    );
    assert.match(
      source,
      /node scripts\/check-roadmap-inventory\.mjs(?:\s|$)/u,
    );
  }
  assert.match(ci, /--closing-pr "\$PULL_REQUEST"/u);
  assert.match(
    ci,
    /^\s*issues:\s*read\s*# Live issue snapshot reconciliation\.\s*$/mu,
  );
  assert.match(
    ci,
    /^\s*pull-requests:\s*read\s*# Closing-issue references\.\s*$/mu,
  );
  assert.match(maintenance, /^\s*schedule:\s*$/mu);
  assert.match(maintenance, /^\s*workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(maintenance, /^\s*pull_request:\s*$/mu);
  assert.match(
    maintenance,
    /^concurrency:\s*\n\s+group:\s*roadmap-issue-reconciliation\s*\n\s+cancel-in-progress:\s*false\s*$/mu,
  );
  assert.match(maintenance, /^\s*persist-credentials:\s*false\s*$/mu);
  assert.match(
    maintenance,
    /^\s*contents:\s*read\s*# Repository checkout\.\s*$/mu,
  );
  assert.match(
    maintenance,
    /^\s*issues:\s*read\s*# Live issue snapshot reconciliation\.\s*$/mu,
  );
  assert.match(
    maintenance,
    /node scripts\/check-roadmap-inventory\.mjs\s+--live\s+--repo "\$REPOSITORY"/u,
  );
});
