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
import {
  className,
  makeByteToPoint,
  project,
  verifyContentHash,
  verifyVocabularyHash,
  validateVocabularyManifest,
  vocabularyHash,
} from "./graft-projection.mjs";

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
  vocabularyHash: vocabularyHash(),
  tokens: [
    {
      byteRange: { startUtf8: 3, endUtf8: 5 },
      tokenKind: "WORD",
      lexicalClass: "FUNCTION",
      functionKind: "AUXILIARY",
      openClassKind: null,
    },
    {
      byteRange: { startUtf8: 11, endUtf8: 12 },
      tokenKind: "NUMBER",
      lexicalClass: null,
      functionKind: null,
      openClassKind: null,
    },
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

// className derives from the vocabulary manifest, including a WORD disambiguated
// by lexicalClass, optional openClassKind, and the unstyled fall-through.
assert.equal(className({ tokenKind: "WORD", lexicalClass: "PROPER_NOUN_CANDIDATE" }), "type");
assert.equal(className({ tokenKind: "QUOTE" }), "string");
assert.equal(className({ tokenKind: "WORD", lexicalClass: "CONTENT" }), undefined);
assert.equal(className({ tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "NOUN" }), "noun");
assert.equal(className({ tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "VERB" }), "verb");
assert.equal(
  className({ tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "ADJECTIVE" }),
  "adjective",
);
assert.equal(
  className({ tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "ADVERB" }),
  "adverb",
);
assert.equal(className({ tokenKind: "PUNCTUATION" }), undefined);
assert.throws(
  () => className({ tokenKind: "WORD" }),
  /no vocabulary role/,
  "invalid token axes must not silently fall through",
);

// An artifact whose vocabularyHash does not match the consumer's manifest is
// rejected — its colors would otherwise come from a different vocabulary.
assert.throws(
  () => verifyVocabularyHash({ vocabularyHash: "sha256:deadbeef" }),
  /vocabularyHash/,
  "vocabulary drift must be rejected",
);
assert.throws(
  () => verifyVocabularyHash({}),
  /missing vocabularyHash/,
  "missing vocabularyHash must be rejected",
);

const manifest = {
  version: "colorful.vocabulary/v1",
  classRoles: [
    {
      tokenKind: "WORD",
      lexicalClass: "FUNCTION",
      openClassKind: null,
      visualRole: "STRUCTURAL_KEYWORD",
    },
    {
      tokenKind: "WORD",
      lexicalClass: "PROPER_NOUN_CANDIDATE",
      openClassKind: null,
      visualRole: "TYPE_LIKE",
    },
    { tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: null, visualRole: "UNSTYLED" },
    { tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "NOUN", visualRole: "NOUN" },
    { tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "VERB", visualRole: "VERB" },
    {
      tokenKind: "WORD",
      lexicalClass: "CONTENT",
      openClassKind: "ADJECTIVE",
      visualRole: "ADJECTIVE",
    },
    { tokenKind: "WORD", lexicalClass: "CONTENT", openClassKind: "ADVERB", visualRole: "ADVERB" },
    { tokenKind: "NUMBER", lexicalClass: null, openClassKind: null, visualRole: "LITERAL" },
    { tokenKind: "PUNCTUATION", lexicalClass: null, openClassKind: null, visualRole: "MUTED" },
    { tokenKind: "QUOTE", lexicalClass: null, openClassKind: null, visualRole: "QUOTED" },
  ],
  roleProjections: [
    {
      visualRole: "STRUCTURAL_KEYWORD",
      ansi: "1;35",
      lspTokenType: "keyword",
      graftClass: "keyword",
    },
    { visualRole: "TYPE_LIKE", ansi: "1;33", lspTokenType: "class", graftClass: "type" },
    { visualRole: "LITERAL", ansi: "36", lspTokenType: "number", graftClass: "number" },
    { visualRole: "QUOTED", ansi: "32", lspTokenType: "string", graftClass: "string" },
    { visualRole: "MUTED", ansi: "90", lspTokenType: null, graftClass: null },
    { visualRole: "UNSTYLED", ansi: null, lspTokenType: null, graftClass: null },
    { visualRole: "NOUN", ansi: "34", lspTokenType: "noun", graftClass: "noun" },
    { visualRole: "VERB", ansi: "31", lspTokenType: "verb", graftClass: "verb" },
    { visualRole: "ADJECTIVE", ansi: "33", lspTokenType: "adjective", graftClass: "adjective" },
    { visualRole: "ADVERB", ansi: "35", lspTokenType: "adverb", graftClass: "adverb" },
  ],
};
assert.doesNotThrow(() => validateVocabularyManifest(manifest));
assert.throws(
  () => validateVocabularyManifest({ ...manifest, version: "colorful.vocabulary/v2" }),
  /version/,
  "wrong manifest version must be rejected",
);
assert.throws(
  () =>
    validateVocabularyManifest({
      ...manifest,
      classRoles: [
        { ...manifest.classRoles[0], visualRole: "STRUCTURAL_KEYWROD" },
        ...manifest.classRoles.slice(1),
      ],
    }),
  /unknown visualRole/,
  "unknown roles must be rejected",
);
assert.throws(
  () =>
    validateVocabularyManifest({
      ...manifest,
      roleProjections: manifest.roleProjections.slice(0, -1),
    }),
  /roleProjections is missing/,
  "missing role projections must be rejected",
);
assert.throws(
  () =>
    validateVocabularyManifest({
      ...manifest,
      roleProjections: [
        { ...manifest.roleProjections[0], graftClass: 42 },
        ...manifest.roleProjections.slice(1),
      ],
    }),
  /graftClass/,
  "non-string projection fields must be rejected",
);
assert.throws(
  () =>
    validateVocabularyManifest({
      ...manifest,
      classRoles: [manifest.classRoles[0], ...manifest.classRoles],
    }),
  /duplicate class role/,
  "duplicate class rules must be rejected",
);
assert.throws(
  () =>
    validateVocabularyManifest({
      ...manifest,
      classRoles: [
        { ...manifest.classRoles[0], openClassKind: "NOUN" },
        ...manifest.classRoles.slice(1),
      ],
    }),
  /openClassKind/,
  "closed-class roles must not carry openClassKind",
);
assert.throws(
  () =>
    validateVocabularyManifest({
      ...manifest,
      classRoles: [
        ...manifest.classRoles.slice(0, 7),
        { ...manifest.classRoles[7], openClassKind: "NOUN" },
        ...manifest.classRoles.slice(8),
      ],
    }),
  /openClassKind/,
  "non-word roles must not carry openClassKind",
);

console.log("graft-projection: all assertions passed");
