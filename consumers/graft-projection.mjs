// Reference consumer: how graft (and, through it, jedit) turns the colorful IR
// into a syntax projection.
//
// colorful emits UTF-8 byte ranges (authoritative). Editors want line/column, so
// the consumer derives those from the source — exactly the "derived adapter
// projection" the IR contract keeps out of itself. The resulting className spans
// are the shape graft already produces and jedit's graft-source-highlighter
// already maps to editor roles, so prose flows through the existing path.
//
//   colorful ir FILE | node consumers/graft-projection.mjs FILE
//
// Coordinates are handled in BYTES end to end: the source is read as raw UTF-8,
// line starts are byte offsets, and a column is derived by decoding only the
// line prefix up to the token. Treating the source as a JavaScript string would
// index it in UTF-16 code units and corrupt every position after a non-ASCII
// character. The source is verified against the IR's `contentHash` before any
// projection, so a stale or mismatched file is rejected rather than mis-mapped.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// The colorful.vocabulary/v1 manifest is the single source of presentation
// intent, shared with the CLI and the LSP. We load it once (and remember its
// hash) instead of hardcoding a className table that could drift from the
// producer's vocabulary.
const MANIFEST_URL = new URL("../contracts/colorful/vocabulary.v1.json", import.meta.url);
const MANIFEST_VERSION = "colorful.vocabulary/v1";
// The colorful.syntax/v1 contract SDL, hashed the same way colorful-ir hashes
// its package-local copy (`syntax_schema_hash`) -- the two are byte-identical,
// enforced by scripts/package-witness.sh's "package-local contract copies"
// check, so this consumer can independently recompute the producer's
// `schemaHash` instead of trusting an artifact's self-reported value.
const SYNTAX_SDL_URL = new URL("../contracts/colorful/syntax.v1.graphql", import.meta.url);
const CONTRACT_VERSION = "colorful.syntax/v1";
const TOKEN_KINDS = new Set(["WORD", "NUMBER", "PUNCTUATION", "QUOTE"]);
const LEXICAL_CLASSES = new Set(["FUNCTION", "CONTENT", "PROPER_NOUN_CANDIDATE"]);
const OPEN_CLASS_KINDS = new Set(["NOUN", "VERB", "ADJECTIVE", "ADVERB"]);
const VISUAL_ROLES = new Set([
  "STRUCTURAL_KEYWORD",
  "TYPE_LIKE",
  "LITERAL",
  "QUOTED",
  "MUTED",
  "UNSTYLED",
  "NOUN",
  "VERB",
  "ADJECTIVE",
  "ADVERB",
]);
const EXPECTED_CLASS_KEYS = new Set([
  "WORD/FUNCTION/<none>",
  "WORD/CONTENT/<none>",
  "WORD/CONTENT/NOUN",
  "WORD/CONTENT/VERB",
  "WORD/CONTENT/ADJECTIVE",
  "WORD/CONTENT/ADVERB",
  "WORD/PROPER_NOUN_CANDIDATE/<none>",
  "NUMBER/<none>/<none>",
  "PUNCTUATION/<none>/<none>",
  "QUOTE/<none>/<none>",
]);

function loadVocabulary() {
  const bytes = readFileSync(MANIFEST_URL); // raw bytes, so the hash matches the producer
  const manifest = JSON.parse(bytes.toString("utf8"));
  validateVocabularyManifest(manifest);
  return {
    hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    classRoles: manifest.classRoles,
    projectionByRole: new Map(manifest.roleProjections.map((p) => [p.visualRole, p])),
  };
}

const VOCABULARY = loadVocabulary();
const SYNTAX_SCHEMA_HASH = `sha256:${createHash("sha256").update(readFileSync(SYNTAX_SDL_URL)).digest("hex")}`;

// A validation failure, with a stable machine-readable `code` and structured
// `context` alongside the human-readable message -- so a caller can branch on
// the failure kind instead of pattern-matching prose, and a bug report carries
// the offending index/id instead of just a sentence.
export class GraftProjectionError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "GraftProjectionError";
    this.code = code;
    this.context = context;
  }
}

