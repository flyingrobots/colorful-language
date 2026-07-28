import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ConsumerError,
  consumeAnsi,
  consumeIr,
  consumeLsp,
  loadProfile,
} from "../src/index.mjs";
import { renderReport } from "../src/common.mjs";
import { buildLspFixture } from "../src/lsp-fixture.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const SOURCE = readFileSync(path.join(FIXTURES, "source.txt"), "utf8");

test("the independent package enforces its pinned Node engine", () => {
  assert.equal(
    readFileSync(path.join(ROOT, ".npmrc"), "utf8"),
    "engine-strict=true\n",
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.deepEqual(packageJson.engines, { node: ">=22.23.1 <23" });
});

test("Markdown reports escape table delimiters inside code spans", () => {
  assert.equal(
    renderReport([
      {
        startUtf8: 0,
        endUtf8: 3,
        text: "a|b",
        role: "role|name",
      },
    ]),
    "# Highlight spans\n\n" +
      "| UTF-8 bytes | Text | Role |\n" +
      "| --- | --- | --- |\n" +
      "| `0..3` | `a\\|b` | `role\\|name` |\n",
  );
});

test("the effort ledger counts protocol-specific acquisition code", () => {
  const ledger = JSON.parse(
    readFileSync(path.join(ROOT, "evidence", "integration-effort.json"), "utf8"),
  );
  assert.deepEqual(ledger.adapters.ir.sources, ["src/ir.mjs"]);
  assert.deepEqual(ledger.adapters.ansi.sources, ["src/ansi.mjs"]);
  assert.deepEqual(ledger.adapters.lsp.sources, [
    "src/lsp.mjs",
    "src/lsp-fixture.mjs",
    "scripts/capture-lsp.mjs",
  ]);
  assert.equal(ledger.adapters.ir.reviewedAssertions, 39);
  assert.equal(ledger.result.smallestAdapter, false);
  assert.equal(ledger.result.decision, "retain-stable-v1");
});

test("the retention rule honors both documented decision branches", async () => {
  const { decideIrContract } = await import("../src/decision.mjs");
  assert.equal(
    decideIrContract({
      irLines: 10,
      ansiLines: 11,
      lspLines: 12,
      correctnessAdvantage: false,
    }).decision,
    "retain-stable-v1",
  );
  assert.equal(
    decideIrContract({
      irLines: 20,
      ansiLines: 5,
      lspLines: 6,
      correctnessAdvantage: false,
    }).decision,
    "simplify-before-expansion",
  );
  assert.equal(
    decideIrContract({
      irLines: 20,
      ansiLines: 5,
      lspLines: 6,
      correctnessAdvantage: true,
    }).decision,
    "retain-stable-v1",
  );
});

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

function irMutationCases() {
  const oldFixture = releaseFixture("v0.2.1");
  const currentFixture = releaseFixture("v0.3.0");
  const baseline = JSON.parse(currentFixture.ir);
  return {
    profiles: [oldFixture.profile, currentFixture.profile],
    cases: [
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
      [
        "E_AXES",
        JSON.stringify({
          ...baseline,
          tokens: baseline.tokens.map((token, index) =>
            index === 1 ? { ...token, functionKind: null } : token,
          ),
        }),
      ],
    ],
  };
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
  const { cases, profiles } = irMutationCases();
  for (const [code, artifactJson] of cases) {
    expectConsumerError(code, () =>
      consumeIr({ source: SOURCE, artifactJson, profiles }),
    );
  }
});

test("IR admission enforces enum members from the selected schema", () => {
  const currentFixture = releaseFixture("v0.3.0");
  const baseline = JSON.parse(currentFixture.ir);
  const cases = [
    {
      ...baseline,
      tokens: baseline.tokens.map((token, index) =>
        index === 1 ? { ...token, functionKind: "BOGUS" } : token,
      ),
    },
    {
      ...baseline,
      structure: baseline.structure.map((node, index) =>
        index === 0 ? { ...node, kind: "BOGUS" } : node,
      ),
    },
    {
      ...baseline,
      diagnostics: [
        {
          byteRange: baseline.tokens[0].byteRange,
          severity: "BOGUS",
          code: "test",
          message: "test",
        },
      ],
    },
  ];
  for (const document of cases) {
    expectConsumerError("E_SHAPE", () =>
      consumeIr({
        source: SOURCE,
        artifactJson: JSON.stringify(document),
        profiles: [currentFixture.profile],
      }),
    );
  }
});

