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
  GraftProjectionError,
  makeByteToPoint,
  project,
  schemaHash,
  validateArtifact,
  validateVocabularyManifest,
  validateWireContract,
  verifyContentHash,
  verifySchemaHash,
  verifyVocabularyHash,
  vocabularyHash,
} from "./graft-projection.mjs";

function contentHash(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

// "é is\n😀 7\n": "is" (FUNCTION) at bytes 3..5, "7" (NUMBER) at bytes 11..12.
const source = Buffer.from("é is\n😀 7\n", "utf8");
assert.equal(source.length, 13, "fixture byte length");

function validIr(overrides = {}) {
  return {
    contractVersion: "colorful.syntax/v1",
    schemaHash: schemaHash(),
    vocabularyHash: vocabularyHash(),
    source: {
      unitId: "fixture",
      contentHash: contentHash(source),
      utf8ByteLength: source.length,
    },
    tokens: [
      {
        occurrenceId: 0,
        byteRange: { startUtf8: 3, endUtf8: 5 },
        tokenKind: "WORD",
        lexicalClass: "FUNCTION",
        functionKind: "AUXILIARY",
        openClassKind: null,
      },
      {
        occurrenceId: 1,
        byteRange: { startUtf8: 11, endUtf8: 12 },
        tokenKind: "NUMBER",
        lexicalClass: null,
        functionKind: null,
        openClassKind: null,
      },
    ],
    structure: [],
    diagnostics: [],
    derivation: [
      {
        passId: "segment",
        ruleId: "prose-segmenter",
        sourceRanges: [{ startUtf8: 0, endUtf8: source.length }],
        compilerBuildHash: "colorful-ir@0.0.0-fixture",
      },
      {
        passId: "classify",
        ruleId: "lexical-annotator",
        sourceRanges: [{ startUtf8: 0, endUtf8: source.length }],
        compilerBuildHash: "colorful-ir@0.0.0-fixture",
      },
    ],
    ...overrides,
  };
}

const ir = validIr();

function errorCode(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof GraftProjectionError, `expected a GraftProjectionError, got ${err}`);
    return err.code;
  }
  assert.fail("expected a GraftProjectionError to be thrown");
}

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

// The column counts Unicode *scalar values* (code points), not grapheme
// clusters: a combining mark is its own column, not merged into the base
// letter's, while a single-code-point emoji astride two UTF-16 units is
// still exactly one column. Call this a "code-point column", not a "visual
// column" -- it does not match what a person would count as one glyph.
{
  // "e" (1 byte) + U+0301 COMBINING ACUTE ACCENT (2 bytes), then " x".
  const combining = Buffer.from("é x", "utf8");
  const atCombining = makeByteToPoint(combining);
  assert.deepEqual(
    atCombining(3),
    { row: 0, column: 2 },
    "a combining mark is a second column, not merged into the base letter",
  );

  // "é" precomposed (U+00E9, 2 bytes), then " x".
  const precomposed = Buffer.from("é x", "utf8");
  const atPrecomposed = makeByteToPoint(precomposed);
  assert.deepEqual(
    atPrecomposed(2),
    { row: 0, column: 1 },
    "a precomposed accented letter is one column",
  );

  // "😀" (4 UTF-8 bytes, 2 UTF-16 units, 1 code point), then " x".
  const emoji = Buffer.from("😀 x", "utf8");
  const atEmoji = makeByteToPoint(emoji);
  assert.deepEqual(
    atEmoji(4),
    { row: 0, column: 1 },
    "a single-code-point emoji is one column despite two UTF-16 units",
  );
}

// A caller that queries offsets out of order (project() never does, but
// makeByteToPoint is also exported on its own) still gets correct answers via
// binary search, not a stale forward-only cursor.
{
  const multiline = Buffer.from("aaa\nbbb\nccc\nddd\n", "utf8");
  const atBackward = makeByteToPoint(multiline);
  assert.deepEqual(atBackward(12), { row: 3, column: 0 }, "forward to the last line");
  assert.deepEqual(atBackward(0), { row: 0, column: 0 }, "then backward to the first line");
  assert.deepEqual(atBackward(8), { row: 2, column: 0 }, "then backward to a middle line");
  assert.deepEqual(atBackward(12), { row: 3, column: 0 }, "then forward again to the last line");
}

