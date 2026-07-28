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

import {
  classRoleKey,
  EXPECTED_CLASS_KEYS,
  VISUAL_ROLES,
} from "./generated/vocabulary-validator-v1.mjs";
import {
  CURRENT_SYNTAX_GENERATION,
  SYNTAX_ADMISSION_REASON_CODES,
  validateSyntaxShape,
} from "./generated/syntax-admission-v1.mjs";

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

// Strip GraphQL description strings before hashing, mirroring
// colorful-ir's `strip_graphql_descriptions` exactly: a documentation-only
// description edit must not change schemaHash on either side of the
// language boundary, or a cosmetic fix on the Rust producer would make this
// consumer see a false E_SCHEMA_HASH mismatch. This crate's contracts only
// ever use a single-line `"..."` description immediately preceding a type
// or enum, never a `"""..."""` block string or a field-level description,
// so a per-line check (a line that, once trimmed, is nothing but a quoted
// string) is sufficient; extend this if that ever changes.
export function stripGraphqlDescriptions(sdl) {
  // Split the same way Rust's `str::lines()` does: on \n, \r\n, or \r, with
  // an optional final line ending that does NOT produce a trailing empty
  // line (Rust: "a string ending with a final line ending returns the same
  // lines as an otherwise identical string without one"). A naive
  // `split("\n")` would leave a trailing "" for a file ending in a newline,
  // which `.join("\n")` would then turn back into a trailing newline Rust's
  // normalized string never has -- producing a different hash on each side
  // of the language boundary for the exact same contract.
  const lines = sdl.split(/\r\n|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r\n$|\n$/.test(sdl)) {
    lines.pop();
  }
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"'));
    })
    .join("\n");
}

