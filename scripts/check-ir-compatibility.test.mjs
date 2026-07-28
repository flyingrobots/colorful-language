import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as compatibilityChecker from "./check-ir-compatibility.mjs";
import {
  classifySchemaTransition,
  IrCompatibilityError,
  selectCompatibilityGeneration,
  stripGraphqlDescriptions,
  validateCompatibilityCopies,
  validateCompatibilityManifest,
  workspaceIdentity,
} from "./check-ir-compatibility.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EVIDENCE = "scripts/version-compat-matrix.sh";
const HASH_A =
  "sha256:acf86cf0f9d31f5b02df8e546e8b968a6c8e78d94761a5bbe81750f219101a58";
const HASH_B =
  "sha256:c3709c173d632bd18385b991f63dc3ac09cdba582bc05550f0376db24117bbe1";
const HASH_C =
  "sha256:f090e7ee24920d7b8c55e8da34e0f70d863414d8ba0c20b52a5913c3d0884c20";
const HASH_D =
  "sha256:c4f1a36f839ba6e56955c60c8fa45f8d6692685fd137eed2a084416f52531461";
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
        sourceCommit: "3ff6a1d317cd8df30a8ac86a30077f4282484544",
        identity: identity(HASH_A, HASH_B),
        schemaHashMode: "raw-sdl-sha256",
        artifacts: {
          schema:
            "consumers/independent-ir-report/fixtures/releases/v0.2.1/syntax.v1.graphql",
          vocabulary:
            "consumers/independent-ir-report/fixtures/releases/v0.2.1/vocabulary.v1.json",
        },
        predecessor: null,
        compatibilityDecision: "origin",
        changeKinds: [],
        wireShape: { optionalFields: [] },
        migrationEvidence: [EVIDENCE],
      },
      {
        id: "v0.3.0",
        sourceCommit: "f97b9f5051de7b846892bd2ecf2576bc2567f1ee",
        identity: identity(HASH_C, HASH_D),
        schemaHashMode: "raw-sdl-sha256",
        artifacts: {
          schema:
            "consumers/independent-ir-report/fixtures/releases/v0.3.0/syntax.v1.graphql",
          vocabulary:
            "consumers/independent-ir-report/fixtures/releases/v0.3.0/vocabulary.v1.json",
        },
        predecessor: "v0.2.1",
        compatibilityDecision: "adapter-required",
        changeKinds: ["nullable-field", "vocabulary"],
        wireShape: { optionalFields: ["Token.openClassKind"] },
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

test("wire shape represents nullable fields without a field-specific schema", () => {
  const manifest = manifestFixture();

  validateCompatibilityManifest(manifest, {
    currentIdentity: manifest.currentIdentity,
    repositoryRoot: ROOT,
  });
  assert.deepEqual(
    selectCompatibilityGeneration(
      manifest,
      manifest.generations[1].identity,
    ).wireShape.optionalFields,
    ["Token.openClassKind"],
  );
});

test("only additive nullable SDL changes remain inside the contract family", () => {
  const baseline = `
"Description one."
type DocumentAnalysis {
  token: Token!
}

type Token {
  text: String!
  role: Role
}

enum Role {
  WORD
}
`;
  const nullableAddition = `
"Description two."
type DocumentAnalysis {
  token: Token!
}

type Token {
  text: String!
  role: Role
  openKind: OpenKind
}

enum Role {
  WORD
}

enum OpenKind {
  NOUN
  VERB
}
`;
  assert.deepEqual(
    classifySchemaTransition(baseline, nullableAddition),
    ["Token.openKind"],
  );
  assert.deepEqual(
    classifySchemaTransition(
      baseline,
      baseline.replace("Description one.", "Edited description."),
    ),
    [],
  );
  const blockDescribed = baseline.replace(
    '"Description one."',
    '"""\nDescription one.\nSecond line.\n"""',
  );
  assert.deepEqual(
    classifySchemaTransition(
      blockDescribed,
      blockDescribed.replace("Second line.", "Edited second line."),
    ),
    [],
  );
  assert.deepEqual(
    classifySchemaTransition(
      baseline,
      baseline.replace("  role: Role", "  role: Role # remains nullable"),
    ),
    [],
  );
  assert.equal(
    stripGraphqlDescriptions(blockDescribed),
    stripGraphqlDescriptions(
      blockDescribed.replace("Second line.", "Edited second line."),
    ),
  );

  const incompatible = [
    baseline.replace("  role: Role", "  role: Role\n  required: String!"),
    baseline.replace("  text: String!\n", ""),
    baseline.replace("  text: String!", "  text: Int!"),
    baseline.replace("  WORD\n", "  WORD\n  NUMBER\n"),
    `${baseline}\ntype Unreachable {\n  value: String!\n}\n`,
  ];
  for (const current of incompatible) {
    expectCompatibilityError("E_SCHEMA_POLICY", () =>
      classifySchemaTransition(baseline, current)
    );
  }
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
          id: "workspace-duplicate-v0.3.0",
          sourceCommit: null,
        });
      },
    ],
    [
      "E_DUPLICATE_GENERATION",
      (manifest) => {
        const duplicate = structuredClone(manifest.generations[1]);
        duplicate.identity = identity(HASH_C, HASH_E);
        manifest.generations.push(duplicate);
      },
    ],
    [
      "E_MANIFEST_SHAPE",
      (manifest) => {
        delete manifest.generations[1].wireShape;
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
      "E_DECISION",
      (manifest) => {
        manifest.generations[1].changeKinds = ["required-field"];
      },
    ],
    [
      "E_ARTIFACT_HASH",
      (manifest) => {
        manifest.generations[0].identity.schemaHash = HASH_E;
      },
    ],
    [
      "E_EVIDENCE",
      (manifest) => {
        manifest.generations[1].migrationEvidence = [];
      },
    ],
    [
      "E_EVIDENCE",
      (manifest) => {
        manifest.generations[1].migrationEvidence = ["README.md"];
      },
    ],
    [
      "E_CURRENT_IDENTITY",
      (manifest) => {
        manifest.currentIdentity = identity(HASH_E, HASH_D);
      },
    ],
    [
      "E_RELEASE_PROVENANCE",
      (manifest) => {
        manifest.generations[1].sourceCommit = "e".repeat(40);
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

test("transition decisions must match their predecessor deltas", () => {
  const cases = [
    (manifest) => {
      manifest.generations[0].wireShape.optionalFields = [
        "Token.openClassKind",
      ];
    },
    (manifest) => {
      manifest.generations[1].changeKinds = ["nullable-field"];
    },
    (manifest) => {
      manifest.generations[1].changeKinds.push("schema-hash-algorithm");
    },
    (manifest) => {
      manifest.generations[0].wireShape.optionalFields = [
        "Token.openClassKind",
      ];
      manifest.generations[1].changeKinds = ["vocabulary"];
    },
    (manifest) => {
      manifest.generations[1].identity.vocabularyHash = HASH_B;
      manifest.generations[1].artifacts.vocabulary =
        manifest.generations[0].artifacts.vocabulary;
      manifest.currentIdentity = identity(HASH_C, HASH_B);
    },
    (manifest) => {
      manifest.generations[1].wireShape.optionalFields = [];
    },
  ];

  for (const mutate of cases) {
    const manifest = manifestFixture();
    mutate(manifest);
    expectCompatibilityError("E_TRANSITION", () =>
      validateCompatibilityManifest(manifest, {
        currentIdentity: manifest.currentIdentity,
        repositoryRoot: ROOT,
      }),
    );
  }
});

test("GraphQL underscore coordinates reach transition validation", () => {
  const manifest = manifestFixture();
  manifest.generations[0].wireShape.optionalFields = [
    "Token._legacyOptional",
  ];
  manifest.generations[1].wireShape.optionalFields = [
    "Token._legacyOptional",
    "Token.openClassKind",
  ];

  expectCompatibilityError("E_TRANSITION", () =>
    validateCompatibilityManifest(manifest, {
      currentIdentity: manifest.currentIdentity,
      repositoryRoot: ROOT,
    })
  );
});

test("compatibility copies fail closed on byte drift", () => {
  validateCompatibilityCopies("canonical\n", [
    { label: "matching copy", text: "canonical\n" },
  ]);
  expectCompatibilityError("E_COPY_DRIFT", () =>
    validateCompatibilityCopies("canonical\n", [
      { label: "stale copy", text: "stale\n" },
    ]),
  );
});

test("a missing compatibility copy fails through the production loader", (t) => {
  const emptyRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-missing-compatibility-copy-"),
  );
  t.after(() => rmSync(emptyRoot, { recursive: true, force: true }));
  assert.equal(
    typeof compatibilityChecker.loadCompatibilityCopies,
    "function",
  );
  expectCompatibilityError("E_COPY_DRIFT", () =>
    compatibilityChecker.loadCompatibilityCopies(emptyRoot, [
      "missing-copy.json",
    ])
  );
});

test("workspace identity reports missing authority files by stable category", (t) => {
  const emptyRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-missing-compatibility-authority-"),
  );
  t.after(() => rmSync(emptyRoot, { recursive: true, force: true }));
  expectCompatibilityError("E_CURRENT_IDENTITY", () =>
    workspaceIdentity(emptyRoot)
  );
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
  assert.deepEqual(
    manifest.generations.map((generation) => generation.sourceCommit),
    [
      "3ff6a1d317cd8df30a8ac86a30077f4282484544",
      "f97b9f5051de7b846892bd2ecf2576bc2567f1ee",
      null,
    ],
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