// Deterministic complexity check: sequential forward calls (project()'s
// actual call pattern, given validated wire-order tokens) advance the cursor
// a total of at most `lineCount` times across the *entire* run, not per
// call -- proving the monotonic-cursor optimization is real, without timing
// anything. A row-0 rescan on every call would instead accumulate roughly
// lineCount*(lineCount-1)/2 advances (~2,000,000 here), which this bound
// would catch deterministically.
{
  const lineCount = 2000;
  const lines = Array.from({ length: lineCount }, (_, i) => `line number ${i}`);
  const manyLines = Buffer.from(lines.join("\n"), "utf8");
  const lineByteOffsets = [];
  let cumulative = 0;
  for (const line of lines) {
    lineByteOffsets.push(cumulative);
    cumulative += Buffer.byteLength(line, "utf8") + 1;
  }
  const atMany = makeByteToPoint(manyLines);
  for (const offset of lineByteOffsets) atMany(offset);
  assert.ok(
    atMany.stats.advances <= lineCount,
    `expected at most ${lineCount} cursor advances across ${lineCount} sequential forward calls, got ${atMany.stats.advances}`,
  );
}

// Human benchmark: informational, not a correctness gate. Wall-clock time is
// evidence, not proof -- CI contention, JIT warmup, and thermal throttling
// can make even a real O(1)-amortized algorithm's wall-clock ratio noisy at
// these sizes, so this reports median-of-several-samples timings after a
// warmup run rather than asserting a specific ratio. The deterministic
// complexity check above is the actual regression gate.
{
  function medianDurationMs(fn, samples = 7) {
    const durations = [];
    for (let i = 0; i < samples; i += 1) {
      const start = process.hrtime.bigint();
      fn();
      durations.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    durations.sort((a, b) => a - b);
    return durations[Math.floor(durations.length / 2)];
  }

  function benchmarkSequentialCalls(lineCount) {
    const lines = Array.from({ length: lineCount }, (_, i) => `line number ${i} of prose`);
    const text = Buffer.from(lines.join("\n"), "utf8");
    const offsets = [];
    let cumulative = 0;
    for (const line of lines) {
      offsets.push(cumulative);
      cumulative += Buffer.byteLength(line, "utf8") + 1;
    }
    return medianDurationMs(() => {
      const at = makeByteToPoint(text);
      for (const offset of offsets) at(offset);
    });
  }

  benchmarkSequentialCalls(500); // warm up the JIT before measuring
  const small = benchmarkSequentialCalls(2000);
  const large = benchmarkSequentialCalls(8000);
  console.log(
    `graft-projection: byteToPoint sequential-call benchmark -- ` +
      `2000 lines: ${small.toFixed(3)}ms, 8000 lines: ${large.toFixed(3)}ms ` +
      `(informational; the deterministic complexity check above is the actual regression gate)`,
  );
}

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

function withClassRolePatch(source, axes, patch) {
  const index = source.classRoles.findIndex(
    (rule) =>
      rule.tokenKind === axes.tokenKind &&
      rule.lexicalClass === axes.lexicalClass &&
      rule.openClassKind === axes.openClassKind,
  );
  assert.notEqual(index, -1, `missing class role ${JSON.stringify(axes)}`);
  return {
    ...source,
    classRoles: source.classRoles.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, ...patch } : rule,
    ),
  };
}

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
    validateVocabularyManifest(
      withClassRolePatch(
        manifest,
        { tokenKind: "WORD", lexicalClass: "FUNCTION", openClassKind: null },
        { openClassKind: "NOUN" },
      ),
    ),
  /openClassKind/,
  "closed-class roles must not carry openClassKind",
);
assert.throws(
  () =>
    validateVocabularyManifest(
      withClassRolePatch(
        manifest,
        { tokenKind: "NUMBER", lexicalClass: null, openClassKind: null },
        { openClassKind: "NOUN" },
      ),
    ),
  /openClassKind/,
  "non-word roles must not carry openClassKind",
);