function fail(code, message, context) {
  throw new GraftProjectionError(code, message, context);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function requireKeys(object, keys, label) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    throw new Error(`${label} must be an object`);
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) throw new Error(`${label} is missing ${key}`);
  }
}

function classRoleKey(rule) {
  if (!TOKEN_KINDS.has(rule.tokenKind)) {
    throw new Error(`unknown tokenKind ${rule.tokenKind}`);
  }
  if (rule.lexicalClass !== null && !LEXICAL_CLASSES.has(rule.lexicalClass)) {
    throw new Error(`unknown lexicalClass ${rule.lexicalClass}`);
  }
  if (rule.openClassKind !== null && !OPEN_CLASS_KINDS.has(rule.openClassKind)) {
    throw new Error(`unknown openClassKind ${rule.openClassKind}`);
  }
  if (!VISUAL_ROLES.has(rule.visualRole)) {
    throw new Error(`unknown visualRole ${rule.visualRole}`);
  }
  if (rule.tokenKind === "WORD") {
    if (rule.lexicalClass === null) throw new Error("WORD class role must declare lexicalClass");
    if (rule.lexicalClass !== "CONTENT" && rule.openClassKind !== null) {
      throw new Error(`WORD/${rule.lexicalClass} class role must not declare openClassKind`);
    }
    return `${rule.tokenKind}/${rule.lexicalClass}/${rule.openClassKind ?? "<none>"}`;
  }
  if (rule.lexicalClass !== null) {
    throw new Error(`${rule.tokenKind} class role must not declare lexicalClass`);
  }
  if (rule.openClassKind !== null) {
    throw new Error(`${rule.tokenKind} class role must not declare openClassKind`);
  }
  return `${rule.tokenKind}/<none>/<none>`;
}

function requireStringOrNull(value, label) {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
}

// Validate the manifest before any projection can use it. Silent fall-through
// would make a matching vocabularyHash certify a broken presentation vocabulary.
export function validateVocabularyManifest(manifest) {
  requireKeys(manifest, ["version", "classRoles", "roleProjections"], "vocabulary manifest");
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`vocabulary manifest version ${manifest.version} is not ${MANIFEST_VERSION}`);
  }
  if (!Array.isArray(manifest.classRoles)) throw new Error("classRoles must be an array");
  if (!Array.isArray(manifest.roleProjections)) throw new Error("roleProjections must be an array");

  const classKeys = new Set();
  for (const [index, rule] of manifest.classRoles.entries()) {
    requireKeys(
      rule,
      ["tokenKind", "lexicalClass", "openClassKind", "visualRole"],
      `classRoles[${index}]`,
    );
    const key = classRoleKey(rule);
    if (classKeys.has(key)) throw new Error(`duplicate class role ${key}`);
    classKeys.add(key);
  }
  if (classKeys.size !== EXPECTED_CLASS_KEYS.size) {
    throw new Error("classRoles does not cover the expected token axes");
  }
  for (const expected of EXPECTED_CLASS_KEYS) {
    if (!classKeys.has(expected)) throw new Error(`classRoles is missing ${expected}`);
  }

  const projectionRoles = new Set();
  for (const [index, projection] of manifest.roleProjections.entries()) {
    requireKeys(
      projection,
      ["visualRole", "ansi", "lspTokenType", "graftClass"],
      `roleProjections[${index}]`,
    );
    if (!VISUAL_ROLES.has(projection.visualRole)) {
      throw new Error(`unknown projection visualRole ${projection.visualRole}`);
    }
    requireStringOrNull(projection.ansi, `roleProjections[${index}].ansi`);
    requireStringOrNull(projection.lspTokenType, `roleProjections[${index}].lspTokenType`);
    requireStringOrNull(projection.graftClass, `roleProjections[${index}].graftClass`);
    if (projectionRoles.has(projection.visualRole)) {
      throw new Error(`duplicate projection for ${projection.visualRole}`);
    }
    projectionRoles.add(projection.visualRole);
  }
  for (const expected of VISUAL_ROLES) {
    if (!projectionRoles.has(expected)) throw new Error(`roleProjections is missing ${expected}`);
  }
}

