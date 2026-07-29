#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createReviewedCaseRegistry,
  SYNTAX_ADMISSION_REVIEW_CASES,
} from "./syntax-admission-review-cases.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_PATH =
  "consumers/independent-ir-report/evidence/integration-effort.json";
const MEASURE_PATH =
  "consumers/independent-ir-report/src/measure.mjs";

function registry(expectedCases = SYNTAX_ADMISSION_REVIEW_CASES) {
  const registered = [];
  return {
    registered,
    registry: createReviewedCaseRegistry({
      expectedCases,
      registerCase(name) {
        registered.push(name);
      },
    }),
  };
}

test("reviewed case registration rejects inventory drift deterministically", () => {
  const complete = registry();
  for (const name of SYNTAX_ADMISSION_REVIEW_CASES) {
    complete.registry.register(name);
  }
  assert.doesNotThrow(() => complete.registry.assertComplete());
  assert.deepEqual(complete.registered, SYNTAX_ADMISSION_REVIEW_CASES);

  const missing = registry();
  for (const name of SYNTAX_ADMISSION_REVIEW_CASES.slice(1)) {
    missing.registry.register(name);
  }
  assert.throws(
    () => missing.registry.assertComplete(),
    new RegExp(
      `^Error: missing syntax-admission registrations: ` +
        SYNTAX_ADMISSION_REVIEW_CASES[0],
      "u",
    ),
  );

  const extra = registry();
  assert.throws(
    () => extra.registry.register("unreviewed mutation"),
    /^Error: unreviewed syntax-admission case: unreviewed mutation$/u,
  );

  const duplicate = registry();
  duplicate.registry.register(SYNTAX_ADMISSION_REVIEW_CASES[0]);
  assert.throws(
    () => duplicate.registry.register(SYNTAX_ADMISSION_REVIEW_CASES[0]),
    /^Error: duplicate syntax-admission registration:/u,
  );

  const mutableExpected = ["stable authority"];
  const snapshotted = registry(mutableExpected);
  mutableExpected.push("late mutation");
  snapshotted.registry.register("stable authority");
  assert.doesNotThrow(() => snapshotted.registry.assertComplete());
});

test("the burden ledger derives its reviewed count from the inventory", () => {
  const measureSource = readFileSync(path.join(ROOT, MEASURE_PATH), "utf8");
  assert.doesNotMatch(
    measureSource,
    /\breviewedGeneratorCases:\s*\d+\b/u,
    "measure.mjs must not embed a reviewed generator-case count",
  );

  const ledger = JSON.parse(
    readFileSync(path.join(ROOT, LEDGER_PATH), "utf8"),
  );
  assert.equal(
    ledger.portableAdmission.reviewedGeneratorCaseAuthority,
    "scripts/syntax-admission-review-cases.mjs",
  );
  assert.equal(
    ledger.portableAdmission.reviewedGeneratorCases,
    SYNTAX_ADMISSION_REVIEW_CASES.length,
  );
});

test("an inventory mutation makes the checked-in ledger stale", (t) => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-reviewed-cases-"),
  );
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

  const packagePath = "consumers/independent-ir-report";
  cpSync(
    path.join(ROOT, packagePath),
    path.join(temporaryRoot, packagePath),
    {
      recursive: true,
      filter(source) {
        return path.basename(source) !== "node_modules";
      },
    },
  );
  const generatedPath = "consumers/generated/syntax-admission-v1.mjs";
  mkdirSync(path.dirname(path.join(temporaryRoot, generatedPath)), {
    recursive: true,
  });
  cpSync(
    path.join(ROOT, generatedPath),
    path.join(temporaryRoot, generatedPath),
  );

  const authorityPath = "scripts/syntax-admission-review-cases.mjs";
  mkdirSync(path.dirname(path.join(temporaryRoot, authorityPath)), {
    recursive: true,
  });
  const authority = readFileSync(path.join(ROOT, authorityPath), "utf8");
  const mutated = authority.replace(
    "\n]);\n",
    '\n  "synthetic reviewed mutation",\n]);\n',
  );
  assert.notEqual(mutated, authority);
  writeFileSync(path.join(temporaryRoot, authorityPath), mutated);

  const result = spawnSync(
    process.execPath,
    [path.join(temporaryRoot, packagePath, "src/measure.mjs"), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "independent-ir-report: integration-effort ledger is stale; " +
      "run npm run measure -- --write\n",
  );
});
