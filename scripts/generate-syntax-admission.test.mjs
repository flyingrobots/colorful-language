#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import nodeTest from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateSyntaxAdmission,
  renderSyntaxAdmission,
  syntaxAdmissionInputsFromCompatibility,
} from "./generate-syntax-admission.mjs";
import {
  createReviewedCaseRegistry,
  SYNTAX_ADMISSION_REVIEW_CASES,
} from "./syntax-admission-review-cases.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GRAFT_OUTPUT = "consumers/generated/syntax-admission-v1.mjs";
const INDEPENDENT_OUTPUT =
  "consumers/independent-ir-report/generated/syntax-admission-v1.mjs";
const reviewedCases = createReviewedCaseRegistry({
  expectedCases: SYNTAX_ADMISSION_REVIEW_CASES,
  registerCase: nodeTest,
});
const test = reviewedCases.register;

function releaseDocument(release) {
  return JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        "consumers/independent-ir-report/fixtures/releases",
        release,
        "ir.json",
      ),
      "utf8",
    ),
  );
}

function currentDocument() {
  return {
    contractVersion: "colorful.syntax/v1",
    schemaHash: "sha256:shape-only",
    vocabularyHash: "sha256:shape-only",
    source: {
      unitId: "fixture.txt",
      contentHash: "sha256:shape-only",
      utf8ByteLength: 1,
    },
    tokens: [
      {
        occurrenceId: 0,
        byteRange: { startUtf8: 0, endUtf8: 1 },
        tokenKind: "WORD",
        lexicalClass: "CONTENT",
        functionKind: null,
        openClassKind: null,
      },
    ],
    structure: [],
    diagnostics: [],
    derivation: [],
  };
}

async function importSource(source) {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function assertShapeError(operation, pathPattern) {
  assert.throws(
    operation,
    (error) =>
      error?.name === "SyntaxAdmissionError" &&
      error.code === "E_SYNTAX_SHAPE" &&
      pathPattern.test(error.path),
  );
}

test("generation is deterministic and both runtime copies are identical", async (t) => {
  const outputRoots = [
    mkdtempSync(path.join(tmpdir(), "colorful-syntax-admission-a-")),
    mkdtempSync(path.join(tmpdir(), "colorful-syntax-admission-b-")),
  ];
  t.after(() => {
    for (const outputRoot of outputRoots) {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  const generated = outputRoots.map((outputRoot) => {
    const outputs = generateSyntaxAdmission(outputRoot);
    assert.deepEqual(outputs.sort(), [GRAFT_OUTPUT, INDEPENDENT_OUTPUT].sort());
    const graft = readFileSync(path.join(outputRoot, GRAFT_OUTPUT), "utf8");
    const independent = readFileSync(
      path.join(outputRoot, INDEPENDENT_OUTPUT),
      "utf8",
    );
    assert.equal(graft, independent);
    return graft;
  });
  assert.equal(generated[0], generated[1]);

  const runtime = await import(
    pathToFileURL(path.join(outputRoots[0], GRAFT_OUTPUT)).href
  );
  assert.equal(runtime.CURRENT_SYNTAX_GENERATION, "workspace-v0.4.0");
  assert.deepEqual(runtime.SYNTAX_GENERATION_IDS, [
    "v0.2.1",
    "v0.3.0",
    "workspace-v0.4.0",
  ]);
});

test("syntax envelope rejects unknown and absent identity fields", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-envelope-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href
  );

  const unknown = currentDocument();
  unknown.unexpected = true;
  assert.throws(
    () => runtime.validateSyntaxEnvelope(unknown),
    (error) =>
      error?.path === "unexpected" &&
      error.reasonCode ===
        runtime.SYNTAX_ADMISSION_REASON_CODES.UNKNOWN_FIELD,
  );

  const absent = currentDocument();
  delete absent.schemaHash;
  assert.throws(
    () => runtime.validateSyntaxEnvelope(absent),
    (error) =>
      error?.path === "schemaHash" &&
      error.message ===
        "schemaHash is required by the contract shape",
  );
});

test("every compatibility generation admits its exact released shape", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-generations-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href
  );

  assert.doesNotThrow(() =>
    runtime.validateSyntaxShape(releaseDocument("v0.2.1"), "v0.2.1"),
  );
  assert.doesNotThrow(() =>
    runtime.validateSyntaxShape(releaseDocument("v0.3.0"), "v0.3.0"),
  );
  assert.doesNotThrow(() =>
    runtime.validateSyntaxShape(
      currentDocument(),
      runtime.CURRENT_SYNTAX_GENERATION,
    ),
  );

  const oldWithNewField = structuredClone(releaseDocument("v0.2.1"));
  oldWithNewField.tokens[0].openClassKind = null;
  assertShapeError(
    () => runtime.validateSyntaxShape(oldWithNewField, "v0.2.1"),
    /^tokens\[0\]\.openClassKind$/u,
  );

  const currentWithoutField = currentDocument();
  delete currentWithoutField.tokens[0].openClassKind;
  assertShapeError(
    () =>
      runtime.validateSyntaxShape(
        currentWithoutField,
        runtime.CURRENT_SYNTAX_GENERATION,
      ),
    /^tokens\[0\]\.openClassKind$/u,
  );
});

