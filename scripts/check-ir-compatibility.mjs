#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifySyntaxTransition,
  descriptionlessGraphqlLines,
  SchemaPolicyError,
} from "./ir-schema-policy.mjs";

const MANIFEST_VERSION = "colorful.syntax-compatibility/v1";
const CONTRACT_FAMILY = "colorful.syntax/v1";
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const RELEASE_GENERATION_PATTERN =
  /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const OPTIONAL_FIELD_PATTERN =
  /^[_A-Za-z][_0-9A-Za-z]*(?:\[\])?(?:\.[_A-Za-z][_0-9A-Za-z]*(?:\[\])?)*$/u;
const SCHEMA_HASH_MODES = new Set([
  "raw-sdl-sha256",
  "descriptions-stripped-sdl-sha256",
]);
const COMPATIBILITY_DECISIONS = new Set([
  "origin",
  "adapter-required",
  "identity-only",
]);
const EXPLICIT_GENERATION_CHANGES = new Set([
  "nullable-field",
  "vocabulary",
  "schema-hash-algorithm",
]);
const MIGRATION_ORACLES = new Map([
  [
    "consumers/independent-ir-report/test/consumer.test.mjs",
    "bash scripts/check-independent-consumer.sh",
  ],
  [
    "consumers/graft-projection.test.mjs",
    "node consumers/graft-projection.test.mjs",
  ],
  [
    "crates/colorful-ir/src/lib.rs",
    "cargo test --all --locked",
  ],
  [
    "scripts/ir-witness.sh",
    "bash scripts/ir-witness.sh",
  ],
  [
    "scripts/version-compat-matrix.sh",
    "bash scripts/version-compat-matrix.sh",
  ],
]);
const POLICY = Object.freeze({
  "description-only": "preserve-generation",
  "nullable-field": "explicit-generation",
  vocabulary: "explicit-generation",
  "schema-hash-algorithm": "explicit-generation",
  "required-field": "new-contract-version",
  "field-removal": "new-contract-version",
  "field-reinterpretation": "new-contract-version",
  "enum-change": "new-contract-version",
});
const MANIFEST_FIELDS = [
  "contractFamily",
  "currentIdentity",
  "generations",
  "policy",
  "version",
];
const GENERATION_FIELDS = [
  "artifacts",
  "changeKinds",
  "compatibilityDecision",
  "id",
  "identity",
  "migrationEvidence",
  "predecessor",
  "schemaHashMode",
  "sourceCommit",
  "wireShape",
];
const IDENTITY_FIELDS = [
  "contractVersion",
  "schemaHash",
  "vocabularyHash",
];

export class IrCompatibilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IrCompatibilityError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new IrCompatibilityError(code, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactFields(record, expected, code, context) {
  if (!isRecord(record)) {
    fail(code, `${context} must be an object`);
  }
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((field, index) => field !== wanted[index])
  ) {
    fail(
      code,
      `${context} fields must be exactly ${wanted.join(", ")}`,
    );
  }
}

function assertNonEmptyString(value, code, context) {
  if (typeof value !== "string" || value.length === 0) {
    fail(code, `${context} must be a non-empty string`);
  }
}

function validateIdentity(value, context) {
  assertExactFields(
    value,
    IDENTITY_FIELDS,
    "E_MANIFEST_SHAPE",
    context,
  );
  assertNonEmptyString(
    value.contractVersion,
    "E_MANIFEST_SHAPE",
    `${context}.contractVersion`,
  );
  for (const field of ["schemaHash", "vocabularyHash"]) {
    if (
      typeof value[field] !== "string" ||
      !HASH_PATTERN.test(value[field])
    ) {
      fail(
        "E_MANIFEST_SHAPE",
        `${context}.${field} must be a lowercase sha256 identity`,
      );
    }
  }
}