// The abstract VisualRole for a token's axes, per the manifest. A WORD is keyed
// by lexicalClass and, for CONTENT words, the optional openClassKind.
function visualRole(token) {
  for (const rule of VOCABULARY.classRoles) {
    const kindMatches = rule.tokenKind === token.tokenKind;
    const classMatches = rule.lexicalClass === (token.lexicalClass ?? null);
    const openClassMatches = rule.openClassKind === (token.openClassKind ?? null);
    if (kindMatches && classMatches && openClassMatches) return rule.visualRole;
  }
  throw new Error(
    `no vocabulary role for token axes ${token.tokenKind}/${token.lexicalClass ?? "<none>"}/${token.openClassKind ?? "<none>"}`,
  );
}

// colorful.syntax/v1 token -> graft syntax class, via the manifest's role
// projection. Undifferentiated content and punctuation project to no class;
// explicit open-class content can project to noun/verb/adjective/adverb classes.
export function className(token) {
  const role = visualRole(token);
  const projection = VOCABULARY.projectionByRole.get(role);
  if (!projection) throw new Error(`vocabulary role ${role} has no projection`);
  return projection.graftClass ?? undefined;
}

// Reject an artifact whose vocabularyHash does not match the manifest this
// consumer holds — its colors would otherwise be projected through a different
// vocabulary than the producer intended.
export function verifyVocabularyHash(ir) {
  const expected = ir?.vocabularyHash;
  if (typeof expected !== "string") {
    fail("E_VOCABULARY_HASH", "IR is missing vocabularyHash; refusing to project.");
  }
  if (expected !== VOCABULARY.hash) {
    fail(
      "E_VOCABULARY_HASH",
      `IR vocabularyHash (${expected}) does not match this consumer's manifest (${VOCABULARY.hash}); refusing to project.`,
      { expected, actual: VOCABULARY.hash },
    );
  }
}

// Reject an artifact whose schemaHash does not match this consumer's
// colorful.syntax/v1 contract SDL -- a schema drift would otherwise silently
// misinterpret fields the artifact never actually declared.
export function verifySchemaHash(ir) {
  const expected = ir?.schemaHash;
  if (typeof expected !== "string") {
    fail("E_SCHEMA_HASH", "IR is missing schemaHash; refusing to project.");
  }
  if (expected !== SYNTAX_SCHEMA_HASH) {
    fail(
      "E_SCHEMA_HASH",
      `IR schemaHash (${expected}) does not match this consumer's contract (${SYNTAX_SCHEMA_HASH}); refusing to project.`,
      { expected, actual: SYNTAX_SCHEMA_HASH },
    );
  }
}

// The hash of the vocabulary manifest this consumer is bound to.
export function vocabularyHash() {
  return VOCABULARY.hash;
}

// The hash of the colorful.syntax/v1 contract SDL this consumer is bound to.
export function schemaHash() {
  return SYNTAX_SCHEMA_HASH;
}

