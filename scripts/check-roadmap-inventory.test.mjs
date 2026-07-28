import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  InventoryError,
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