function identityKey(identity) {
  return [
    identity.contractVersion,
    identity.schemaHash,
    identity.vocabularyHash,
  ].join("\u0000");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stripGraphqlDescriptions(sdl) {
  return descriptionlessGraphqlLines(sdl)
    .filter((line) => line !== null)
    .join("\n");
}

function schemaHash(sdl, mode) {
  if (mode === "raw-sdl-sha256") {
    return sha256(sdl);
  }
  if (mode === "descriptions-stripped-sdl-sha256") {
    return sha256(stripGraphqlDescriptions(sdl));
  }
  fail("E_MANIFEST_SHAPE", `unsupported schema hash mode ${mode}`);
}

export function classifySchemaTransition(predecessorSdl, currentSdl) {
  try {
    return classifySyntaxTransition(predecessorSdl, currentSdl);
  } catch (error) {
    if (error instanceof SchemaPolicyError) {
      fail("E_SCHEMA_POLICY", error.message);
    }
    throw error;
  }
}

function readRepositoryFile(repositoryRoot, relativePath, code, context) {
  assertNonEmptyString(relativePath, code, context);
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  const relativeToRoot = path.relative(repositoryRoot, absolutePath);
  if (
    relativeToRoot === "" ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    fail(code, `${context} must remain inside the repository`);
  }
  try {
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      fail(code, `${context} does not name an existing file: ${relativePath}`);
    }
    return readFileSync(absolutePath);
  } catch (error) {
    if (error instanceof IrCompatibilityError) throw error;
    fail(code, `${context} could not be read: ${relativePath}`);
  }
}

function validatePolicy(policy) {
  assertExactFields(policy, Object.keys(POLICY), "E_POLICY", "policy");
  for (const [change, decision] of Object.entries(POLICY)) {
    if (policy[change] !== decision) {
      fail(
        "E_POLICY",
        `policy for ${change} must be ${decision}`,
      );
    }
  }
}

function validateGenerationShape(generation, index) {
  const context = `generations[${index}]`;
  assertExactFields(
    generation,
    GENERATION_FIELDS,
    "E_MANIFEST_SHAPE",
    context,
  );
  assertNonEmptyString(
    generation.id,
    "E_MANIFEST_SHAPE",
    `${context}.id`,
  );
  if (generation.id.startsWith("workspace-")) {
    if (generation.sourceCommit !== null) {
      fail(
        "E_RELEASE_PROVENANCE",
        `${context} workspace generation must not claim a release commit`,
      );
    }
  } else if (
    !RELEASE_GENERATION_PATTERN.test(generation.id) ||
    typeof generation.sourceCommit !== "string" ||
    !COMMIT_PATTERN.test(generation.sourceCommit)
  ) {
    fail(
      "E_RELEASE_PROVENANCE",
      `${context} released generation must name its tag and full source commit`,
    );
  }
  validateIdentity(generation.identity, `${context}.identity`);
  if (generation.identity.contractVersion !== CONTRACT_FAMILY) {
    fail(
      "E_MANIFEST_SHAPE",
      `${context} belongs to ${generation.identity.contractVersion}, not ${CONTRACT_FAMILY}`,
    );
  }
  if (!SCHEMA_HASH_MODES.has(generation.schemaHashMode)) {
    fail(
      "E_MANIFEST_SHAPE",
      `${context}.schemaHashMode is unsupported`,
    );
  }
  if (
    !(
      generation.predecessor === null ||
      (typeof generation.predecessor === "string" &&
        generation.predecessor.length > 0)
    )
  ) {
    fail(
      "E_PREDECESSOR",
      `${context}.predecessor must be null or a generation id`,
    );
  }
  if (!COMPATIBILITY_DECISIONS.has(generation.compatibilityDecision)) {
    fail(
      "E_DECISION",
      `${context}.compatibilityDecision is unsupported`,
    );
  }
  if (
    !Array.isArray(generation.changeKinds) ||
    new Set(generation.changeKinds).size !== generation.changeKinds.length ||
    generation.changeKinds.some(
      (change) => !EXPLICIT_GENERATION_CHANGES.has(change),
    )
  ) {
    fail(
      "E_DECISION",
      `${context}.changeKinds must contain unique explicit-generation changes`,
    );
  }
  assertExactFields(
    generation.wireShape,
    ["optionalFields"],
    "E_MANIFEST_SHAPE",
    `${context}.wireShape`,
  );
  if (
    !Array.isArray(generation.wireShape.optionalFields) ||
    new Set(generation.wireShape.optionalFields).size !==
      generation.wireShape.optionalFields.length ||
    generation.wireShape.optionalFields.some(
      (field) =>
        typeof field !== "string" || !OPTIONAL_FIELD_PATTERN.test(field),
    ) ||
    generation.wireShape.optionalFields.some(
      (field, fieldIndex, fields) =>
        fieldIndex > 0 && fields[fieldIndex - 1] >= field,
    )
  ) {
    fail(
      "E_MANIFEST_SHAPE",
      `${context}.wireShape.optionalFields must be sorted unique field paths`,
    );
  }
  assertExactFields(
    generation.artifacts,
    ["schema", "vocabulary"],
    "E_MANIFEST_SHAPE",
    `${context}.artifacts`,
  );
  if (
    !Array.isArray(generation.migrationEvidence) ||
    generation.migrationEvidence.length === 0 ||
    new Set(generation.migrationEvidence).size !==
      generation.migrationEvidence.length ||
    generation.migrationEvidence.some(
      (evidence) => typeof evidence !== "string" || evidence.length === 0,
    )
  ) {
    fail(
      "E_EVIDENCE",
      `${context}.migrationEvidence must contain unique repository paths`,
    );
  }
}

