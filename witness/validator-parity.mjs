// Cross-language negative-contract witness: apply every mutation in the
// shared matrix to a canonical Rust-produced document and require the
// JavaScript wire validator to reject it with the recorded stable code.
//
//   node witness/validator-parity.mjs SOURCE DOCUMENT_JSON
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GraftProjectionError,
  validateWireContract,
} from "../consumers/graft-projection.mjs";

const MATRIX_URL = new URL(
  "../crates/colorful-ir/tests/fixtures/validator-parity.json",
  import.meta.url,
);

function decodePointerToken(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function replaceAtPointer(document, pointer, value) {
  assert.match(pointer, /^\//, `replacement pointer must be absolute: ${pointer}`);
  const tokens = pointer.slice(1).split("/").map(decodePointerToken);
  const finalToken = tokens.pop();
  let parent = document;

  for (const token of tokens) {
    assert(
      parent !== null && typeof parent === "object" && Object.hasOwn(parent, token),
      `replacement pointer does not exist: ${pointer}`,
    );
    parent = parent[token];
  }

  assert(
    parent !== null && typeof parent === "object" && Object.hasOwn(parent, finalToken),
    `replacement pointer does not exist: ${pointer}`,
  );
  parent[finalToken] = structuredClone(value);
}

function sourceBytes(testCase, defaultSource) {
  if (testCase.sourceHex === undefined) return defaultSource;
  assert.match(testCase.sourceHex, /^(?:[0-9a-fA-F]{2})*$/, `${testCase.name}: invalid sourceHex`);
  return Buffer.from(testCase.sourceHex, "hex");
}

const sourcePath = process.argv[2];
const documentPath = process.argv[3];
if (!sourcePath || !documentPath) {
  console.error("usage: node witness/validator-parity.mjs SOURCE DOCUMENT_JSON");
  process.exit(2);
}

const matrix = JSON.parse(readFileSync(MATRIX_URL, "utf8"));
const baseDocument = JSON.parse(readFileSync(documentPath, "utf8"));
const defaultSource = readFileSync(sourcePath);
assert.equal(matrix.schemaVersion, 1, "unsupported validator parity matrix version");
assert(Array.isArray(matrix.cases), "validator parity matrix cases must be an array");

const caseNames = new Set();
for (const testCase of matrix.cases) {
  assert(!caseNames.has(testCase.name), `duplicate parity case name: ${testCase.name}`);
  caseNames.add(testCase.name);
  assert(Array.isArray(testCase.replacements), `${testCase.name}: replacements must be an array`);
  assert(testCase.replacements.length > 0, `${testCase.name}: needs at least one replacement`);
  assert.match(testCase.rustError, /^[A-Z][A-Za-z0-9]+$/, `${testCase.name}: invalid rustError`);
  assert.match(testCase.jsError, /^E_[A-Z0-9_]+$/, `${testCase.name}: invalid jsError`);

  const document = structuredClone(baseDocument);
  for (const replacement of testCase.replacements) {
    replaceAtPointer(document, replacement.pointer, replacement.value);
  }

  assert.throws(
    () => validateWireContract(sourceBytes(testCase, defaultSource), document),
    (error) => {
      assert(
        error instanceof GraftProjectionError,
        `${testCase.name}: expected GraftProjectionError, got ${error?.constructor?.name}`,
      );
      assert.equal(error.code, testCase.jsError, `${testCase.name}: wrong JavaScript error code`);
      return true;
    },
    `${testCase.name}: JavaScript validator accepted the mutation`,
  );
}

console.log(`  ✅ JavaScript rejected all ${matrix.cases.length} shared validator mutations`);