test("IR admission enforces the signed GraphQL Int range", () => {
  const currentFixture = releaseFixture("v0.3.0");
  const baseline = JSON.parse(currentFixture.ir);
  const document = {
    ...baseline,
    tokens: baseline.tokens.map((token, index) =>
      index === 0 ? { ...token, occurrenceId: 2 ** 40 } : token,
    ),
  };
  expectConsumerError("E_SHAPE", () =>
    consumeIr({
      source: SOURCE,
      artifactJson: JSON.stringify(document),
      profiles: [currentFixture.profile],
    }),
  );
});

test("IR admission rejects malformed structure graphs", () => {
  const currentFixture = releaseFixture("v0.3.0");
  const baseline = JSON.parse(currentFixture.ir);
  const [paragraph, sentence] = baseline.structure;
  const cases = [
    [{ ...paragraph, childNodeIds: [999] }, sentence],
    [paragraph, { ...sentence, nodeId: paragraph.nodeId }],
    [{ ...paragraph, depth: 1 }, sentence],
    [paragraph, { ...sentence, childNodeIds: [paragraph.nodeId] }],
    [{ ...paragraph, byteRange: { startUtf8: 0, endUtf8: 57 } }, sentence],
    [
      paragraph,
      sentence,
      { ...paragraph, nodeId: 2, childNodeIds: [sentence.nodeId] },
    ],
  ];
  for (const structure of cases) {
    expectConsumerError("E_SHAPE", () =>
      consumeIr({
        source: SOURCE,
        artifactJson: JSON.stringify({ ...baseline, structure }),
        profiles: [currentFixture.profile],
      }),
    );
  }
});

test("IR admission rejects unknown fields in every document record", () => {
  const currentFixture = releaseFixture("v0.3.0");
  const baseline = JSON.parse(currentFixture.ir);
  const diagnostic = {
    byteRange: baseline.tokens[0].byteRange,
    severity: "INFO",
    code: "test",
    message: "test",
  };
  const cases = [
    { ...baseline, unexpected: true },
    { ...baseline, source: { ...baseline.source, unexpected: true } },
    {
      ...baseline,
      tokens: baseline.tokens.map((token, index) =>
        index === 0 ? { ...token, unexpected: true } : token,
      ),
    },
    {
      ...baseline,
      tokens: baseline.tokens.map((token, index) =>
        index === 0
          ? {
              ...token,
              byteRange: { ...token.byteRange, unexpected: true },
            }
          : token,
      ),
    },
    {
      ...baseline,
      structure: baseline.structure.map((node, index) =>
        index === 0 ? { ...node, unexpected: true } : node,
      ),
    },
    { ...baseline, diagnostics: [{ ...diagnostic, unexpected: true }] },
    {
      ...baseline,
      derivation: [
        { ...baseline.derivation[0], unexpected: true },
        ...baseline.derivation.slice(1),
      ],
    },
  ];
  for (const document of cases) {
    expectConsumerError("E_SHAPE", () =>
      consumeIr({
        source: SOURCE,
        artifactJson: JSON.stringify(document),
        profiles: [currentFixture.profile],
      }),
    );
  }
});

