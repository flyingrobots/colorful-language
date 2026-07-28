import {
  decodeUtf8,
  fail,
  normalizeSpans,
  parseJson,
  renderReport,
  sha256,
  utf8Boundaries,
} from "./common.mjs";
import { roleForAxes } from "./profile.mjs";
import {
  validateSyntaxEnvelope,
  validateSyntaxShape,
} from "../generated/syntax-admission-v1.mjs";

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

function rejectShape(path, reason) {
  const label = path.length === 0 ? "artifact" : path;
  fail("E_SHAPE", `${label} ${reason}`);
}

function requireRange(range, label, sourceLength, boundaries) {
  const { startUtf8, endUtf8 } = range;
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
  const contractProfiles = profiles.filter(
    (profile) => profile.contractVersion === document.contractVersion,
  );
  if (contractProfiles.length === 0) {
    fail(
      "E_CONTRACT_VERSION",
      `unsupported contract version ${document.contractVersion}`,
    );
  }
  const schemaProfiles = contractProfiles.filter(
    (profile) => profile.schemaHash === document.schemaHash,
  );
  if (schemaProfiles.length === 0) {
    fail("E_SCHEMA_HASH", `unsupported schema hash ${document.schemaHash}`);
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

function validateStructure(document, sourceLength, boundaries) {
  const { structure } = document;
  const nodeIndices = new Map();
  const nodes = [];
  for (const [index, node] of structure.entries()) {
    const label = `structure[${index}]`;
    const { nodeId } = node;
    if (nodeIndices.has(nodeId)) {
      fail("E_SHAPE", `${label}.nodeId must be unique`);
    }
    nodeIndices.set(nodeId, index);
    const { kind, depth } = node;
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
    const { childNodeIds } = node;
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

function validateAuxiliaryShape(document, sourceLength, boundaries) {
  validateStructure(document, sourceLength, boundaries);
  for (const [index, diagnostic] of document.diagnostics.entries()) {
    const label = `diagnostics[${index}]`;
    requireRange(
      diagnostic.byteRange,
      `${label}.byteRange`,
      sourceLength,
      boundaries,
    );
  }

  const { derivation } = document;
  if (derivation.length === 0) {
    fail("E_SHAPE", "derivation must contain at least one step");
  }
  const passIds = new Set();
  for (const [index, step] of derivation.entries()) {
    const label = `derivation[${index}]`;
    const { passId, ruleId } = step;
    if (passId.length === 0 || ruleId.length === 0) {
      fail("E_SHAPE", `${label} must identify its pass and rule`);
    }
    if (passIds.has(passId)) {
      fail("E_SHAPE", `${label}.passId must be unique`);
    }
    passIds.add(passId);
    for (const [rangeIndex, range] of step.sourceRanges.entries()) {
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
  validateSyntaxEnvelope(document, rejectShape);
  const profile = selectProfile(document, profiles);
  validateSyntaxShape(document, profile.generationId, rejectShape);
  const sourceBytes =
    typeof source === "string" ? Buffer.from(source, "utf8") : source;
  if (!(sourceBytes instanceof Uint8Array)) {
    fail("E_SOURCE_UTF8", "source must be UTF-8 bytes or text");
  }
  const sourceText = decodeUtf8(sourceBytes);
  const sourceRecord = document.source;
  const declaredLength = sourceRecord.utf8ByteLength;
  const actualLength = sourceBytes.byteLength;
  if (declaredLength !== actualLength) {
    fail(
      "E_SOURCE_LENGTH",
      `source length ${actualLength} does not match ${declaredLength}`,
    );
  }
  const declaredHash = sourceRecord.contentHash;
  const actualHash = sha256(sourceBytes);
  if (declaredHash !== actualHash) {
    fail("E_SOURCE_HASH", "source content hash does not match the artifact");
  }

  const boundaries = utf8Boundaries(sourceText);
  const seenIds = new Set();
  let previousEnd = 0;
  const spans = [];
  for (const [index, token] of document.tokens.entries()) {
    const label = `tokens[${index}]`;
    const { occurrenceId } = token;
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
    const { tokenKind, lexicalClass, functionKind } = token;
    const openClassKind = token.openClassKind ?? null;
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
  return renderReport(normalizeSpans(sourceText, spans, "E_RANGE"));
}