function validateDecision(generation, index) {
  const context = `generations[${index}]`;
  if (generation.predecessor === null) {
    if (
      generation.compatibilityDecision !== "origin" ||
      generation.changeKinds.length !== 0
    ) {
      fail(
        "E_DECISION",
        `${context} root must use origin with no change kinds`,
      );
    }
    if (generation.wireShape.optionalFields.length !== 0) {
      fail(
        "E_TRANSITION",
        `${context} root must start with an empty optional-field wire shape`,
      );
    }
    return;
  }
  if (generation.compatibilityDecision === "origin") {
    fail("E_DECISION", `${context} non-root cannot use origin`);
  }
  if (generation.changeKinds.length === 0) {
    fail("E_DECISION", `${context} transition must name its changes`);
  }
  if (
    generation.compatibilityDecision === "identity-only" &&
    (generation.changeKinds.length !== 1 ||
      generation.changeKinds[0] !== "schema-hash-algorithm")
  ) {
    fail(
      "E_DECISION",
      `${context} identity-only is reserved for a schema hash algorithm change`,
    );
  }
  if (
    generation.compatibilityDecision === "adapter-required" &&
    !generation.changeKinds.some(
      (change) => change === "nullable-field" || change === "vocabulary",
    )
  ) {
    fail(
      "E_DECISION",
      `${context} adapter-required must name a wire or vocabulary change`,
    );
  }
}

