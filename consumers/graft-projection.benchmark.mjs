// Informational fixed-corpus benchmark for the complete Graft projection
// boundary. Correctness CI validates the checked-in report; it does not gate on
// these wall-clock measurements.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { project, schemaHash, vocabularyHash } from "./graft-projection.mjs";

const SAMPLE_COUNT = 9;
const CORPORA = [
  {
    id: "small",
    url: new URL(
      "../crates/colorful-cli/fixtures/editor-smoke-prose.txt",
      import.meta.url,
    ),
  },
  {
    id: "medium",
    url: new URL(
      "../crates/colorful-cli/fixtures/bench-corpus.txt",
      import.meta.url,
    ),
  },
];

function contentHash(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function benchmarkTokens(buffer) {
  const source = buffer.toString("utf8");
  assert.ok(
    Buffer.from(source, "utf8").equals(buffer),
    "benchmark corpus must be valid UTF-8",
  );
  assert.equal(
    Buffer.byteLength(source, "utf8"),
    source.length,
    "benchmark token offsets require the reviewed corpora to remain ASCII",
  );

  return Array.from(
    source.matchAll(/[A-Za-z]+|\d+/g),
    (match, occurrenceId) => {
      const number = /^\d+$/.test(match[0]);
      return {
        occurrenceId,
        byteRange: {
          startUtf8: match.index,
          endUtf8: match.index + match[0].length,
        },
        tokenKind: number ? "NUMBER" : "WORD",
        lexicalClass: number ? null : "CONTENT",
        functionKind: null,
        openClassKind: number ? null : "NOUN",
      };
    },
  );
}

function benchmarkArtifact(id, buffer, tokens) {
  return {
    contractVersion: "colorful.syntax/v1",
    schemaHash: schemaHash(),
    vocabularyHash: vocabularyHash(),
    source: {
      unitId: id,
      contentHash: contentHash(buffer),
      utf8ByteLength: buffer.length,
    },
    tokens,
    structure: [],
    diagnostics: [],
    derivation: [
      {
        passId: "benchmark-segment",
        ruleId: "fixed-corpus-tokenizer",
        sourceRanges: [{ startUtf8: 0, endUtf8: buffer.length }],
        compilerBuildHash: "graft-projection-benchmark/v1",
      },
      {
        passId: "benchmark-classify",
        ruleId: "fixed-corpus-noun-projection",
        sourceRanges: [{ startUtf8: 0, endUtf8: buffer.length }],
        compilerBuildHash: "graft-projection-benchmark/v1",
      },
    ],
  };
}

function medianNanoseconds(fn) {
  const samples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const started = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - started));
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

const measurements = CORPORA.map(({ id, url }) => {
  const buffer = readFileSync(url);
  const tokens = benchmarkTokens(buffer);
  const artifact = benchmarkArtifact(id, buffer, tokens);
  const warm = project(buffer, artifact);
  assert.equal(
    warm.syntax.spans.length,
    tokens.length,
    "every benchmark token must project",
  );

  const median = medianNanoseconds(() => {
    const bundle = project(buffer, artifact);
    assert.equal(bundle.syntax.spans.length, tokens.length);
  });
  assert.ok(median > 0, "projection duration must be positive");

  return {
    corpus: id,
    inputBytes: buffer.length,
    tokenCount: tokens.length,
    spanCount: warm.syntax.spans.length,
    medianNanoseconds: median,
    throughputBytesPerSecond: Math.floor(
      (buffer.length * 1_000_000_000) / median,
    ),
  };
});

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: "colorful.performance.graft-projection/v1",
      stage: "graft-projection",
      allocationAttribution: "unavailable-node-runtime",
      measurements,
    },
    null,
    2,
  )}\n`,
);