// The row containing `offset`: the largest index into `lineStarts` (sorted
// ascending) whose value is <= offset. Correct for any caller regardless of
// call order, at O(log lines) instead of the O(lines) a linear scan from row
// 0 would cost on every call.
function binarySearchRow(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

// Build a UTF-8 byte offset -> { row, column } mapper over the raw source bytes.
// Line breaks follow the LSP set (`\n`, `\r\n`, bare `\r`) so rows agree with the
// language server. The column counts Unicode *scalar values* (code points) from
// the line start, decoding only the prefix it needs -- not grapheme clusters, so
// a combining mark ("é") counts as two columns and an emoji ("😀", two
// UTF-16 units) counts as one, same as any other single code point.
//
// project() calls the returned function once per token in
// validateArtifact()'s already-enforced wire order (colorful.syntax/v1
// itself does not require this; see validateTokenOrderAndBoundaries), so the
// common case advances a cursor forward by however many lines the next
// offset actually crossed -- typically zero or one -- rather than rescanning
// from row 0 every time. A caller that goes backward (project() never does,
// but this function is also exported on its own) still gets a correct
// answer via binary search instead of a wrong one from a stale cursor.
export function makeByteToPoint(buffer) {
  const lineStarts = [0];
  for (let i = 0; i < buffer.length; i += 1) {
    const b = buffer[i];
    if (b === 0x0a) {
      lineStarts.push(i + 1);
    } else if (b === 0x0d) {
      const crlf = buffer[i + 1] === 0x0a;
      lineStarts.push(i + (crlf ? 2 : 1));
      if (crlf) i += 1;
    }
  }
  let cursorRow = 0;
  let lastOffset = -1;
  // Total forward cursor advances across every call this closure ever
  // receives. Not used by project() -- it exists so a test can prove the
  // monotonic-cursor optimization is real (bounded by line count, not by
  // line count times call count) without timing anything.
  const stats = { advances: 0 };
  const byteToPoint = (byte) => {
    const offset = Math.max(0, Math.min(byte, buffer.length));
    let row;
    if (offset >= lastOffset) {
      row = cursorRow;
      while (row + 1 < lineStarts.length && lineStarts[row + 1] <= offset) {
        row += 1;
        stats.advances += 1;
      }
    } else {
      row = binarySearchRow(lineStarts, offset);
    }
    cursorRow = row;
    lastOffset = offset;
    const lineStart = lineStarts[row];
    const column = [...buffer.subarray(lineStart, offset).toString("utf8")].length;
    return { row, column };
  };
  byteToPoint.stats = stats;
  return byteToPoint;
}

// Reject a source whose bytes do not hash to the IR's declared `contentHash`.
// A coordinate is only meaningful against the exact bytes it was computed over.
export function verifyContentHash(buffer, ir) {
  const expected = ir?.source?.contentHash;
  if (typeof expected !== "string") {
    fail("E_CONTENT_HASH", "IR is missing source.contentHash; refusing to project.");
  }
  const actual = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  if (actual !== expected) {
    fail(
      "E_CONTENT_HASH",
      `source does not match IR contentHash (expected ${expected}, got ${actual}); refusing to project.`,
      { expected, actual },
    );
  }
}

// ---- Artifact validation: reject, never clamp ------------------------------
//
// A serialized DocumentAnalysis crosses a process/language boundary and may
// lie about its own shape. validateArtifact() is the admission gate every
// artifact passes through before project() interprets it. Checks run cheapest
// first, expensive hashes last, so a malformed artifact fails fast: (1) shape,
// (2) contract version, (3) byte length, (4) source UTF-8 validity, (5) token
// range/scalar shape and char-boundary, (6) token order and non-overlap, (7)
// occurrence id uniqueness, (8) token axis legality, (9) structure graph
// (duplicate node ids, dangling child refs), (10) schemaHash, vocabularyHash,
// contentHash.
//
// Token order (6) is a graft-projection-specific requirement, not a general
// colorful.syntax/v1 wire invariant: colorful_ir::validate_document
// deliberately does not enforce inter-token ordering on a received artifact,
// since a future producer could legitimately emit a different layout. This
// consumer commits to a stricter contract than the wire guarantees, because
// makeByteToPoint's monotonic cursor (see the performance notes below) relies
// on it -- and a consumer is always free to accept less than the wire
// contract allows, as long as it rejects rather than silently repairs
// whatever it won't accept.
function requireIntegerField(value, label) {
  if (!isSafeInteger(value)) fail("E_ARTIFACT_SHAPE", `${label} must be a safe integer`);
}

function requireByteRangeShape(range, label) {
  if (!isPlainObject(range)) fail("E_ARTIFACT_SHAPE", `${label} must be an object`);
  requireIntegerField(range.startUtf8, `${label}.startUtf8`);
  requireIntegerField(range.endUtf8, `${label}.endUtf8`);
  if (range.startUtf8 < 0) fail("E_ARTIFACT_SHAPE", `${label}.startUtf8 must not be negative`);
  if (range.endUtf8 < 0) fail("E_ARTIFACT_SHAPE", `${label}.endUtf8 must not be negative`);
}

function requireStringOrNullField(value, label) {
  if (value !== null && typeof value !== "string") {
    fail("E_ARTIFACT_SHAPE", `${label} must be a string or null`);
  }
}

// 1. Top-level shape: every field validation past this point dereferences
// must exist with the right primitive type, so a malformed artifact fails
// with a stable code here instead of a raw "Cannot read properties of
// undefined" a few checks later.
function validateShape(ir) {
  if (!isPlainObject(ir)) fail("E_ARTIFACT_SHAPE", "artifact must be an object");
  if (typeof ir.contractVersion !== "string") fail("E_ARTIFACT_SHAPE", "contractVersion must be a string");
  if (typeof ir.schemaHash !== "string") fail("E_ARTIFACT_SHAPE", "schemaHash must be a string");
  if (typeof ir.vocabularyHash !== "string") fail("E_ARTIFACT_SHAPE", "vocabularyHash must be a string");
  if (!isPlainObject(ir.source)) fail("E_ARTIFACT_SHAPE", "source must be an object");
  if (typeof ir.source.unitId !== "string") fail("E_ARTIFACT_SHAPE", "source.unitId must be a string");
  if (typeof ir.source.contentHash !== "string") {
    fail("E_ARTIFACT_SHAPE", "source.contentHash must be a string");
  }
  requireIntegerField(ir.source.utf8ByteLength, "source.utf8ByteLength");
  if (ir.source.utf8ByteLength < 0) fail("E_ARTIFACT_SHAPE", "source.utf8ByteLength must not be negative");
  if (!Array.isArray(ir.tokens)) fail("E_ARTIFACT_SHAPE", "tokens must be an array");
  if (!Array.isArray(ir.structure)) fail("E_ARTIFACT_SHAPE", "structure must be an array");

  for (const [index, token] of ir.tokens.entries()) {
    if (!isPlainObject(token)) fail("E_ARTIFACT_SHAPE", `tokens[${index}] must be an object`);
    requireIntegerField(token.occurrenceId, `tokens[${index}].occurrenceId`);
    requireByteRangeShape(token.byteRange, `tokens[${index}].byteRange`);
    if (typeof token.tokenKind !== "string") {
      fail("E_ARTIFACT_SHAPE", `tokens[${index}].tokenKind must be a string`);
    }
    requireStringOrNullField(token.lexicalClass ?? null, `tokens[${index}].lexicalClass`);
    requireStringOrNullField(token.functionKind ?? null, `tokens[${index}].functionKind`);
    requireStringOrNullField(token.openClassKind ?? null, `tokens[${index}].openClassKind`);
  }

  for (const [index, node] of ir.structure.entries()) {
    if (!isPlainObject(node)) fail("E_ARTIFACT_SHAPE", `structure[${index}] must be an object`);
    requireIntegerField(node.nodeId, `structure[${index}].nodeId`);
    requireByteRangeShape(node.byteRange, `structure[${index}].byteRange`);
    if (typeof node.kind !== "string") fail("E_ARTIFACT_SHAPE", `structure[${index}].kind must be a string`);
    requireIntegerField(node.depth, `structure[${index}].depth`);
    if (!Array.isArray(node.childNodeIds)) {
      fail("E_ARTIFACT_SHAPE", `structure[${index}].childNodeIds must be an array`);
    }
    for (const [childIndex, child] of node.childNodeIds.entries()) {
      requireIntegerField(child, `structure[${index}].childNodeIds[${childIndex}]`);
    }
  }
}

// 2. Contract version.
function validateContractVersion(ir) {
  if (ir.contractVersion !== CONTRACT_VERSION) {
    fail(
      "E_CONTRACT_VERSION",
      `IR contractVersion (${ir.contractVersion}) is not ${CONTRACT_VERSION}; refusing to project.`,
      { expected: CONTRACT_VERSION, actual: ir.contractVersion },
    );
  }
}

// 3. Byte length: checked before decoding, so a fabricated length can't hide
// behind bytes that fail to decode (the same ordering colorful_ir's
// validate_document uses, and for the same reason).
function validateByteLength(buffer, ir) {
  if (ir.source.utf8ByteLength !== buffer.length) {
    fail(
      "E_BYTE_LENGTH",
      `source.utf8ByteLength (${ir.source.utf8ByteLength}) does not match the real byte length (${buffer.length}).`,
      { declared: ir.source.utf8ByteLength, actual: buffer.length },
    );
  }
}

// 4. Source UTF-8 validity: `Buffer#toString("utf8")` silently replaces
// malformed sequences instead of rejecting them, so byte-boundary checks
// based on continuation bytes are only lawful once this has passed.
function validateSourceUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("E_SOURCE_UTF8", "source bytes are not valid UTF-8; refusing to project.");
  }
}