const VOCABULARY = loadVocabulary();
const SYNTAX_SCHEMA_HASH = `sha256:${createHash("sha256")
  .update(stripGraphqlDescriptions(readFileSync(SYNTAX_SDL_URL, "utf8")))
  .digest("hex")}`;

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
  fail(
    "E_TOKEN_AXES",
    `no vocabulary role for token axes ${token.tokenKind}/${token.lexicalClass ?? "<none>"}/${token.openClassKind ?? "<none>"}`,
    { tokenKind: token.tokenKind, lexicalClass: token.lexicalClass ?? null, openClassKind: token.openClassKind ?? null },
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
// first, expensive hashes last: generated structural shape, nonnegative wire
// offsets, contract version, byte length, UTF-8, semantic ranges, ids, axes,
// structure, then identity hashes.
function validateGeneratedShape(ir) {
  validateSyntaxShape(
    ir,
    CURRENT_SYNTAX_GENERATION,
    (path, reason, rejection) => {
      if (
        rejection.reasonCode ===
        SYNTAX_ADMISSION_REASON_CODES.UNKNOWN_FIELD
      ) {
        const nested = path.includes(".") || path.includes("[");
        const message = nested
          ? `unknown field: ${path}`
          : `unknown top-level field: ${path}`;
        fail("E_ARTIFACT_SHAPE", message, { path });
      }
      fail(
        "E_ARTIFACT_SHAPE",
        `${rejection.location} ${reason}`,
        { path },
      );
    },
  );
}

function validateNonnegativeRange(range, label) {
  if (range.startUtf8 < 0) {
    fail("E_ARTIFACT_SHAPE", `${label}.startUtf8 must not be negative`);
  }
  if (range.endUtf8 < 0) {
    fail("E_ARTIFACT_SHAPE", `${label}.endUtf8 must not be negative`);
  }
}

function validateNonnegativeWireOffsets(ir) {
  if (ir.source.utf8ByteLength < 0) {
    fail("E_ARTIFACT_SHAPE", "source.utf8ByteLength must not be negative");
  }
  for (const [index, token] of ir.tokens.entries()) {
    validateNonnegativeRange(token.byteRange, `tokens[${index}].byteRange`);
  }
  for (const [index, node] of ir.structure.entries()) {
    validateNonnegativeRange(node.byteRange, `structure[${index}].byteRange`);
  }
  for (const [index, diagnostic] of ir.diagnostics.entries()) {
    validateNonnegativeRange(
      diagnostic.byteRange,
      `diagnostics[${index}].byteRange`,
    );
  }
  for (const [stepIndex, step] of ir.derivation.entries()) {
    for (const [rangeIndex, range] of step.sourceRanges.entries()) {
      validateNonnegativeRange(
        range,
        `derivation[${stepIndex}].sourceRanges[${rangeIndex}]`,
      );
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

// 5. Token range and layout validity, mirroring colorful_ir's deterministic
// token-index order. A token is non-empty, starts no earlier than its
// predecessor, and does not overlap it.
function validateTokenRangeBounds(buffer, ir) {
  let previousStart;
  let previousEnd;
  for (const [index, token] of ir.tokens.entries()) {
    validateByteRangeBounds(token.byteRange, buffer, `tokens[${index}].byteRange`);
    const { startUtf8, endUtf8 } = token.byteRange;
    if (startUtf8 === endUtf8) {
      fail("E_TOKEN_EMPTY", `tokens[${index}].byteRange must not be empty.`, {
        index,
        occurrenceId: token.occurrenceId,
      });
    }
    if (previousStart !== undefined && startUtf8 < previousStart) {
      fail(
        "E_TOKEN_UNSORTED",
        `tokens[${index}] starts at ${startUtf8}, before tokens[${index - 1}] starts at ${previousStart}.`,
        { index, startUtf8, previousIndex: index - 1, previousStart },
      );
    }
    if (previousEnd !== undefined && startUtf8 < previousEnd) {
      fail(
        "E_TOKEN_OVERLAP",
        `tokens[${index}] starts at ${startUtf8}, before tokens[${index - 1}] ends at ${previousEnd}.`,
        { index, startUtf8, previousIndex: index - 1, previousEnd },
      );
    }
    previousStart = startUtf8;
    previousEnd = endUtf8;
  }
}

// 6. Occurrence id uniqueness.
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

// 7. Token axis legality.
function validateTokenAxes(ir) {
  for (const [index, token] of ir.tokens.entries()) {
    const violation = tokenAxesViolation(token);
    if (violation) {
      fail("E_TOKEN_AXES", `tokens[${index}]: ${violation}.`, { index, detail: violation });
    }
  }
}

// 8. Structure graph: range validity, kind-depth pairs, unique ids, resolvable
// edges, single-parent ownership, parent containment, and acyclicity.
function validateStructure(buffer, ir) {
  const nodeIndices = new Map();
  const seen = new Set();
  for (const [index, node] of ir.structure.entries()) {
    validateByteRangeBounds(node.byteRange, buffer, `structure[${index}].byteRange`);
    if (seen.has(node.nodeId)) {
      fail("E_DUPLICATE_NODE_ID", `structure[${index}] reuses nodeId ${node.nodeId}.`, {
        index,
        nodeId: node.nodeId,
      });
    }
    seen.add(node.nodeId);
    if (!nodeIndices.has(node.nodeId)) nodeIndices.set(node.nodeId, index);
    const expectedDepth = node.kind === "PARAGRAPH" ? 0 : 1;
    if (node.depth !== expectedDepth) {
      fail("E_OUTLINE_DEPTH", `structure[${index}].depth is ${node.depth}; ${node.kind} requires ${expectedDepth}.`, {
        index,
        depth: node.depth,
        expectedDepth,
      });
    }
  }

  const parents = new Map();
  for (const [index, node] of ir.structure.entries()) {
    for (const [childIndex, child] of node.childNodeIds.entries()) {
      const childNodeIndex = nodeIndices.get(child);
      if (childNodeIndex === undefined) {
        fail("E_DANGLING_CHILD_REF", `structure[${index}].childNodeIds[${childIndex}] references missing child ${child}.`, {
          index,
          nodeId: node.nodeId,
          childIndex,
          child,
        });
      }
      const firstParent = parents.get(child);
      if (firstParent !== undefined && firstParent !== node.nodeId) {
        fail(
          "E_MULTIPLE_STRUCTURE_PARENTS",
          `structure[${index}].childNodeIds[${childIndex}] gives child ${child} a second parent.`,
          { index, childIndex, child, firstParent, secondParent: node.nodeId },
        );
      }
      if (firstParent === undefined) parents.set(child, node.nodeId);

      const childNode = ir.structure[childNodeIndex];
      if (
        childNode.byteRange.startUtf8 < node.byteRange.startUtf8 ||
        childNode.byteRange.endUtf8 > node.byteRange.endUtf8
      ) {
        fail(
          "E_CHILD_RANGE",
          `structure[${index}].childNodeIds[${childIndex}] names child ${child} outside parent ${node.nodeId}.`,
          { index, childIndex, parent: node.nodeId, child },
        );
      }
    }
  }

  // Iterative DFS keeps malicious graph depth off the JavaScript call stack.
  // Root and child iteration stay in wire order for deterministic failures.
  const colors = new Uint8Array(ir.structure.length);
  for (let root = 0; root < ir.structure.length; root += 1) {
    if (colors[root] !== 0) continue;
    colors[root] = 1;
    const stack = [{ nodeIndex: root, edgeIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      const node = ir.structure[frame.nodeIndex];
      if (frame.edgeIndex === node.childNodeIds.length) {
        colors[frame.nodeIndex] = 2;
        stack.pop();
        continue;
      }
      const edgeIndex = frame.edgeIndex;
      frame.edgeIndex += 1;
      const child = node.childNodeIds[edgeIndex];
      const childNodeIndex = nodeIndices.get(child);
      if (childNodeIndex === undefined) continue;
      if (colors[childNodeIndex] === 1) {
        fail(
          "E_STRUCTURE_CYCLE",
          `structure[${frame.nodeIndex}].childNodeIds[${edgeIndex}] closes a cycle from ${node.nodeId} to ${child}.`,
          { index: frame.nodeIndex, edgeIndex, parent: node.nodeId, child },
        );
      }
      if (colors[childNodeIndex] === 0) {
        colors[childNodeIndex] = 1;
        stack.push({ nodeIndex: childNodeIndex, edgeIndex: 0 });
      }
    }
  }
}

// Diagnostics and derivation ranges, plus derivation identity -- mirroring
// colorful_ir::validate_document exactly: each diagnostic/derivation range is
// checked the same way a token's is; derivation must be non-empty (an empty
// list claims no producer ran at all); each step's passId/ruleId must be
// non-empty (the invalid-by-construction PassIdentity default colorful-core
// reports when a producer never overrode it); and no two steps may share a
// passId.
function validateDiagnosticsAndDerivation(buffer, ir) {
  for (const [index, diagnostic] of ir.diagnostics.entries()) {
    validateByteRangeBounds(diagnostic.byteRange, buffer, `diagnostics[${index}].byteRange`);
  }

  if (ir.derivation.length === 0) {
    fail("E_EMPTY_DERIVATION", "derivation must not be empty; it would claim no producer ran at all.");
  }
  const seenPassIds = new Set();
  for (const [index, step] of ir.derivation.entries()) {
    for (const [rangeIndex, range] of step.sourceRanges.entries()) {
      validateByteRangeBounds(range, buffer, `derivation[${index}].sourceRanges[${rangeIndex}]`);
    }
    if (step.passId === "" || step.ruleId === "") {
      fail("E_MISSING_DERIVATION_IDENTITY", `derivation[${index}] has an empty passId or ruleId.`, { index });
    }
    if (seenPassIds.has(step.passId)) {
      fail("E_DUPLICATE_DERIVATION_PASS_ID", `derivation has two steps with passId "${step.passId}".`, {
        passId: step.passId,
      });
    }
    seenPassIds.add(step.passId);
  }
}

// The full admission gate. project() below runs this unconditionally; it is
// also exported so a caller can validate without projecting.
export function validateArtifact(buffer, ir) {
  validateWireContract(buffer, ir);
}

// The colorful.syntax/v1 wire-contract admission gate. validateArtifact is an
// intentionally equivalent product-facing name; the witness calls this name
// directly to make the shared Rust/JavaScript boundary explicit.
export function validateWireContract(buffer, ir) {
  validateGeneratedShape(ir);
  validateNonnegativeWireOffsets(ir);
  validateContractVersion(ir);
  validateByteLength(buffer, ir);
  validateSourceUtf8(buffer);
  validateTokenRangeBounds(buffer, ir);
  validateOccurrenceIds(ir);
  validateTokenAxes(ir);
  validateStructure(buffer, ir);
  validateDiagnosticsAndDerivation(buffer, ir);
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
