#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkPortableAdmissionDocs,
  PORTABLE_ADMISSION_DOCS,
} from "./check-portable-admission-docs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_PATH =
  "consumers/independent-ir-report/evidence/integration-effort.json";

function currentInputs() {
  return {
    ledger: JSON.parse(readFileSync(path.join(ROOT, LEDGER_PATH), "utf8")),
    documents: new Map(
      PORTABLE_ADMISSION_DOCS.map((relativePath) => [
        relativePath,
        readFileSync(path.join(ROOT, relativePath), "utf8"),
      ]),
    ),
  };
}

test("portable admission burden is synchronized across current references", () => {
  assert.doesNotThrow(() => checkPortableAdmissionDocs(currentInputs()));
});

test("a stale current-reference burden count fails with its path", () => {
  const inputs = currentInputs();
  const target = "docs/topics/ir/README.md";
  inputs.documents.set(
    target,
    inputs.documents.get(target).replace(
      "249 authored nonblank IR adapter lines",
      "999 authored nonblank IR adapter lines",
    ),
  );
  assert.throws(
    () => checkPortableAdmissionDocs(inputs),
    new RegExp(`portable admission documentation drift: ${target}`, "u"),
  );
});