// Whether `offset` falls on a UTF-8 code-point boundary. Only lawful once the
// whole buffer is confirmed valid UTF-8 (validateSourceUtf8 above).
function isUtf8Boundary(buffer, offset) {
  if (offset === 0 || offset === buffer.length) return true;
  return (buffer[offset] & 0xc0) !== 0x80;
}

function validateByteRangeBounds(range, buffer, label) {
  if (range.startUtf8 > range.endUtf8) {
    fail("E_BYTE_RANGE_ORDER", `${label} start (${range.startUtf8}) exceeds its end (${range.endUtf8}).`, {
      label,
      startUtf8: range.startUtf8,
      endUtf8: range.endUtf8,
    });
  }
  if (range.endUtf8 > buffer.length) {
    fail("E_BYTE_RANGE_BOUNDS", `${label} end (${range.endUtf8}) exceeds the source length (${buffer.length}).`, {
      label,
      endUtf8: range.endUtf8,
      length: buffer.length,
    });
  }
  if (!isUtf8Boundary(buffer, range.startUtf8) || !isUtf8Boundary(buffer, range.endUtf8)) {
    fail("E_BYTE_RANGE_BOUNDARY", `${label} does not fall on a UTF-8 character boundary.`, {
      label,
      startUtf8: range.startUtf8,
      endUtf8: range.endUtf8,
    });
  }
}

