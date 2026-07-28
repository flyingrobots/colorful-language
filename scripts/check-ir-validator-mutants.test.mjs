#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const checkerPath = path.join(root, "scripts/check-ir-validator-mutants.sh");
const checker = fs.readFileSync(checkerPath, "utf8");

function assertBoundedPhases(source) {
  const requiredLines = [
    "  --timeout 60 \\",
    "  --build-timeout 60 \\",
  ];
  for (const line of requiredLines) {
    assert.equal(
      source.split("\n").filter((candidate) => candidate === line).length,
      1,
      `mutation gate must contain exactly one ${line.trim()}`,
    );
  }
}

test("the mutation gate bounds test and build phases", () => {
  assertBoundedPhases(checker);
});

for (const line of ["  --timeout 60 \\\n", "  --build-timeout 60 \\\n"]) {
  test(`the timeout policy rejects removal of ${line.trim()}`, () => {
    assert.throws(
      () => assertBoundedPhases(checker.replace(line, "")),
      /mutation gate must contain exactly one/u,
    );
  });
}