function validateGenerationFiles(generation, index, repositoryRoot) {
  const context = `generations[${index}]`;
  const schemaBytes = readRepositoryFile(
    repositoryRoot,
    generation.artifacts.schema,
    "E_EVIDENCE",
    `${context}.artifacts.schema`,
  );
  const vocabularyBytes = readRepositoryFile(
    repositoryRoot,
    generation.artifacts.vocabulary,
    "E_EVIDENCE",
    `${context}.artifacts.vocabulary`,
  );
  const schemaSdl = schemaBytes.toString("utf8");
  const actualSchemaHash = schemaHash(schemaSdl, generation.schemaHashMode);
  if (actualSchemaHash !== generation.identity.schemaHash) {
    fail(
      "E_ARTIFACT_HASH",
      `${context} schema artifact hashes to ${actualSchemaHash}`,
    );
  }
  const actualVocabularyHash = sha256(vocabularyBytes);
  if (actualVocabularyHash !== generation.identity.vocabularyHash) {
    fail(
      "E_ARTIFACT_HASH",
      `${context} vocabulary artifact hashes to ${actualVocabularyHash}`,
    );
  }
  const ciWorkflow = readRepositoryFile(
    repositoryRoot,
    ".github/workflows/ci.yml",
    "E_EVIDENCE",
    "CI migration-evidence workflow",
  ).toString("utf8");
  const releasePrep = readRepositoryFile(
    repositoryRoot,
    "scripts/release-prep.sh",
    "E_EVIDENCE",
    "release-prep migration-evidence gate",
  ).toString("utf8");
  for (const [evidenceIndex, evidence] of
    generation.migrationEvidence.entries()) {
    const invocation = MIGRATION_ORACLES.get(evidence);
    if (invocation === undefined) {
      fail(
        "E_EVIDENCE",
        `${context}.migrationEvidence[${evidenceIndex}] is not a reviewed executable oracle`,
      );
    }
    readRepositoryFile(
      repositoryRoot,
      evidence,
      "E_EVIDENCE",
      `${context}.migrationEvidence[${evidenceIndex}]`,
    );
    if (
      !ciWorkflow.includes(invocation) ||
      !releasePrep.includes(invocation)
    ) {
      fail(
        "E_EVIDENCE",
        `${context}.migrationEvidence[${evidenceIndex}] is not invoked by CI and release preparation`,
      );
    }
  }
  return { schemaBytes, schemaSdl, vocabularyBytes };
}

function gitBytes(repositoryRoot, args, context) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    fail("E_RELEASE_PROVENANCE", `${context} is unavailable from Git history`);
  }
}

function validateReleasedGenerationProvenance(
  generation,
  artifacts,
  index,
  repositoryRoot,
) {
  if (generation.sourceCommit === null) return;
  const context = `generations[${index}]`;
  const tagCommit = gitBytes(
    repositoryRoot,
    [
      "rev-parse",
      "--verify",
      `refs/tags/${generation.id}^{commit}`,
    ],
    `${context} tag ${generation.id}`,
  ).toString("utf8").trim();
  if (tagCommit !== generation.sourceCommit) {
    fail(
      "E_RELEASE_PROVENANCE",
      `${context} sourceCommit does not match tag ${generation.id}`,
    );
  }
  const historicalArtifacts = [
    [
      "schema",
      "contracts/colorful/syntax.v1.graphql",
      artifacts.schemaBytes,
    ],
    [
      "vocabulary",
      "contracts/colorful/vocabulary.v1.json",
      artifacts.vocabularyBytes,
    ],
  ];
  for (const [label, historicalPath, fixtureBytes] of historicalArtifacts) {
    const historicalBytes = gitBytes(
      repositoryRoot,
      ["show", `${generation.sourceCommit}:${historicalPath}`],
      `${context} historical ${label}`,
    );
    if (!fixtureBytes.equals(historicalBytes)) {
      fail(
        "E_RELEASE_PROVENANCE",
        `${context} ${label} artifact differs from tag ${generation.id}`,
      );
    }
  }
}

function validateAcyclic(generationsById) {
  const finished = new Set();
  for (const start of generationsById.keys()) {
    if (finished.has(start)) continue;
    const active = new Set();
    let current = start;
    while (current !== null && !finished.has(current)) {
      if (active.has(current)) {
        fail("E_CYCLE", `compatibility predecessor cycle reaches ${current}`);
      }
      active.add(current);
      current = generationsById.get(current).predecessor;
    }
    for (const id of active) finished.add(id);
  }
}

