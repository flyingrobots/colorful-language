#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateSyntaxAdmission,
  renderSyntaxAdmission,
} from "./generate-syntax-admission.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GRAFT_OUTPUT = "consumers/generated/syntax-admission-v1.mjs";
const INDEPENDENT_OUTPUT =
  "consumers/independent-ir-report/generated/syntax-admission-v1.mjs";

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
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-admission-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));

  const outputs = generateSyntaxAdmission(outputRoot);
  assert.deepEqual(outputs.sort(), [GRAFT_OUTPUT, INDEPENDENT_OUTPUT].sort());
  const graft = readFileSync(path.join(outputRoot, GRAFT_OUTPUT), "utf8");
  const independent = readFileSync(
    path.join(outputRoot, INDEPENDENT_OUTPUT),
    "utf8",
  );
  assert.equal(graft, independent);

  const runtime = await import(
    `${pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href}?test=${Date.now()}`
  );
  assert.equal(runtime.CURRENT_SYNTAX_GENERATION, "workspace-v0.4.0");
  assert.deepEqual(runtime.SYNTAX_GENERATION_IDS, [
    "v0.2.1",
    "v0.3.0",
    "workspace-v0.4.0",
  ]);
});

test("every compatibility generation admits its exact released shape", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-generations-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    `${pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href}?test=${Date.now()}`
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
    `${pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href}?test=${Date.now()}`
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

test("prototype properties cannot impersonate syntax generation ids", async (t) => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), "colorful-syntax-generation-id-"),
  );
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  generateSyntaxAdmission(outputRoot);
  const runtime = await import(
    `${pathToFileURL(path.join(outputRoot, GRAFT_OUTPUT)).href}?test=${Date.now()}`
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
  assertShapeError(
    () => runtime.validateSyntaxShape(missingRequired, "changed"),
    /^evidence$/u,
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
            sdl: "type DocumentAnalysis {\n  missing: Missing!\n}\n",
          },
        ],
      }),
    /refers to missing type Missing/u,
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