// ---- validateArtifact: reject, never clamp ---------------------------------

// A valid artifact passes cleanly.
assert.doesNotThrow(() => validateArtifact(source, ir));

// 1. Top-level shape: malformed input fails with a stable code, not a raw
// "Cannot read properties of undefined" a few checks later.
assert.equal(errorCode(() => validateArtifact(source, null)), "E_ARTIFACT_SHAPE");
assert.equal(errorCode(() => validateArtifact(source, validIr({ tokens: "nope" }))), "E_ARTIFACT_SHAPE");
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ unexpectedField: "surprise" }))),
  "E_ARTIFACT_SHAPE",
  "an unknown top-level field must be rejected, not silently ignored",
);
// Unknown fields nested below the document root must be rejected too, not
// just at the top level -- every generated DTO shape gets the same check.
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ source: { ...ir.source, extra: "surprise" } }))),
  "E_ARTIFACT_SHAPE",
  "an unknown field on source must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(source, validIr({ tokens: [{ ...ir.tokens[0], extra: "surprise" }, ir.tokens[1]] })),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown field on a token must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        tokens: [
          { ...ir.tokens[0], byteRange: { ...ir.tokens[0].byteRange, extra: "surprise" } },
          ir.tokens[1],
        ],
      }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown field on a byteRange must be rejected (covers tokens/structure/diagnostics/derivation alike)",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        diagnostics: [
          {
            byteRange: { startUtf8: 0, endUtf8: 1 },
            severity: "INFO",
            code: "x",
            message: "y",
            extra: "surprise",
          },
        ],
      }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown field on a diagnostic must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(source, validIr({ derivation: [{ ...ir.derivation[0], extra: "surprise" }, ir.derivation[1]] })),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown field on a derivation step must be rejected",
);
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ source: { ...ir.source, utf8ByteLength: "13" } }))),
  "E_ARTIFACT_SHAPE",
  "a non-integer utf8ByteLength must be rejected before it's ever compared",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], occurrenceId: 1.5 }, ir.tokens[1]] }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "a non-integer occurrenceId must be rejected",
);

// 2. Contract version.
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ contractVersion: "colorful.syntax/v2" }))),
  "E_CONTRACT_VERSION",
);

// 3. Byte length.
assert.equal(
  errorCode(() =>
    validateArtifact(source, validIr({ source: { ...ir.source, utf8ByteLength: source.length + 1 } })),
  ),
  "E_BYTE_LENGTH",
);

// 4. Source UTF-8 validity: a lone continuation byte is not valid UTF-8.
const invalidUtf8 = Buffer.from([0x80]);
assert.equal(
  errorCode(() => validateArtifact(invalidUtf8, validIr({ source: { ...ir.source, utf8ByteLength: 1 } }))),
  "E_SOURCE_UTF8",
);

// 5. Token range/boundary validity: out of order, out of bounds, and split
// UTF-8 boundaries are each rejected under their own code -- never sorted or
// clamped into validity.
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], byteRange: { startUtf8: 5, endUtf8: 3 } }, ir.tokens[1]] }),
    ),
  ),
  "E_BYTE_RANGE_ORDER",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        tokens: [{ ...ir.tokens[0], byteRange: { startUtf8: 0, endUtf8: source.length + 5 } }, ir.tokens[1]],
      }),
    ),
  ),
  "E_BYTE_RANGE_BOUNDS",
);
assert.equal(
  errorCode(() =>
    // Byte 1 splits "é" (0xC3 0xA9): not a char boundary.
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], byteRange: { startUtf8: 1, endUtf8: 4 } }, ir.tokens[1]] }),
    ),
  ),
  "E_BYTE_RANGE_BOUNDARY",
);