test("generated admission rejects missing, unknown, primitive, and enum drift", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-shape-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href
  );
  const generation = runtime.CURRENT_SYNTAX_GENERATION;

  const missing = currentDocument();
  delete missing.source;
  assertShapeError(
    () => runtime.validateSyntaxShape(missing, generation),
    /^source$/u,
  );

  const unknown = currentDocument();
  unknown.tokens[0].surprise = true;
  assertShapeError(
    () => runtime.validateSyntaxShape(unknown, generation),
    /^tokens\[0\]\.surprise$/u,
  );

  const primitive = currentDocument();
  primitive.source.utf8ByteLength = 1.5;
  assertShapeError(
    () => runtime.validateSyntaxShape(primitive, generation),
    /^source\.utf8ByteLength$/u,
  );

  const wireOverflow = currentDocument();
  wireOverflow.tokens[0].occurrenceId = 2 ** 40;
  assertShapeError(
    () => runtime.validateSyntaxShape(wireOverflow, generation),
    /^tokens\[0\]\.occurrenceId$/u,
  );

  const enumDrift = currentDocument();
  enumDrift.tokens[0].tokenKind = "BOGUS";
  assertShapeError(
    () => runtime.validateSyntaxShape(enumDrift, generation),
    /^tokens\[0\]\.tokenKind$/u,
  );
});

test("generated rejection exposes stable machine and display metadata", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-rejection-metadata-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href
  );

  const document = currentDocument();
  document.unexpected = true;
  assert.throws(
    () =>
      runtime.validateSyntaxShape(
        document,
        runtime.CURRENT_SYNTAX_GENERATION,
      ),
    (error) =>
      error?.name === "SyntaxAdmissionError" &&
      error.code === "E_SYNTAX_SHAPE" &&
      error.reasonCode ===
        runtime.SYNTAX_ADMISSION_REASON_CODES.UNKNOWN_FIELD &&
      error.location === "unexpected",
  );

  let callbackError;
  assert.throws(
    () =>
      runtime.validateSyntaxShape(
        document,
        runtime.CURRENT_SYNTAX_GENERATION,
        (_path, _reason, error) => {
          callbackError = error;
          throw error;
        },
      ),
    (error) => error === callbackError,
  );
  assert.equal(callbackError.reasonCode, "UNKNOWN_FIELD");
  assert.equal(callbackError.location, "unexpected");
});

test("prototype properties cannot impersonate syntax generation ids", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-generation-id-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href
  );

  for (const operation of [
    () => runtime.validateSyntaxShape(currentDocument(), "toString"),
    () => runtime.syntaxGenerationHasField("toString", "Token", "tokenKind"),
  ]) {
    assert.throws(
      operation,
      (error) =>
        error?.name === "SyntaxAdmissionError" &&
        error.code === "E_SYNTAX_SHAPE" &&
        error.path === "" &&
        /unknown syntax generation toString/u.test(error.message),
    );
  }
});

test("generation field lookup preserves the caller error taxonomy", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-field-lookup-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href
  );
  const sentinel = new Error("consumer taxonomy");

  assert.throws(
    () =>
      runtime.syntaxGenerationHasField(
        "missing-generation",
        "Token",
        "tokenKind",
        () => {
          throw sentinel;
        },
      ),
    (error) => error === sentinel,
  );
});

test("a schema edit changes generated required-field and enum behavior", async () => {
  const currentSchema = readFileSync(
    path.join(ROOT, "contracts/colorful/syntax.v1.graphql"),
    "utf8",
  );
  const changedSchema = currentSchema
    .replace(
      "  QUOTE\n}",
      "  QUOTE\n  SYMBOL\n}",
    )
    .replace(
      "  derivation: [DerivationStep!]!\n}",
      "  derivation: [DerivationStep!]!\n  evidence: String!\n}",
    );
  assert.notEqual(changedSchema, currentSchema);
  const runtime = await importSource(
    renderSyntaxAdmission({
      currentGenerationId: "changed",
      generations: [{ id: "changed", sdl: changedSchema }],
    }),
  );

  const missingRequired = currentDocument();
  missingRequired.tokens[0].tokenKind = "SYMBOL";
  assert.throws(
    () => runtime.validateSyntaxShape(missingRequired, "changed"),
    (error) =>
      error?.name === "SyntaxAdmissionError" &&
      error.path === "evidence" &&
      error.message ===
        "evidence is required by the contract shape",
  );

  const changed = { ...missingRequired, evidence: "generated once" };
  assert.doesNotThrow(() =>
    runtime.validateSyntaxShape(changed, "changed"),
  );
});

