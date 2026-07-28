import {
  decodeUtf8,
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
  "E_SOURCE_UTF8",
  "E_SOURCE_LENGTH",
  "E_SOURCE_HASH",
  "E_RANGE",
  "E_AXES",
]);

const WIRE_INT_MIN = -2147483648;
const WIRE_INT_MAX = 2147483647;
const DOCUMENT_FIELDS = new Set([
  "contractVersion",
  "schemaHash",
  "vocabularyHash",
  "source",
  "tokens",
  "structure",
  "diagnostics",
  "derivation",
]);
const SOURCE_FIELDS = new Set(["unitId", "contentHash", "utf8ByteLength"]);
const RANGE_FIELDS = new Set(["startUtf8", "endUtf8"]);
const TOKEN_FIELDS = new Set([
  "occurrenceId",
  "byteRange",
  "tokenKind",
  "lexicalClass",
  "functionKind",
]);
const TOKEN_WITH_OPEN_CLASS_FIELDS = new Set([
  ...TOKEN_FIELDS,
  "openClassKind",
]);
const STRUCTURE_FIELDS = new Set([
  "nodeId",
  "kind",
  "byteRange",
  "depth",
  "childNodeIds",
]);
const DIAGNOSTIC_FIELDS = new Set([
  "byteRange",
  "severity",
  "code",
  "message",
]);
const DERIVATION_FIELDS = new Set([
  "passId",
  "ruleId",
  "sourceRanges",
  "compilerBuildHash",
]);

function requireRecord(value, label, allowedFields) {
  if (!isRecord(value)) fail("E_SHAPE", `${label} must be an object`);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      fail("E_SHAPE", `${label}.${field} is not part of the contract`);
    }
  }
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

function requireWireInteger(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < WIRE_INT_MIN ||
    value > WIRE_INT_MAX
  ) {
    fail("E_SHAPE", `${label} must be a signed GraphQL Int`);
  }
  return value;
}

function requireInteger(record, field, label) {
  return requireWireInteger(record[field], `${label}.${field}`);
}

function requireNullableString(record, field, label) {
  if (!(record[field] === null || typeof record[field] === "string")) {
    fail("E_SHAPE", `${label}.${field} must be a string or null`);
  }
  return record[field];
}

function requireEnum(record, field, label, values) {
  const value = requireString(record, field, label);
  if (!values.has(value)) {
    fail("E_SHAPE", `${label}.${field} is not a supported enum member`);
  }
  return value;
}

function requireNullableEnum(record, field, label, values) {
  const value = requireNullableString(record, field, label);
  if (value !== null && !values.has(value)) {
    fail("E_SHAPE", `${label}.${field} is not a supported enum member`);
  }
  return value;
}