test("release profiles project every classified visual role", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "colorful-profile-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const fixtureDirectory = path.join(FIXTURES, "releases", "v0.3.0");
  const syntax = readFileSync(
    path.join(fixtureDirectory, "syntax.v1.graphql"),
    "utf8",
  );
  const vocabulary = JSON.parse(
    readFileSync(
      path.join(fixtureDirectory, "vocabulary.v1.json"),
      "utf8",
    ),
  );
  const missingRole = vocabulary.classRoles[0].visualRole;
  vocabulary.roleProjections = vocabulary.roleProjections.filter(
    (projection) => projection.visualRole !== missingRole,
  );
  const vocabularyText = `${JSON.stringify(vocabulary, null, 2)}\n`;
  const metadata = JSON.parse(
    readFileSync(path.join(fixtureDirectory, "profile.json"), "utf8"),
  );
  metadata.vocabularyHash = `sha256:${createHash("sha256")
    .update(vocabularyText, "utf8")
    .digest("hex")}`;
  writeFileSync(path.join(directory, "syntax.v1.graphql"), syntax);
  writeFileSync(path.join(directory, "vocabulary.v1.json"), vocabularyText);
  writeFileSync(
    path.join(directory, "profile.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  expectConsumerError("E_PROFILE", () => loadProfile(directory));
});

test("ANSI refusal cases cover every stable adapter category", () => {
  const directory = path.join(FIXTURES, "releases", "v0.3.0");
  const profile = loadProfile(directory);
  const baseline = readFileSync(path.join(directory, "ansi.txt"), "utf8");
  const cases = [
    ["E_ANSI_ESCAPE", baseline.replace("\x1b[90m", "\x1b]90m")],
    ["E_ANSI_CODE", baseline.replace("\x1b[90m", "\x1b[99m")],
    ["E_ANSI_STATE", baseline.replace(/\x1b\[0m$/, "")],
    ["E_SOURCE_TEXT", baseline.replace(" \x1b[1;35mthe", "\x1b[1;35mthe")],
  ];
  for (const [code, ansiText] of cases) {
    expectConsumerError(code, () =>
      consumeAnsi({ source: SOURCE, ansiText, profile }),
    );
  }
});

test("LSP refusal cases cover every stable adapter category", () => {
  const directory = path.join(FIXTURES, "releases", "v0.3.0");
  const profile = loadProfile(directory);
  const baseline = JSON.parse(
    readFileSync(path.join(directory, "lsp.json"), "utf8"),
  );
  const cases = [
    ["E_LSP_JSON", "{"],
    ["E_LSP_SHAPE", JSON.stringify({ ...baseline, data: [0] })],
    [
      "E_LSP_VERSION",
      JSON.stringify({
        ...baseline,
        serverInfo: { ...baseline.serverInfo, version: "9.0.0" },
      }),
    ],
    [
      "E_LSP_LEGEND",
      JSON.stringify({ ...baseline, legend: [...baseline.legend].reverse() }),
    ],
    [
      "E_LSP_POSITION",
      JSON.stringify({
        ...baseline,
        data: baseline.data.map((value, index) => (index === 1 ? 1 : value)),
      }),
    ],
  ];
  for (const [code, responseJson] of cases) {
    expectConsumerError(code, () =>
      consumeLsp({ source: SOURCE, responseJson, profile }),
    );
  }
});

test("LSP capture rejects unsuccessful responses before serialization", () => {
  expectConsumerError("E_LSP_SHAPE", () =>
    buildLspFixture(
      { jsonrpc: "2.0", id: 1, error: { code: -32603 } },
      { jsonrpc: "2.0", id: 2, result: { data: [] } },
    ),
  );
  expectConsumerError("E_LSP_SHAPE", () =>
    buildLspFixture(
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          serverInfo: { name: "colorful-lsp", version: "0.3.0" },
          capabilities: {
            semanticTokensProvider: {
              legend: { tokenTypes: ["keyword"] },
            },
          },
        },
      },
      { jsonrpc: "2.0", id: 2, error: { code: -32603 } },
    ),
  );
  expectConsumerError("E_LSP_SHAPE", () =>
    buildLspFixture(
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          serverInfo: { name: "colorful-lsp", version: "0.3.0" },
          capabilities: {
            semanticTokensProvider: {
              legend: { tokenTypes: ["keyword"] },
            },
          },
        },
      },
      { jsonrpc: "2.0", id: 2, result: { data: [0] } },
    ),
  );
});

test("the IR process refuses every stable category without output", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "colorful-ir-refusal-"));
  context.after(() => rmSync(directory, { recursive: true }));

  for (const [index, [code, artifactJson]] of irMutationCases().cases.entries()) {
    const input = path.join(directory, `${index}.json`);
    writeFileSync(input, artifactJson);
    const result = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "bin", "report.mjs"),
        "--format",
        "ir",
        "--source",
        path.join(FIXTURES, "source.txt"),
        "--input",
        input,
        "--profiles",
        path.join(FIXTURES, "releases"),
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1, code);
    assert.equal(result.stdout, "", code);
    assert.match(
      result.stderr,
      new RegExp(`^independent-ir-report: ${code}:`),
      code,
    );
  }
});

test("the IR process rejects invalid UTF-8 before source identity trust", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "colorful-ir-utf8-"));
  context.after(() => rmSync(directory, { recursive: true }));
  const source = path.join(directory, "source.txt");
  const input = path.join(directory, "artifact.json");
  const replacementText = "\uFFFD";
  const { ir } = releaseFixture("v0.3.0");
  const baseline = JSON.parse(ir);
  const artifact = {
    ...baseline,
    source: {
      ...baseline.source,
      utf8ByteLength: Buffer.byteLength(replacementText, "utf8"),
      contentHash: `sha256:${createHash("sha256")
        .update(replacementText, "utf8")
        .digest("hex")}`,
    },
    tokens: [],
    structure: [],
    diagnostics: [],
    derivation: [
      {
        ...baseline.derivation[0],
        sourceRanges: [],
      },
    ],
  };
  writeFileSync(source, Buffer.from([0x80]));
  writeFileSync(input, `${JSON.stringify(artifact)}\n`);

  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "bin", "report.mjs"),
      "--format",
      "ir",
      "--source",
      source,
      "--input",
      input,
      "--profiles",
      path.join(FIXTURES, "releases"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^independent-ir-report: E_SOURCE_UTF8:/);
});