function validateTransition(
  generation,
  predecessor,
  generationSchema,
  predecessorSchema,
  index,
) {
  const context = `generations[${index}]`;
  const changes = new Set(generation.changeKinds);
  const addedOptionalFields = classifySchemaTransition(
    predecessorSchema,
    generationSchema,
  );
  const expectedOptionalFields = [
    ...new Set([
      ...predecessor.wireShape.optionalFields,
      ...addedOptionalFields,
    ]),
  ].sort();
  if (
    generation.wireShape.optionalFields.length !==
      expectedOptionalFields.length ||
    generation.wireShape.optionalFields.some(
      (field, fieldIndex) => field !== expectedOptionalFields[fieldIndex],
    )
  ) {
    fail(
      "E_TRANSITION",
      `${context} wireShape.optionalFields must match the additive SDL delta`,
    );
  }
  const checks = [
    [
      "nullable-field",
      addedOptionalFields.length > 0,
      "wireShape.optionalFields",
    ],
    [
      "vocabulary",
      generation.identity.vocabularyHash !==
        predecessor.identity.vocabularyHash,
      "vocabularyHash",
    ],
    [
      "schema-hash-algorithm",
      generation.schemaHashMode !== predecessor.schemaHashMode,
      "schemaHashMode",
    ],
  ];
  for (const [change, actual, field] of checks) {
    if (changes.has(change) !== actual) {
      fail(
        "E_TRANSITION",
        `${context} ${field} delta must agree with change kind ${change}`,
      );
    }
  }

  const schemaIdentityChanged =
    generation.identity.schemaHash !== predecessor.identity.schemaHash;
  const declaredSchemaChange =
    addedOptionalFields.length > 0 ||
    changes.has("schema-hash-algorithm");
  if (schemaIdentityChanged !== declaredSchemaChange) {
    fail(
      "E_TRANSITION",
      `${context} schemaHash delta must be explained by a nullable field or hash algorithm change`,
    );
  }
}

export function validateCompatibilityManifest(
  manifest,
  { currentIdentity, repositoryRoot },
) {
  assertExactFields(
    manifest,
    MANIFEST_FIELDS,
    "E_MANIFEST_SHAPE",
    "manifest",
  );
  if (
    manifest.version !== MANIFEST_VERSION ||
    manifest.contractFamily !== CONTRACT_FAMILY
  ) {
    fail(
      "E_MANIFEST_SHAPE",
      `manifest must describe ${MANIFEST_VERSION} for ${CONTRACT_FAMILY}`,
    );
  }
  validatePolicy(manifest.policy);
  validateIdentity(manifest.currentIdentity, "currentIdentity");
  validateIdentity(currentIdentity, "workspaceIdentity");
  if (
    typeof repositoryRoot !== "string" ||
    !path.isAbsolute(repositoryRoot)
  ) {
    fail("E_MANIFEST_SHAPE", "repositoryRoot must be absolute");
  }
  if (
    !Array.isArray(manifest.generations) ||
    manifest.generations.length === 0
  ) {
    fail("E_MANIFEST_SHAPE", "generations must be a non-empty array");
  }

  const generationsById = new Map();
  const generationsByIdentity = new Map();
  const generationArtifacts = new Map();
  let roots = 0;
  for (const [index, generation] of manifest.generations.entries()) {
    validateGenerationShape(generation, index);
    validateDecision(generation, index);
    if (generationsById.has(generation.id)) {
      fail(
        "E_DUPLICATE_GENERATION",
        `duplicate generation id ${generation.id}`,
      );
    }
    const key = identityKey(generation.identity);
    if (generationsByIdentity.has(key)) {
      fail(
        "E_DUPLICATE_IDENTITY",
        `identity tuple is shared by ${generationsByIdentity.get(key)} and ${generation.id}`,
      );
    }
    generationsById.set(generation.id, generation);
    generationsByIdentity.set(key, generation.id);
    if (generation.predecessor === null) roots += 1;
    generationArtifacts.set(
      generation.id,
      validateGenerationFiles(generation, index, repositoryRoot),
    );
  }
  for (const generation of manifest.generations) {
    if (
      generation.predecessor !== null &&
      !generationsById.has(generation.predecessor)
    ) {
      fail(
        "E_PREDECESSOR",
        `${generation.id} names missing predecessor ${generation.predecessor}`,
      );
    }
  }
  validateAcyclic(generationsById);
  if (roots !== 1) {
    fail(
      "E_PREDECESSOR",
      `compatibility family must have one root, found ${roots}`,
    );
  }
  for (const [index, generation] of manifest.generations.entries()) {
    if (generation.predecessor !== null) {
      validateTransition(
        generation,
        generationsById.get(generation.predecessor),
        generationArtifacts.get(generation.id).schemaSdl,
        generationArtifacts.get(generation.predecessor).schemaSdl,
        index,
      );
    }
  }
  for (const [index, generation] of manifest.generations.entries()) {
    validateReleasedGenerationProvenance(
      generation,
      generationArtifacts.get(generation.id),
      index,
      repositoryRoot,
    );
  }

  const declaredCurrentKey = identityKey(manifest.currentIdentity);
  if (
    !generationsByIdentity.has(declaredCurrentKey) ||
    declaredCurrentKey !== identityKey(currentIdentity)
  ) {
    fail(
      "E_CURRENT_IDENTITY",
      "manifest currentIdentity must name the current workspace generation",
    );
  }
  return manifest;
}