function requireRange(value, label, sourceLength, boundaries) {
  const range = requireRecord(value, label, RANGE_FIELDS);
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

function validateStructure(document, sourceLength, boundaries, profile) {
  const structure = requireArray(document.structure, "structure");
  const nodeIndices = new Map();
  const nodes = [];
  for (const [index, nodeValue] of structure.entries()) {
    const label = `structure[${index}]`;
    const node = requireRecord(nodeValue, label, STRUCTURE_FIELDS);
    const nodeId = requireInteger(node, "nodeId", label);
    if (nodeIndices.has(nodeId)) {
      fail("E_SHAPE", `${label}.nodeId must be unique`);
    }
    nodeIndices.set(nodeId, index);
    const kind = requireEnum(node, "kind", label, profile.enums.outlineKind);
    const depth = requireInteger(node, "depth", label);
    const expectedDepth = kind === "PARAGRAPH" ? 0 : 1;
    if (depth !== expectedDepth) {
      fail("E_SHAPE", `${label}.depth does not match ${kind}`);
    }
    const byteRange = requireRange(
      node.byteRange,
      `${label}.byteRange`,
      sourceLength,
      boundaries,
    );
    const childNodeIds = requireArray(
      node.childNodeIds,
      `${label}.childNodeIds`,
    );
    for (const [childIndex, child] of childNodeIds.entries()) {
      requireWireInteger(child, `${label}.childNodeIds[${childIndex}]`);
    }
    nodes.push({ nodeId, byteRange, childNodeIds });
  }

  const parents = new Map();
  for (const [index, node] of nodes.entries()) {
    for (const [childIndex, childId] of node.childNodeIds.entries()) {
      const childIndexInStructure = nodeIndices.get(childId);
      if (childIndexInStructure === undefined) {
        fail(
          "E_SHAPE",
          `structure[${index}].childNodeIds[${childIndex}] is dangling`,
        );
      }
      const firstParent = parents.get(childId);
      if (firstParent !== undefined && firstParent !== node.nodeId) {
        fail("E_SHAPE", `structure child ${childId} has multiple parents`);
      }
      if (firstParent === undefined) parents.set(childId, node.nodeId);
      const child = nodes[childIndexInStructure];
      if (
        child.byteRange.startUtf8 < node.byteRange.startUtf8 ||
        child.byteRange.endUtf8 > node.byteRange.endUtf8
      ) {
        fail("E_SHAPE", `structure child ${childId} leaves its parent range`);
      }
    }
  }

  const colors = new Uint8Array(nodes.length);
  for (let root = 0; root < nodes.length; root += 1) {
    if (colors[root] !== 0) continue;
    colors[root] = 1;
    const stack = [{ nodeIndex: root, edgeIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      const node = nodes[frame.nodeIndex];
      if (frame.edgeIndex === node.childNodeIds.length) {
        colors[frame.nodeIndex] = 2;
        stack.pop();
        continue;
      }
      const childId = node.childNodeIds[frame.edgeIndex];
      frame.edgeIndex += 1;
      const childIndex = nodeIndices.get(childId);
      if (colors[childIndex] === 1) {
        fail("E_SHAPE", `structure edge to ${childId} closes a cycle`);
      }
      if (colors[childIndex] === 0) {
        colors[childIndex] = 1;
        stack.push({ nodeIndex: childIndex, edgeIndex: 0 });
      }
    }
  }
}

function validateAuxiliaryShape(document, sourceLength, boundaries, profile) {
  validateStructure(document, sourceLength, boundaries, profile);
  for (const [index, diagnosticValue] of requireArray(
    document.diagnostics,
    "diagnostics",
  ).entries()) {
    const label = `diagnostics[${index}]`;
    const diagnostic = requireRecord(
      diagnosticValue,
      label,
      DIAGNOSTIC_FIELDS,
    );
    requireRange(
      diagnostic.byteRange,
      `${label}.byteRange`,
      sourceLength,
      boundaries,
    );
    requireEnum(
      diagnostic,
      "severity",
      label,
      profile.enums.diagnosticSeverity,
    );
    requireString(diagnostic, "code", label);
    requireString(diagnostic, "message", label);
  }

  for (const [index, stepValue] of requireArray(
    document.derivation,
    "derivation",
  ).entries()) {
    const label = `derivation[${index}]`;
    const step = requireRecord(stepValue, label, DERIVATION_FIELDS);
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
  requireRecord(document, "artifact", DOCUMENT_FIELDS);
  const profile = selectProfile(document, profiles);
  const sourceBytes =
    typeof source === "string" ? Buffer.from(source, "utf8") : source;
  if (!(sourceBytes instanceof Uint8Array)) {
    fail("E_SOURCE_UTF8", "source must be UTF-8 bytes or text");
  }
  const sourceText = decodeUtf8(sourceBytes);
  const sourceRecord = requireRecord(document.source, "source", SOURCE_FIELDS);
  requireString(sourceRecord, "unitId", "source");
  const declaredLength = requireInteger(
    sourceRecord,
    "utf8ByteLength",
    "source",
  );
  const actualLength = sourceBytes.byteLength;
  if (declaredLength !== actualLength) {
    fail(
      "E_SOURCE_LENGTH",
      `source length ${actualLength} does not match ${declaredLength}`,
    );
  }
  const declaredHash = requireString(sourceRecord, "contentHash", "source");
  const actualHash = sha256(sourceBytes);
  if (declaredHash !== actualHash) {
    fail("E_SOURCE_HASH", "source content hash does not match the artifact");
  }

  const boundaries = utf8Boundaries(sourceText);
  const seenIds = new Set();
  let previousEnd = 0;
  const spans = [];
  for (const [index, tokenValue] of requireArray(
    document.tokens,
    "tokens",
  ).entries()) {
    const label = `tokens[${index}]`;
    const token = requireRecord(
      tokenValue,
      label,
      profile.openClassKindField ? TOKEN_WITH_OPEN_CLASS_FIELDS : TOKEN_FIELDS,
    );
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
    const tokenKind = requireEnum(
      token,
      "tokenKind",
      label,
      profile.enums.tokenKind,
    );
    const lexicalClass = requireNullableEnum(
      token,
      "lexicalClass",
      label,
      profile.enums.lexicalClass,
    );
    const functionKind = requireNullableEnum(
      token,
      "functionKind",
      label,
      profile.enums.functionKind,
    );
    // effort:migration:start
    if (profile.openClassKindField !== Object.hasOwn(token, "openClassKind")) {
      fail(
        "E_SHAPE",
        `${label}.openClassKind presence does not match ${profile.release}`,
      );
    }
    const openClassKind = profile.openClassKindField
      ? requireNullableEnum(
          token,
          "openClassKind",
          label,
          profile.enums.openClassKind,
        )
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

  validateAuxiliaryShape(document, actualLength, boundaries, profile);
  return renderReport(normalizeSpans(sourceText, spans, "E_RANGE"));
}
