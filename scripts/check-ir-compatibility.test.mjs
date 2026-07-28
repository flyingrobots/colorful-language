import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IrCompatibilityError,
  selectCompatibilityGeneration,
  validateCompatibilityManifest,
  workspaceIdentity,
} from "./check-ir-compatibility.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EVIDENCE = "docs/topics/ir/test-plan.md";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const HASH_E = `sha256:${"e".repeat(64)}`;

function identity(schemaHash, vocabularyHash) {
  return {
    contractVersion: "colorful.syntax/v1",
    schemaHash,
    vocabularyHash,
  };
}

function manifestFixture() {
  return {
    version: "colorful.syntax-compatibility/v1",
    contractFamily: "colorful.syntax/v1",
    currentIdentity: identity(HASH_C, HASH_D),
    policy: {
      "description-only": "preserve-generation",
      "nullable-field": "explicit-generation",
      vocabulary: "explicit-generation",
      "schema-hash-algorithm": "explicit-generation",
      "required-field": "new-contract-version",
      "field-removal": "new-contract-version",
      "field-reinterpretation": "new-contract-version",
      "enum-change": "new-contract-version",
    },
    generations: [
      {
        id: "v0.2.1",
        identity: identity(HASH_A, HASH_B),
        schemaHashMode: "raw-sdl-sha256",
        predecessor: null,
        compatibilityDecision: "origin",
        changeKinds: [],
        wireShape: { openClassKind: "absent" },
        migrationEvidence: [EVIDENCE],
      },
      {
        id: "v0.3.0",
        identity: identity(HASH_C, HASH_D),
        schemaHashMode: "raw-sdl-sha256",
        predecessor: "v0.2.1",
        compatibilityDecision: "adapter-required",
        changeKinds: ["nullable-field", "vocabulary"],
        wireShape: { openClassKind: "nullable" },
        migrationEvidence: [EVIDENCE],
      },
    ],
  };
}

function expectCompatibilityError(code, operation) {
  assert.throws(
    operation,
    (error) => error instanceof IrCompatibilityError && error.code === code,
  );
}

test("a valid compatibility family selects only exact identity tuples", () => {
  const manifest = manifestFixture();
  validateCompatibilityManifest(manifest, {
    currentIdentity: manifest.currentIdentity,
    repositoryRoot: ROOT,
  });

  assert.equal(
    selectCompatibilityGeneration(
      manifest,
      identity(HASH_A, HASH_B),
    ).id,
    "v0.2.1",
  );
  expectCompatibilityError("E_UNSUPPORTED_IDENTITY", () =>
    selectCompatibilityGeneration(manifest, identity(HASH_A, HASH_E)),
  );
});

test("manifest validation rejects each compatibility-authority mutation", () => {
  const cases = [
    [
      "E_POLICY",
      (manifest) => {
        manifest.policy["required-field"] = "explicit-generation";
      },
    ],
    [
      "E_DUPLICATE_IDENTITY",
      (manifest) => {
        manifest.generations.push({
          ...structuredClone(manifest.generations[1]),
          id: "duplicate-v0.3.0",
        });
      },
    ],
    [
      "E_PREDECESSOR",
      (manifest) => {
        manifest.generations[1].predecessor = "missing";
      },
    ],
    [
      "E_CYCLE",
      (manifest) => {
        manifest.generations[0].predecessor = "v0.3.0";
        manifest.generations[0].compatibilityDecision = "identity-only";
        manifest.generations[0].changeKinds = ["schema-hash-algorithm"];
      },
    ],
    [
      "E_DECISION",
      (manifest) => {
        manifest.generations[1].compatibilityDecision = "trust-the-release-tag";
      },
    ],
    [
      "E_EVIDENCE",
      (manifest) => {
        manifest.generations[1].migrationEvidence = [];
      },
    ],
    [
      "E_CURRENT_IDENTITY",
      (manifest) => {
        manifest.currentIdentity = identity(HASH_E, HASH_D);
      },
    ],
  ];

  for (const [code, mutate] of cases) {
    const manifest = manifestFixture();
    mutate(manifest);
    expectCompatibilityError(code, () =>
      validateCompatibilityManifest(manifest, {
        currentIdentity: manifest.currentIdentity,
        repositoryRoot: ROOT,
      }),
    );
  }
});

test("the canonical manifest records every supported wire generation", () => {
  const canonicalPath = path.join(
    ROOT,
    "contracts",
    "colorful",
    "syntax-compatibility.v1.json",
  );
  const canonicalText = readFileSync(canonicalPath, "utf8");
  const manifest = JSON.parse(canonicalText);
  const currentIdentity = workspaceIdentity(ROOT);

  validateCompatibilityManifest(manifest, {
    currentIdentity,
    repositoryRoot: ROOT,
  });
  assert.deepEqual(
    manifest.generations.map((generation) => generation.id),
    ["v0.2.1", "v0.3.0", "workspace-v0.4.0"],
  );
  assert.deepEqual(manifest.currentIdentity, currentIdentity);
  assert.equal(
    selectCompatibilityGeneration(manifest, currentIdentity).id,
    "workspace-v0.4.0",
  );

  for (const copy of [
    path.join(
      ROOT,
      "crates",
      "colorful-ir",
      "contracts",
      "syntax-compatibility.v1.json",
    ),
    path.join(
      ROOT,
      "consumers",
      "independent-ir-report",
      "compatibility.v1.json",
    ),
  ]) {
    assert.equal(readFileSync(copy, "utf8"), canonicalText);
  }
});