// 5+6. Token range/boundary validity, in wire order, plus non-overlap. Zero-
// width tokens (startUtf8 === endUtf8) are allowed, matching
// colorful_ir::validate_document's own `start <= end` (not `<`) check.
// Malformed order is rejected, never sorted into validity: sorting would
// silently conceal whatever the producer actually emitted.
function validateTokenOrderAndBoundaries(buffer, ir) {
  let previousEnd = 0;
  for (const [index, token] of ir.tokens.entries()) {
    const label = `tokens[${index}].byteRange`;
    validateByteRangeBounds(token.byteRange, buffer, label);
    if (token.byteRange.startUtf8 < previousEnd) {
      fail(
        "E_TOKEN_ORDER",
        `tokens[${index}] starts at ${token.byteRange.startUtf8}, before the previous token ends at ${previousEnd}.`,
        { index, startUtf8: token.byteRange.startUtf8, previousEnd },
      );
    }
    previousEnd = token.byteRange.endUtf8;
  }
}

// 7. Occurrence id uniqueness.
function validateOccurrenceIds(ir) {
  const seen = new Set();
  for (const [index, token] of ir.tokens.entries()) {
    if (seen.has(token.occurrenceId)) {
      fail("E_DUPLICATE_OCCURRENCE_ID", `tokens[${index}] reuses occurrenceId ${token.occurrenceId}.`, {
        index,
        occurrenceId: token.occurrenceId,
      });
    }
    seen.add(token.occurrenceId);
  }
}