export function selectCompatibilityGeneration(manifest, identity) {
  validateIdentity(identity, "identity");
  const key = identityKey(identity);
  const matches = manifest.generations.filter(
    (generation) => identityKey(generation.identity) === key,
  );
  if (matches.length !== 1) {
    fail(
      "E_UNSUPPORTED_IDENTITY",
      `unsupported compatibility identity ${identity.contractVersion} ${identity.schemaHash} ${identity.vocabularyHash}`,
    );
  }
  return matches[0];
}

export function validateCompatibilityCopies(canonicalText, copies) {
  for (const copy of copies) {
    if (
      !isRecord(copy) ||
      typeof copy.label !== "string" ||
      typeof copy.text !== "string" ||
      copy.text !== canonicalText
    ) {
      const label =
        isRecord(copy) && typeof copy.label === "string"
          ? copy.label
          : "compatibility copy";
      fail("E_COPY_DRIFT", `${label} differs from the canonical manifest`);
    }
  }
}

export function loadCompatibilityCopies(repositoryRoot, copyPaths) {
  return copyPaths.map((copyPath) => ({
    label: copyPath,
    text: readRepositoryFile(
      repositoryRoot,
      copyPath,
      "E_COPY_DRIFT",
      copyPath,
    ).toString("utf8"),
  }));
}

export function workspaceIdentity(repositoryRoot) {
  const syntax = readRepositoryFile(
    repositoryRoot,
    "contracts/colorful/syntax.v1.graphql",
    "E_CURRENT_IDENTITY",
    "workspace syntax artifact",
  ).toString("utf8");
  const vocabulary = readRepositoryFile(
    repositoryRoot,
    "contracts/colorful/vocabulary.v1.json",
    "E_CURRENT_IDENTITY",
    "workspace vocabulary artifact",
  );
  return {
    contractVersion: CONTRACT_FAMILY,
    schemaHash: schemaHash(syntax, "descriptions-stripped-sdl-sha256"),
    vocabularyHash: sha256(vocabulary),
  };
}

function run() {
  const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const canonicalText = readRepositoryFile(
    repositoryRoot,
    "contracts/colorful/syntax-compatibility.v1.json",
    "E_MANIFEST_SHAPE",
    "canonical compatibility manifest",
  ).toString("utf8");
  let manifest;
  try {
    manifest = JSON.parse(canonicalText);
  } catch {
    fail("E_MANIFEST_SHAPE", "canonical compatibility manifest is not valid JSON");
  }
  validateCompatibilityManifest(manifest, {
    currentIdentity: workspaceIdentity(repositoryRoot),
    repositoryRoot,
  });

  const copyPaths = [
    "crates/colorful-ir/contracts/syntax-compatibility.v1.json",
    "consumers/independent-ir-report/compatibility.v1.json",
  ];
  const copies = loadCompatibilityCopies(repositoryRoot, copyPaths);
  validateCompatibilityCopies(canonicalText, copies);
  process.stdout.write(
    `IR compatibility passed: ${manifest.generations.length} explicit ${manifest.contractFamily} generations\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    run();
  } catch (error) {
    if (error instanceof IrCompatibilityError) {
      process.stderr.write(
        `check-ir-compatibility failed [${error.code}]: ${error.message}\n`,
      );
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