// Zero-width tokens are allowed, matching colorful_ir::validate_document's own
// `start <= end` (not `<`) check.
assert.doesNotThrow(() =>
  validateArtifact(
    source,
    validIr({ tokens: [{ ...ir.tokens[0], byteRange: { startUtf8: 5, endUtf8: 5 } }, ir.tokens[1]] }),
  ),
);

// 6. Token order: out-of-order or overlapping tokens are rejected, never
// silently sorted into validity.
assert.equal(
  errorCode(() =>
    validateArtifact(source, validIr({ tokens: [ir.tokens[1], ir.tokens[0]] })),
  ),
  "E_TOKEN_ORDER",
  "wire order must be honored, not re-sorted",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        tokens: [ir.tokens[0], { ...ir.tokens[1], byteRange: { startUtf8: 4, endUtf8: 6 } }],
      }),
    ),
  ),
  "E_TOKEN_ORDER",
  "an overlapping second token must be rejected",
);

// Wire-order enforcement is graft-projection-specific (for makeByteToPoint's
// monotonic cursor), not part of the colorful.syntax/v1 wire contract --
// colorful_ir::validate_document deliberately leaves inter-token layout
// unchecked, so validateWireContract (what the IR round-trip witness uses)
// must accept the same reordered-but-otherwise-valid document
// validateArtifact rejects. If this ever throws, the witness has become
// stricter than the Rust contract validator it round-trips against.
assert.doesNotThrow(
  () => validateWireContract(source, validIr({ tokens: [ir.tokens[1], ir.tokens[0]] })),
  "validateWireContract must not enforce graft's token-order requirement",
);

// 7. Occurrence id uniqueness.
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [ir.tokens[0], { ...ir.tokens[1], occurrenceId: 0 }] }),
    ),
  ),
  "E_DUPLICATE_OCCURRENCE_ID",
);

// 8. Token axis legality, mirroring colorful_ir's token_axes_violation.
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], lexicalClass: null }, ir.tokens[1]] }),
    ),
  ),
  "E_TOKEN_AXES",
  "a WORD without a lexicalClass must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [ir.tokens[0], { ...ir.tokens[1], openClassKind: "NOUN" }] }),
    ),
  ),
  "E_TOKEN_AXES",
  "a NUMBER carrying an openClassKind must be rejected",
);

// 9. Structure graph: duplicate node ids and dangling child references are
// rejected; range containment and cycles are deliberately not checked here,
// mirroring colorful_ir::validate_document's own scope exactly.
const paragraph = { nodeId: 0, kind: "PARAGRAPH", byteRange: { startUtf8: 0, endUtf8: 5 }, depth: 0, childNodeIds: [1] };
const sentence = { nodeId: 1, kind: "SENTENCE", byteRange: { startUtf8: 0, endUtf8: 5 }, depth: 1, childNodeIds: [] };
assert.doesNotThrow(() => validateArtifact(source, validIr({ structure: [paragraph, sentence] })));
assert.equal(
  errorCode(() =>
    validateArtifact(source, validIr({ structure: [paragraph, sentence, { ...sentence }] })),
  ),
  "E_DUPLICATE_NODE_ID",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ structure: [{ ...paragraph, childNodeIds: [9999] }, sentence] }),
    ),
  ),
  "E_DANGLING_CHILD_REF",
);

// Enum fields are checked against the actual wire schema, not just "is a
// string" -- an unknown value is rejected at admission instead of later
// throwing an ordinary Error from deep inside projection.
assert.equal(
  errorCode(() =>
    validateArtifact(source, validIr({ tokens: [{ ...ir.tokens[0], tokenKind: "BOGUS" }, ir.tokens[1]] })),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown tokenKind must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], functionKind: "BOGUS" }, ir.tokens[1]] }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown functionKind must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [ir.tokens[0], { ...ir.tokens[1], tokenKind: "NUMBER", openClassKind: "BOGUS" }] }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "an unknown openClassKind must be rejected",
);
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ structure: [{ ...paragraph, kind: "BOGUS" }] }))),
  "E_ARTIFACT_SHAPE",
  "an unknown outline node kind must be rejected",
);
// className()/visualRole() on their own still reject illegal axes under the
// same stable code, for a caller that bypasses validateArtifact entirely.
assert.equal(errorCode(() => className({ tokenKind: "WORD" })), "E_TOKEN_AXES");

