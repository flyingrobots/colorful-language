// Test for the graft reference consumer's coordinate handling.
//
// Run: node consumers/graft-projection.test.mjs
//
// The fixture puts a multibyte character before a highlighted token on every
// line — "é" (2 bytes, 1 UTF-16 unit) and "😀" (4 bytes, 2 UTF-16 units) — which
// is exactly what a UTF-16-indexed projection corrupts. These assertions pin the
// byte-correct behavior and the contentHash guard.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { makeByteToPoint, project, verifyContentHash } from "./graft-projection.mjs";

function contentHash(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

// "é is\n😀 7\n": "is" (FUNCTION) at bytes 3..5, "7" (NUMBER) at bytes 11..12.
const source = Buffer.from("é is\n😀 7\n", "utf8");
assert.equal(source.length, 13, "fixture byte length");

const ir = {
  source: {
    unitId: "fixture",
    contentHash: contentHash(source),
    utf8ByteLength: source.length,
  },
  tokens: [
    { byteRange: { startUtf8: 3, endUtf8: 5 }, tokenKind: "WORD", lexicalClass: "FUNCTION" },
    { byteRange: { startUtf8: 11, endUtf8: 12 }, tokenKind: "NUMBER" },
  ],
};

// byte -> point counts code points from the line start and tracks bytes, not
// UTF-16 units, on both the "é" line and the "😀" line.
const at = makeByteToPoint(source);
assert.deepEqual(at(3), { row: 0, column: 2 }, "after 'é '");
assert.deepEqual(at(5), { row: 0, column: 4 }, "after 'é is'");
assert.deepEqual(at(11), { row: 1, column: 2 }, "after '😀 ' on line 1");
assert.deepEqual(at(12), { row: 1, column: 3 }, "after '😀 7'");

// The full projection maps both tokens to the right line/column spans.
assert.deepEqual(project(source, ir), {
  syntax: {
    partial: false,
    spans: [
      { className: "keyword", range: { start: { row: 0, column: 2 }, end: { row: 0, column: 4 } } },
      { className: "number", range: { start: { row: 1, column: 2 }, end: { row: 1, column: 3 } } },
    ],
  },
});

// A source whose bytes do not hash to the IR's contentHash is rejected.
assert.throws(
  () => verifyContentHash(Buffer.from("different bytes", "utf8"), ir),
  /contentHash/,
  "mismatched source must be rejected",
);

// CR/CRLF line breaks are recognized like the LSP model.
const mixed = Buffer.from("a\r\nb\rc", "utf8");
const atMixed = makeByteToPoint(mixed);
assert.deepEqual(atMixed(3), { row: 1, column: 0 }, "'b' after CRLF");
assert.deepEqual(atMixed(5), { row: 2, column: 0 }, "'c' after lone CR");

console.log("graft-projection: all assertions passed");
