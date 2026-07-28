import {
  fail,
  isRecord,
  normalizeSpans,
  parseJson,
  renderReport,
  sha256,
  utf8Boundaries,
} from "./common.mjs";
import { roleForAxes } from "./profile.mjs";

export const IR_ERROR_CODES = Object.freeze([
  "E_JSON",
  "E_SHAPE",
  "E_CONTRACT_VERSION",
  "E_SCHEMA_HASH",
  "E_VOCABULARY_HASH",
  "E_SOURCE_LENGTH",
  "E_SOURCE_HASH",
  "E_RANGE",
  "E_AXES",
]);

function requireRecord(value, label) {
  if (!isRecord(value)) fail("E_SHAPE", `${label} must be an object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail("E_SHAPE", `${label} must be an array`);
  return value;
}

function requireString(record, field, label) {
  if (typeof record[field] !== "string") {
    fail("E_SHAPE", `${label}.${field} must be a string`);
  }
  return record[field];
}

function requireInteger(record, field, label) {
  if (!Number.isSafeInteger(record[field])) {
    fail("E_SHAPE", `${label}.${field} must be a safe integer`);
  }
  return record[field];
}

function requireNullableString(record, field, label) {
  if (!(record[field] === null || typeof record[field] === "string")) {
    fail("E_SHAPE", `${label}.${field} must be a string or null`);
  }
  return record[field];
}

function requireRange(value, label, sourceLength, boundaries) {
  const range = requireRecord(value, label);
  const startUtf8 = requireInteger(range, "startUtf8", label);
  const endUtf8 = requireInteger(range, "endUtf8", label);
  if (
    startUtf8 < 0 ||
    startUtf8 > endUtf8 ||
    endUtf8 > sourceLength ||
    !boundaries.has(startUtf8) ||
    !boundaries.has(endUtf8)
  ) {
    fail("E_RANGE", `${label} is not a legal UTF-8 source range`);
  }
  return { startUtf8, endUtf8 };
}

function selectProfile(document, profiles) {
  // effort:migration:start
  if (typeof document.contractVersion !== "string") {
    fail("E_SHAPE", "contractVersion must be a string");
  }
  const contractProfiles = profiles.filter(
    (profile) => profile.contractVersion === document.contractVersion,
  );
  if (contractProfiles.length === 0) {
    fail(
      "E_CONTRACT_VERSION",
      `unsupported contract version ${document.contractVersion}`,
    );
  }
  if (typeof document.schemaHash !== "string") {
    fail("E_SHAPE", "schemaHash must be a string");
  }
  const schemaProfiles = contractProfiles.filter(
    (profile) => profile.schemaHash === document.schemaHash,
  );
  if (schemaProfiles.length === 0) {
    fail("E_SCHEMA_HASH", `unsupported schema hash ${document.schemaHash}`);
  }
  if (typeof document.vocabularyHash !== "string") {
    fail("E_SHAPE", "vocabularyHash must be a string");
  }
  const profile = schemaProfiles.find(
    (candidate) => candidate.vocabularyHash === document.vocabularyHash,
  );
  if (!profile) {
    fail(
      "E_VOCABULARY_HASH",
      `unsupported vocabulary hash ${document.vocabularyHash}`,
    );
  }
  return profile;
  // effort:migration:end
}

function validateAuxiliaryShape(document, sourceLength, boundaries) {
  for (const [index, nodeValue] of requireArray(
    document.structure,
    "structure",
  ).entries()) {
    const label = `structure[${index}]`;
    const node = requireRecord(nodeValue, label);
    requireInteger(node, "nodeId", label);
    requireString(node, "kind", label);
    requireInteger(node, "depth", label);
    requireRange(node.byteRange, `${label}.byteRange`, sourceLength, boundaries);
    for (const [childIndex, child] of requireArray(
      node.childNodeIds,
      `${label}.childNodeIds`,
    ).entries()) {
      if (!Number.isSafeInteger(child)) {
        fail(
          "E_SHAPE",
          `${label}.childNodeIds[${childIndex}] must be a safe integer`,
        );
      }
    }
  }

  for (const [index, diagnosticValue] of requireArray(
    document.diagnostics,
    "diagnostics",
  ).entries()) {
    const label = `diagnostics[${index}]`;
    const diagnostic = requireRecord(diagnosticValue, label);
    requireRange(
      diagnostic.byteRange,
      `${label}.byteRange`,
      sourceLength,
      boundaries,
    );
    requireString(diagnostic, "severity", label);
    requireString(diagnostic, "code", label);
    requireString(diagnostic, "message", label);
  }

  for (const [index, stepValue] of requireArray(
    document.derivation,
    "derivation",
  ).entries()) {
    const label = `derivation[${index}]`;
    const step = requireRecord(stepValue, label);
    requireString(step, "passId", label);
    requireString(step, "ruleId", label);
    requireString(step, "compilerBuildHash", label);
    for (const [rangeIndex, range] of requireArray(
      step.sourceRanges,
      `${label}.sourceRanges`,
    ).entries()) {
      requireRange(
        range,
        `${label}.sourceRanges[${rangeIndex}]`,
        sourceLength,
        boundaries,
      );
    }
  }
}

export function consumeIr({ source, artifactJson, profiles }) {
  const document = parseJson(artifactJson);
  if (!isRecord(document)) fail("E_SHAPE", "artifact must be an object");
  const profile = selectProfile(document, profiles);
  const sourceRecord = requireRecord(document.source, "source");
  requireString(sourceRecord, "unitId", "source");
  const declaredLength = requireInteger(
    sourceRecord,
    "utf8ByteLength",
    "source",
  );
  const actualLength = Buffer.byteLength(source, "utf8");
  if (declaredLength !== actualLength) {
    fail(
      "E_SOURCE_LENGTH",
      `source length ${actualLength} does not match ${declaredLength}`,
    );
  }
  const declaredHash = requireString(sourceRecord, "contentHash", "source");
  const actualHash = sha256(source);
  if (declaredHash !== actualHash) {
    fail("E_SOURCE_HASH", "source content hash does not match the artifact");
  }

  const boundaries = utf8Boundaries(source);
  const seenIds = new Set();
  let previousEnd = 0;
  const spans = [];
  for (const [index, tokenValue] of requireArray(
    document.tokens,
    "tokens",
  ).entries()) {
    const label = `tokens[${index}]`;
    const token = requireRecord(tokenValue, label);
    const occurrenceId = requireInteger(token, "occurrenceId", label);
    if (seenIds.has(occurrenceId)) {
      fail("E_SHAPE", `${label}.occurrenceId must be unique`);
    }
    seenIds.add(occurrenceId);
    const range = requireRange(
      token.byteRange,
      `${label}.byteRange`,
      actualLength,
      boundaries,
    );
    if (range.startUtf8 < previousEnd || range.startUtf8 === range.endUtf8) {
      fail("E_RANGE", `${label}.byteRange must be ordered and non-empty`);
    }
    previousEnd = range.endUtf8;
    const tokenKind = requireString(token, "tokenKind", label);
    const lexicalClass = requireNullableString(token, "lexicalClass", label);
    const functionKind = requireNullableString(token, "functionKind", label);
    // effort:migration:start
    if (profile.openClassKindField !== Object.hasOwn(token, "openClassKind")) {
      fail(
        "E_SHAPE",
        `${label}.openClassKind presence does not match ${profile.release}`,
      );
    }
    const openClassKind = profile.openClassKindField
      ? requireNullableString(token, "openClassKind", label)
      : null;
    // effort:migration:end
    if (
      (lexicalClass === "FUNCTION") !== (functionKind !== null) ||
      (openClassKind !== null && lexicalClass !== "CONTENT")
    ) {
      fail("E_AXES", `${label} contains illegal token axes`);
    }
    const role = roleForAxes(
      profile,
      tokenKind,
      lexicalClass,
      openClassKind,
    );
    if (!role) fail("E_AXES", `${label} has no vocabulary role`);
    if (profile.projectionsByRole.get(role)?.lspTokenType !== null) {
      spans.push({ ...range, role });
    }
  }

  validateAuxiliaryShape(document, actualLength, boundaries);
  return renderReport(normalizeSpans(source, spans, "E_RANGE"));
}