// Integer fields are held to the actual colorful.syntax/v1 wire range
// (signed i32), not just "any JS safe integer" -- a value the generated
// Rust DTO could never deserialize is rejected at admission.
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], occurrenceId: 2 ** 40 }, ir.tokens[1]] }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "an occurrenceId beyond the i32 range must be rejected",
);
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ structure: [{ ...paragraph, nodeId: 2 ** 40 }] }))),
  "E_ARTIFACT_SHAPE",
  "a nodeId beyond the i32 range must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ tokens: [{ ...ir.tokens[0], byteRange: { startUtf8: 0, endUtf8: 2 ** 40 } }, ir.tokens[1]] }),
    ),
  ),
  "E_ARTIFACT_SHAPE",
  "a byteRange endUtf8 beyond the i32 range must be rejected",
);

// Diagnostics and derivation are validated too: a missing/empty derivation
// claims no producer ran at all, and per-step identity is checked exactly
// like from_classification's producer-side check.
assert.equal(
  errorCode(() => validateArtifact(source, validIr({ derivation: [] }))),
  "E_EMPTY_DERIVATION",
  "an empty derivation must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ derivation: [{ ...ir.derivation[0], passId: "" }, ir.derivation[1]] }),
    ),
  ),
  "E_MISSING_DERIVATION_IDENTITY",
  "an empty passId must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ derivation: [ir.derivation[0], { ...ir.derivation[1], passId: ir.derivation[0].passId }] }),
    ),
  ),
  "E_DUPLICATE_DERIVATION_PASS_ID",
  "two derivation steps sharing a passId must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        derivation: [
          { ...ir.derivation[0], sourceRanges: [{ startUtf8: 0, endUtf8: source.length + 5 }] },
          ir.derivation[1],
        ],
      }),
    ),
  ),
  "E_BYTE_RANGE_BOUNDS",
  "a derivation source range exceeding the source length must be rejected",
);
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({ diagnostics: [{ byteRange: { startUtf8: 0, endUtf8: source.length + 5 }, severity: "ERROR", code: "x", message: "x" }] }),
    ),
  ),
  "E_BYTE_RANGE_BOUNDS",
  "a diagnostic range exceeding the source length must be rejected",
);

// 10. Hashes run last, and in a fixed order: schemaHash, then
// vocabularyHash, then contentHash. Corrupting all three at once must
// surface schemaHash's failure, not whichever the runtime happens to notice
// first.
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        schemaHash: "sha256:deadbeef",
        vocabularyHash: "sha256:deadbeef",
        source: { ...ir.source, contentHash: "sha256:deadbeef" },
      }),
    ),
  ),
  "E_SCHEMA_HASH",
  "schemaHash must be checked, and reported, before vocabularyHash or contentHash",
);

// Failure precedence between the cheap structural checks: a wrong byte length
// alongside a wrong content hash must surface E_BYTE_LENGTH, since byte length
// is checked long before any hash.
assert.equal(
  errorCode(() =>
    validateArtifact(
      source,
      validIr({
        source: { ...ir.source, utf8ByteLength: source.length + 1, contentHash: "sha256:deadbeef" },
      }),
    ),
  ),
  "E_BYTE_LENGTH",
);

// verifySchemaHash on its own: missing and mismatched schemaHash are each
// rejected.
assert.throws(() => verifySchemaHash({}), /missing schemaHash/, "missing schemaHash must be rejected");
assert.throws(
  () => verifySchemaHash({ schemaHash: "sha256:deadbeef" }),
  /schemaHash/,
  "schema drift must be rejected",
);

console.log("graft-projection: all assertions passed");