// Mirrors colorful_ir's token_axes_violation exactly: a WORD carries a
// lexicalClass; only a FUNCTION word carries a functionKind; only a CONTENT
// word may carry an openClassKind; every other tokenKind carries none of
// those optional axes.
function tokenAxesViolation(token) {
  const { tokenKind, lexicalClass = null, functionKind = null, openClassKind = null } = token;
  if (tokenKind === "WORD") {
    if (lexicalClass === null) return "a WORD token must carry a lexicalClass";
    if (lexicalClass === "FUNCTION") {
      if (functionKind === null) return "a FUNCTION word must carry a functionKind";
      if (openClassKind !== null) return "only a CONTENT word may carry an openClassKind";
      return null;
    }
    if (functionKind !== null) return "only a FUNCTION word may carry a functionKind";
    if (lexicalClass === "CONTENT") return null;
    if (lexicalClass === "PROPER_NOUN_CANDIDATE") {
      if (openClassKind !== null) return "only a CONTENT word may carry an openClassKind";
      return null;
    }
    return `unknown lexicalClass ${lexicalClass}`;
  }
  if (lexicalClass !== null) return "a non-word token must not carry a lexicalClass";
  if (functionKind !== null) return "a non-word token must not carry a functionKind";
  if (openClassKind !== null) return "a non-word token must not carry an openClassKind";
  return null;
}

// 8. Token axis legality.
function validateTokenAxes(ir) {
  for (const [index, token] of ir.tokens.entries()) {
    const violation = tokenAxesViolation(token);
    if (violation) {
      fail("E_TOKEN_AXES", `tokens[${index}]: ${violation}.`, { index, detail: violation });
    }
  }
}

// 9. Structure graph: each node's own range validity, duplicate node ids, and
// dangling child references -- exactly what colorful_ir::validate_document
// checks on the wire contract, no more (it does not check for cycles or
// self-parenting, and neither does this).
function validateStructure(buffer, ir) {
  const nodeIds = new Set(ir.structure.map((node) => node.nodeId));
  const seen = new Set();
  for (const node of ir.structure) {
    validateByteRangeBounds(node.byteRange, buffer, `structure node ${node.nodeId}`);
    if (seen.has(node.nodeId)) {
      fail("E_DUPLICATE_NODE_ID", `structure has two nodes with id ${node.nodeId}.`, { nodeId: node.nodeId });
    }
    seen.add(node.nodeId);
    for (const child of node.childNodeIds) {
      if (!nodeIds.has(child)) {
        fail("E_DANGLING_CHILD_REF", `structure node ${node.nodeId} references missing child ${child}.`, {
          nodeId: node.nodeId,
          child,
        });
      }
    }
  }
}

// The full admission gate. project() below runs this unconditionally; it is
// also exported so a caller can validate without projecting.
export function validateArtifact(buffer, ir) {
  validateShape(ir);
  validateContractVersion(ir);
  validateByteLength(buffer, ir);
  validateSourceUtf8(buffer);
  validateTokenOrderAndBoundaries(buffer, ir);
  validateOccurrenceIds(ir);
  validateTokenAxes(ir);
  validateStructure(buffer, ir);
  verifySchemaHash(ir);
  verifyVocabularyHash(ir);
  verifyContentHash(buffer, ir);
}

// Project an IR document (already parsed) over its source bytes into graft's
// projection-bundle shape (the thing jedit's adapter reads).
export function project(buffer, ir) {
  validateArtifact(buffer, ir);
  const byteToPoint = makeByteToPoint(buffer);
  const spans = ir.tokens
    .map((token) => {
      const cls = className(token);
      if (!cls) return undefined;
      return {
        className: cls,
        range: {
          start: byteToPoint(token.byteRange.startUtf8),
          end: byteToPoint(token.byteRange.endUtf8),
        },
      };
    })
    .filter(Boolean);
  return { syntax: { partial: false, spans } };
}

function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    process.stderr.write("usage: colorful ir FILE | node graft-projection.mjs FILE\n");
    process.exit(1);
  }
  const buffer = readFileSync(sourcePath); // raw UTF-8 bytes, authoritative
  const ir = JSON.parse(readFileSync(0, "utf8"));
  let bundle;
  try {
    bundle = project(buffer, ir);
  } catch (err) {
    process.stderr.write(`graft-projection: ${err.message}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(bundle, null, 2));
  process.stdout.write("\n");
}

// Run as a script, but stay importable from the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
