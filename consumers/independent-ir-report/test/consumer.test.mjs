import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ConsumerError,
  consumeAnsi,
  consumeIr,
  consumeLsp,
  loadProfile,
} from "../src/index.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const SOURCE = readFileSync(path.join(FIXTURES, "source.txt"), "utf8");

function releaseFixture(release) {
  const directory = path.join(FIXTURES, "releases", release);
  return {
    profile: loadProfile(directory),
    ir: readFileSync(path.join(directory, "ir.json"), "utf8"),
  };
}

function expectConsumerError(code, operation) {
  assert.throws(
    operation,
    (error) => error instanceof ConsumerError && error.code === code,
  );
}

test("both released IR generations migrate into reviewed reports", () => {
  for (const release of ["v0.2.1", "v0.3.0"]) {
    const { ir, profile } = releaseFixture(release);
    const expected = readFileSync(
      path.join(FIXTURES, "expected", `${release}.md`),
      "utf8",
    );
    assert.equal(
      consumeIr({ source: SOURCE, artifactJson: ir, profiles: [profile] }),
      expected,
    );
  }
});

test("IR, ANSI CLI text, and LSP tokens render the same v0.3.0 job", () => {
  const { ir, profile } = releaseFixture("v0.3.0");
  const directory = path.join(FIXTURES, "releases", "v0.3.0");
  const expected = readFileSync(
    path.join(FIXTURES, "expected", "v0.3.0.md"),
    "utf8",
  );

  assert.equal(
    consumeIr({ source: SOURCE, artifactJson: ir, profiles: [profile] }),
    expected,
  );
  assert.equal(
    consumeAnsi({
      source: SOURCE,
      ansiText: readFileSync(path.join(directory, "ansi.txt"), "utf8"),
      profile,
    }),
    expected,
  );
  assert.equal(
    consumeLsp({
      source: SOURCE,
      responseJson: readFileSync(path.join(directory, "lsp.json"), "utf8"),
      profile,
    }),
    expected,
  );
});

test("IR admission rejects malformed and incompatible artifacts by category", () => {
  const oldFixture = releaseFixture("v0.2.1");
  const currentFixture = releaseFixture("v0.3.0");
  const profiles = [oldFixture.profile, currentFixture.profile];
  const baseline = JSON.parse(currentFixture.ir);
  const mutationCases = [
    ["E_JSON", "{"],
    [
      "E_CONTRACT_VERSION",
      JSON.stringify({ ...baseline, contractVersion: "colorful.syntax/v2" }),
    ],
    [
      "E_SCHEMA_HASH",
      JSON.stringify({ ...baseline, schemaHash: "sha256:wrong" }),
    ],
    [
      "E_VOCABULARY_HASH",
      JSON.stringify({
        ...baseline,
        vocabularyHash: oldFixture.profile.vocabularyHash,
      }),
    ],
    [
      "E_SOURCE_LENGTH",
      JSON.stringify({
        ...baseline,
        source: { ...baseline.source, utf8ByteLength: 1 },
      }),
    ],
    [
      "E_SOURCE_HASH",
      JSON.stringify({
        ...baseline,
        source: { ...baseline.source, contentHash: "sha256:wrong" },
      }),
    ],
    [
      "E_SHAPE",
      JSON.stringify({ ...baseline, tokens: [{ occurrenceId: 0 }] }),
    ],
    [
      "E_RANGE",
      JSON.stringify({
        ...baseline,
        tokens: baseline.tokens.map((token, index) =>
          index === 0
            ? {
                ...token,
                byteRange: { ...token.byteRange, startUtf8: 1 },
              }
            : token,
        ),
      }),
    ],
  ];

  for (const [code, artifactJson] of mutationCases) {
    expectConsumerError(code, () =>
      consumeIr({ source: SOURCE, artifactJson, profiles }),
    );
  }
});

test("the process boundary emits no report for an invalid artifact", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "bin", "report.mjs"),
      "--format",
      "ir",
      "--source",
      path.join(FIXTURES, "source.txt"),
      "--input",
      path.join(FIXTURES, "negative", "wrong-contract.json"),
      "--profiles",
      path.join(FIXTURES, "releases"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^independent-ir-report: E_CONTRACT_VERSION:/);
});