test("generation fails closed on unsupported or dangling SDL", () => {
  assert.throws(
    () =>
      renderSyntaxAdmission({
        currentGenerationId: "unsupported",
        generations: [
          {
            id: "unsupported",
            sdl: "scalar Surprise\n",
          },
        ],
      }),
    /unsupported top-level GraphQL syntax/u,
  );
  assert.throws(
    () =>
      renderSyntaxAdmission({
        currentGenerationId: "dangling",
        generations: [
          {
            id: "dangling",
            sdl:
              "type DocumentAnalysis {\n" +
              "  contractVersion: String!\n" +
              "  schemaHash: String!\n" +
              "  vocabularyHash: String!\n" +
              "  missing: Missing!\n" +
              "}\n",
          },
        ],
      }),
    /refers to missing type Missing/u,
  );
});

test("generation fails closed when envelope fields drift from String", () => {
  const currentSchema = readFileSync(
    path.join(ROOT, "contracts/colorful/syntax.v1.graphql"),
    "utf8",
  );
  for (const [label, changedSchema] of [
    [
      "missing",
      currentSchema.replace(
        "  contractVersion: String!\n",
        "  contractRevision: String!\n",
      ),
    ],
    [
      "retyped",
      currentSchema.replace(
        "  schemaHash: String!\n",
        "  schemaHash: Int!\n",
      ),
    ],
  ]) {
    assert.notEqual(changedSchema, currentSchema, label);
    assert.throws(
      () =>
        renderSyntaxAdmission({
          currentGenerationId: label,
          generations: [{ id: label, sdl: changedSchema }],
        }),
      /DocumentAnalysis\.(?:contractVersion|schemaHash) as String!/u,
      label,
    );
  }
});

test("generation rejects malformed compatibility manifests uniformly", () => {
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        "contracts/colorful/syntax-compatibility.v1.json",
      ),
      "utf8",
    ),
  );
  const malformed = [
    null,
    {},
    { ...manifest, currentIdentity: null },
    { ...manifest, generations: {} },
    {
      ...manifest,
      generations: [
        { ...manifest.generations[0], identity: null },
      ],
    },
    {
      ...manifest,
      generations: [
        { ...manifest.generations[0], artifacts: null },
      ],
    },
  ];
  for (const [index, candidate] of malformed.entries()) {
    assert.throws(
      () =>
        syntaxAdmissionInputsFromCompatibility(
          candidate,
          () => "type DocumentAnalysis {}",
        ),
      /^Error: generate-syntax-admission:/u,
      `malformed manifest ${index}`,
    );
  }
  const current = manifest.generations.at(-1);
  assert.throws(
    () =>
      syntaxAdmissionInputsFromCompatibility(
        {
          ...manifest,
          generations: [
            ...manifest.generations,
            { ...current, id: "duplicate-current-identity" },
          ],
        },
        () => "type DocumentAnalysis {}",
    ),
    /duplicates identity tuple/u,
  );
  assert.throws(
    () =>
      syntaxAdmissionInputsFromCompatibility(
        {
          ...manifest,
          generations: [
            ...manifest.generations,
            {
              ...current,
              identity: {
                ...current.identity,
                schemaHash: "sha256:distinct",
              },
            },
          ],
        },
        () => "type DocumentAnalysis {}",
      ),
    /duplicates generation id/u,
  );

  const inputs = syntaxAdmissionInputsFromCompatibility(
    manifest,
    (schemaPath) => readFileSync(path.join(ROOT, schemaPath), "utf8"),
  );
  assert.equal(inputs.currentGenerationId, "workspace-v0.4.0");
  assert.deepEqual(
    inputs.generations.map(({ id }) => id),
    ["v0.2.1", "v0.3.0", "workspace-v0.4.0"],
  );
});

test("schema references compile once instead of once per admitted value", () => {
  const source = renderSyntaxAdmission({
    currentGenerationId: "current",
    generations: [
      {
        id: "current",
        sdl: readFileSync(
          path.join(ROOT, "contracts/colorful/syntax.v1.graphql"),
          "utf8",
        ),
      },
    ],
  });
  assert.match(source, /function prepareSchemas\(\)/u);
  assert.match(source, /prepareSchemas\(\);/u);
  assert.doesNotMatch(
    source,
    /const allowed = new Set\(definition\.fields/u,
  );
});

test("consumers do not retain handwritten structural field or enum tables", () => {
  for (const relativePath of [
    "consumers/graft-projection.mjs",
    "consumers/independent-ir-report/src/ir.mjs",
  ]) {
    const source = readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /\b(?:DOCUMENT|SOURCE|RANGE|BYTE_RANGE|TOKEN|STRUCTURE|OUTLINE_NODE|DIAGNOSTIC|DERIVATION(?:_STEP)?)_FIELDS\b/u,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /\b(?:TOKEN_KINDS|LEXICAL_CLASSES|FUNCTION_KINDS|OPEN_CLASS_KINDS|OUTLINE_KINDS|DIAGNOSTIC_SEVERITIES)\b/u,
      relativePath,
    );
  }
});

reviewedCases.assertComplete();
