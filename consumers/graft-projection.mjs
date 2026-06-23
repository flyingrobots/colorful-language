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

function loadVocabulary() {
  const bytes = readFileSync(MANIFEST_URL); // raw bytes, so the hash matches the producer
  const manifest = JSON.parse(bytes.toString("utf8"));
  return {
    hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    classRoles: manifest.classRoles,
    projectionByRole: new Map(manifest.roleProjections.map((p) => [p.visualRole, p])),
  };
}

const VOCABULARY = loadVocabulary();

// The abstract VisualRole for a token's axes, per the manifest (a WORD is keyed
// by lexicalClass; every other tokenKind ignores it).
function visualRole(token) {
  for (const rule of VOCABULARY.classRoles) {
    const kindMatches = rule.tokenKind === token.tokenKind;
    const classMatches =
      rule.lexicalClass == null || rule.lexicalClass === (token.lexicalClass ?? null);
    if (kindMatches && classMatches) return rule.visualRole;
  }
  return "UNSTYLED";
}

// colorful.syntax/v1 token -> graft syntax class, via the manifest's role
// projection (skeleton: content/punct project to no class).
export function className(token) {
  const projection = VOCABULARY.projectionByRole.get(visualRole(token));
  return projection?.graftClass ?? undefined;
}

// Reject an artifact whose vocabularyHash does not match the manifest this
// consumer holds — its colors would otherwise be projected through a different
// vocabulary than the producer intended.
export function verifyVocabularyHash(ir) {
  const expected = ir?.vocabularyHash;
  if (typeof expected !== "string") {
    throw new Error("IR is missing vocabularyHash; refusing to project.");
  }
  if (expected !== VOCABULARY.hash) {
    throw new Error(
      `IR vocabularyHash (${expected}) does not match this consumer's manifest (${VOCABULARY.hash}); refusing to project.`,
    );
  }
}

// The hash of the vocabulary manifest this consumer is bound to.
export function vocabularyHash() {
  return VOCABULARY.hash;
}

// Build a UTF-8 byte offset -> { row, column } mapper over the raw source bytes.
// Line breaks follow the LSP set (`\n`, `\r\n`, bare `\r`) so rows agree with the
// language server. The column counts Unicode scalar values from the line start,
// decoding only the prefix it needs.
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
  return (byte) => {
    const offset = Math.max(0, Math.min(byte, buffer.length));
    let row = 0;
    while (row + 1 < lineStarts.length && lineStarts[row + 1] <= offset) row += 1;
    const lineStart = lineStarts[row];
    const column = [...buffer.subarray(lineStart, offset).toString("utf8")].length;
    return { row, column };
  };
}

// Reject a source whose bytes do not hash to the IR's declared `contentHash`.
// A coordinate is only meaningful against the exact bytes it was computed over.
export function verifyContentHash(buffer, ir) {
  const expected = ir?.source?.contentHash;
  if (typeof expected !== "string") {
    throw new Error("IR is missing source.contentHash; refusing to project.");
  }
  const actual = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  if (actual !== expected) {
    throw new Error(
      `source does not match IR contentHash (expected ${expected}, got ${actual}); refusing to project.`,
    );
  }
}

// Project an IR document (already parsed) over its source bytes into graft's
// projection-bundle shape (the thing jedit's adapter reads).
export function project(buffer, ir) {
  verifyContentHash(buffer, ir);
  verifyVocabularyHash(ir);
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
