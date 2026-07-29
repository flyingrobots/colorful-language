import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  closingIssueNumbersForRepository,
  InventoryError,
  run,
  validateRoadmapInventory,
} from "./check-roadmap-inventory.mjs";

const fixtureRoot = new URL("./fixtures/roadmap-inventory/", import.meta.url);
const script = fileURLToPath(
  new URL("./check-roadmap-inventory.mjs", import.meta.url),
);
const roadmap = readFileSync(new URL("roadmap.md", fixtureRoot), "utf8");
const issues = JSON.parse(
  readFileSync(new URL("issues.json", fixtureRoot), "utf8"),
);
const canonicalTableLine =
  roadmap
    .split("\n")
    .findIndex((line) => line.startsWith("| Mechanism |")) + 1;

function expectCategory(category, mutation, options = {}) {
  const { messagePattern, ...validationOptions } = options;
  assert.throws(
    () =>
      validateRoadmapInventory({
        roadmap: mutation(roadmap),
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
        ...validationOptions,
      }),
    (error) => {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, category);
      assert.match(error.message, /^E_ROADMAP_[A-Z_]+: /u);
      assert.match(error.message, /fixture\/(?:roadmap\.md|issues\.json)/u);
      if (messagePattern !== undefined) {
        assert.match(error.message, messagePattern);
      }
      return true;
    },
  );
}

test("accepts one primary home for every open non-epic slice", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("accepts the canonical roadmap with CRLF line endings", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replaceAll("\n", "\r\n"),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("reports identical failure addresses for LF and CRLF roadmaps", () => {
  const mechanismRow =
    "| Parser ports | Substitute deterministic adapters. |";
  const duplicated = roadmap.replace(
    mechanismRow,
    `${mechanismRow}\n${mechanismRow}`,
  );
  const failureMessage = (source) => {
    try {
      validateRoadmapInventory({
        roadmap: source,
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
      });
    } catch (error) {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, "E_ROADMAP_DUPLICATE_MECHANISM");
      return error.message;
    }
    assert.fail("expected duplicate-mechanism validation to fail");
  };

  assert.equal(
    failureMessage(duplicated.replaceAll("\n", "\r\n")),
    failureMessage(duplicated),
  );
});

test("rejects an open slice missing from the primary inventory", () => {
  expectCategory("E_ROADMAP_MISSING_OPEN", (source) =>
    source.replace("  <!-- roadmap-primary: active #101 -->\n", ""),
  );
});

test("rejects duplicate primary homes", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_PRIMARY",
    (source) => `${source}\n<!-- roadmap-primary: active #101 -->\n`,
  );
});

test("rejects a duplicate architecture-accountability mechanism by line", () => {
  const mechanismRow =
    "| Parser ports | Substitute deterministic adapters. |";
  const duplicated = roadmap.replace(
    mechanismRow,
    `${mechanismRow}\n${mechanismRow}`,
  );
  const root = mkdtempSync(join(tmpdir(), "colorful-roadmap-policy-"));
  const roadmapPath = join(root, "ROADMAP.md");
  try {
    writeFileSync(roadmapPath, duplicated, "utf8");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--roadmap",
        roadmapPath,
        "--issues",
        fileURLToPath(new URL("issues.json", fixtureRoot)),
      ],
      { encoding: "utf8", timeout: 5_000 },
    );

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      `E_ROADMAP_DUPLICATE_MECHANISM: ${roadmapPath}:26: architecture-accountability mechanism "Parser ports" already appears at ${roadmapPath}:25\n`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a missing canonical architecture-accountability section", () => {
  for (const replacement of [
    "## Architecture Accountability",
    "    ## Architecture accountability",
    "\t## Architecture accountability",
    "",
  ]) {
    expectCategory(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_SECTION",
      (source) =>
        source.replace("## Architecture accountability", replacement),
    );
  }
});

test("rejects comment-altered accountability headings", () => {
  for (const replacement of [
    "## Architecture<!--note--> accountability",
    "## Architecture accountability<!--note-->",
  ]) {
    expectCategory(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_SECTION",
      (source) =>
        source.replace("## Architecture accountability", replacement),
    );
  }
});

test("rejects comment-altered duplicate headings in either source order", () => {
  const alteredHeading = "## Architecture<!--note--> accountability";
  for (const mutation of [
    (source) => `${source}

${alteredHeading}
`,
    (source) => `${source.replace(
      "## Architecture accountability",
      alteredHeading,
    )}

## Architecture accountability
`,
  ]) {
    expectCategory("E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION", mutation);
  }
});

test("ignores indented code that spells the accountability heading", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}

    ## Architecture accountability
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("does not let an indented comment opener hide a later table", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `${source}

    <!--

| Mechanism | Current user job |
| --- | --- |
| Visible authority | The indented code line cannot hide this table. |
`,
  );
});

test("rejects a second architecture-accountability section", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
    (source) => `${source}

## Later roadmap section

This section separates the duplicate from the canonical authority.

## Architecture accountability

| Mechanism | Current user job |
| --- | --- |
| Parser ports | Duplicated section. |
`,
    {
      messagePattern:
        /^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION: fixture\/roadmap\.md:\d+: canonical heading already appears at fixture\/roadmap\.md:21$/u,
    },
  );
});

test("rejects closing hashes on a duplicate accountability heading", () => {
  const canonicalHeadingLine =
    roadmap
      .split("\n")
      .findIndex((line) => line === "## Architecture accountability") + 1;
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
    (source) => `${source}

## Architecture accountability ##

| Mechanism | Current user job |
| --- | --- |
| Closing-hash authority | Must not escape duplicate detection. |
`,
    {
      messagePattern: new RegExp(
        `^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION: fixture/roadmap\\.md:\\d+: canonical heading already appears at fixture/roadmap\\.md:${canonicalHeadingLine}$`,
        "u",
      ),
    },
  );
});

test("rejects a closing-hash heading before the canonical authority", () => {
  const displayEquivalentHeadingLine =
    roadmap
      .split("\n")
      .findIndex((line) => line === "## Architecture accountability") + 1;
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION",
    (source) => `${source.replace(
      "## Architecture accountability",
      "## Architecture accountability ##",
    )}

## Architecture accountability

| Mechanism | Current user job |
| --- | --- |
| Canonical authority | Must detect the earlier rendered equivalent. |
`,
    {
      messagePattern: new RegExp(
        `^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_SECTION: fixture/roadmap\\.md:\\d+: display-equivalent heading already appears at fixture/roadmap\\.md:${displayEquivalentHeadingLine}$`,
        "u",
      ),
    },
  );
});

test("reports a missing canonical section for repeated closing-hash headings", () => {
  expectCategory(
    "E_ROADMAP_MISSING_ACCOUNTABILITY_SECTION",
    (source) => `${source.replace(
      "## Architecture accountability",
      "## Architecture accountability ##",
    )}

## Architecture accountability ##
`,
  );
});

test("ignores table-like examples outside the accountability table", () => {
  for (const block of [
    ["```markdown", "| Example | Only |", "```"].join("\n"),
    ["<!--", "| Example | Only |", "-->"].join("\n"),
  ]) {
    const withExample = [
      roadmap.trimEnd(),
      block,
      "| Parser ports | Historical example only. |",
    ].join("\n");

    assert.doesNotThrow(() =>
      validateRoadmapInventory({
        roadmap: withExample,
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
      }),
    );
  }
});

test("ignores accountability tables inside raw HTML blocks", () => {
  const table = [
    "| Mechanism | Example only |",
    "| --- | --- |",
    "| Parser ports | Hidden inside raw HTML. |",
  ];
  for (const rawHtmlBlock of [
    ["<div>", ...table, "</div>"],
    ["<script>", ...table, "</script>"],
    ["<?instruction", ...table, "?>"],
    ["<!DECLARATION", ...table, ">"],
    ["<![CDATA[", ...table, "]]>"],
    ["<custom-element>", ...table, "</custom-element>"],
  ]) {
    expectCategory("E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE", (source) =>
      source.replace(
        /\n\| Mechanism \|[\s\S]*$/u,
        `\n${rawHtmlBlock.join("\n")}\n`,
      ),
    );
  }
});

test("rejects a table hidden by an invalid backtick-fence interpretation", () => {
  const hiddenTable = [
    "```markdown`",
    "Visible text, not a canonical table.",
    "```",
    "| Mechanism | Hidden table |",
    "| --- | --- |",
    "| Parser ports | Hidden by the real Markdown fence. |",
  ].join("\n");
  expectCategory("E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE", (source) =>
    source.replace(/\n\| Mechanism \|[\s\S]*$/u, `\n${hiddenTable}\n`),
  );

  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}
~~~markdown\`literal
| Mechanism | Example only |
| --- | --- |
| Parser ports | Hidden by a valid tilde fence. |
~~~
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("ignores multiline HTML comments that start after visible text", () => {
  const commentedTable = [
    "Visible introduction. <!--",
    "| Mechanism | Example only |",
    "| --- | --- |",
    "| Parser ports | Hidden in the comment. |",
    "-->",
  ].join("\n");
  expectCategory("E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE", (source) =>
    source.replace(/\n\| Mechanism \|[\s\S]*$/u, `\n${commentedTable}\n`),
  );

  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}
${commentedTable}
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("continues comment scanning after an unmatched backtick", () => {
  expectCategory(
    "E_ROADMAP_MISSING_ACCOUNTABILITY_SECTION",
    (source) =>
      source.replace(
        "## Architecture accountability",
        [
          "Visible unmatched ` <!--",
          "## Architecture accountability",
          "-->",
        ].join("\n"),
      ),
  );
});

test("compares visible mechanism identity around inline HTML comments", () => {
  const mechanismRow =
    "| Parser ports | Substitute deterministic adapters. |";
  expectCategory("E_ROADMAP_DUPLICATE_MECHANISM", (source) =>
    source.replace(
      mechanismRow,
      [
        mechanismRow,
        "| Parser <!-- explanatory note --> ports | Same visible mechanism. |",
      ].join("\n"),
    ),
  );
});

test("preserves comment-shaped text inside inline code", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(
        "| Parser ports | Substitute deterministic adapters. |",
        [
          "| Parser ports | Plain identity. |",
          "| `Parser <!-- explanatory note --> ports` | Literal code identity. |",
        ].join("\n"),
      ),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("rejects a multiline comment beginning on a visible table row", () => {
  const mechanismRow =
    "| Parser ports | Substitute deterministic adapters. |";
  expectCategory(
    "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
    (source) =>
      source.replace(
        mechanismRow,
        [
          mechanismRow,
          "| Parser ports | Duplicate visible row. | <!--",
          "Comment body.",
          "-->",
        ].join("\n"),
      ),
  );
});

test("allows a multiline comment after post-table prose containing a pipe", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}

Choose Parser ports | annotator ports here. <!--
This comment does not extend the accountability table.
-->
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("ignores pipes inside inline code after the accountability table", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(
        "| Parser \\| analyzer ports | Analyze deterministic structure. |",
        [
          "| Parser \\| analyzer ports | Analyze deterministic structure. |",
          "Prefer `a|b` ordering when both apply.",
        ].join("\n"),
      ),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("rejects a missing architecture-accountability table", () => {
  expectCategory("E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE", (source) =>
    source.replace(/\n\| Mechanism \|[\s\S]*$/u, "\n"),
  );
});

test("does not source canonical authority from a peer section", () => {
  for (const peerHeading of [
    "# Other section",
    "## Other section",
    ["Other section", "============="].join("\n"),
    ["Other section", "-------------"].join("\n"),
  ]) {
    expectCategory(
      "E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE",
      (source) =>
        source.replace(
          /\n\| Mechanism \|[\s\S]*$/u,
          `
${peerHeading}

| Mechanism | Current user job |
| --- | --- |
| Other authority | This table belongs to another section. |
`,
        ),
    );
  }
});

test("rejects a second architecture-accountability mechanism table", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `${source}

## ## Architecture accountability

| Mechanism | Current user job |
| --- | --- |
| Parser ports | Duplicated table. |
`,
    {
      messagePattern: new RegExp(
        `^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE: fixture/roadmap\\.md:\\d+: canonical table already begins at fixture/roadmap\\.md:${canonicalTableLine}$`,
        "u",
      ),
    },
  );
});

test("rejects an accountability table before the canonical section", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `| Mechanism | Current user job |
| --- | --- |
| Earlier authority | Must not escape source-order detection. |

${source}`,
    {
      messagePattern:
        /^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE: fixture\/roadmap\.md:\d+: canonical table already begins at fixture\/roadmap\.md:1$/u,
    },
  );
});

test("rejects a second accountability table after a later H2", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `${source}

## Appendix

| Mechanism | Current user job |
| --- | --- |
| Appendix-only mechanism | Must not create another apparent authority. |
`,
    {
      messagePattern: new RegExp(
        `^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE: fixture/roadmap\\.md:\\d+: canonical table already begins at fixture/roadmap\\.md:${canonicalTableLine}$`,
        "u",
      ),
    },
  );
});

test("requires a complete table after a later H2 before rejecting it", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}

## Appendix

| Mechanism | Current user job |

The header-shaped line has no delimiter or data row.

| Subject | Description |
| --- | --- |
| Appendix | An unrelated table remains ordinary roadmap content. |
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("rejects a styled duplicate accountability table header", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `${source}

| \`Mechanism\` | Current user job |
| --- | --- |
| Styled duplicate | Must not create another apparent authority. |
`,
  );
});

test("rejects rendered-equivalent duplicate table headers", () => {
  for (const header of [
    "[Mechanism](#other)",
    "Mech&#97;nism",
    "Mech&#x61;nism",
  ]) {
    expectCategory(
      "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
      (source) => `${source}

| ${header} | Current user job |
| --- | --- |
| Rendered duplicate | Must not evade duplicate-table detection. |
`,
    );
  }
});

test("does not invent a missing reference-link definition", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}

| [Mechanism][missing] | Current user job |
| --- | --- |
| Literal reference text | No link definition exists. |
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("rejects a comment-altered accountability table header", () => {
  expectCategory(
    "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
    (source) =>
      source.replace(
        "| Mechanism | Current user job |",
        "| Mech<!--note-->anism | Current user job |",
      ),
  );
});

test("rejects a comment-altered accountability table delimiter", () => {
  expectCategory(
    "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
    (source) =>
      source.replace("| --- | --- |", "| --<!--note-->- | --- |"),
  );
});

test("rejects non-Markdown whitespace as table-cell padding", () => {
  for (const [category, mutation] of [
    [
      "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
      (source) =>
        source.replace(
          "| Mechanism | Current user job |",
          "|\u00a0Mechanism\u00a0| Current user job |",
        ),
    ],
    [
      "E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE",
      (source) =>
        source.replace("| --- | --- |", "|\u00a0---\u00a0| --- |"),
    ],
  ]) {
    expectCategory(category, mutation);
  }
});

test("rejects unsupported Markdown in a duplicate table header", () => {
  expectCategory(
    "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
    (source) => `${source}

| **Mechanism** | Current user job |
| --- | --- |
| Styled duplicate | Must not evade duplicate-table detection. |
`,
  );
});

test("requires a complete table before rejecting a styled header", () => {
  for (const header of [
    "| `Mechanism` | Current user job |",
    "| **Mechanism** | Current user job |",
  ]) {
    assert.doesNotThrow(() =>
      validateRoadmapInventory({
        roadmap: `${roadmap}

${header}

This header-shaped line has no delimiter or data row.
`,
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
      }),
    );
  }
});

test("rejects a no-leading-pipe accountability table explicitly", () => {
  for (const header of [
    "Mechanism | Current user job",
    "Mechanism|Current user job",
    "Mechanism  | Current user job",
    "Mechanism\t| Current user job",
  ]) {
    expectCategory(
      "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
      (source) => `${source}
${header}
--- | ---
Parser ports | Alternate apparent authority.
`,
    );
  }
});

test("requires a complete table before rejecting a no-leading header", () => {
  for (const header of [
    "Mechanism | Current user job",
    "Mechanism|Current user job",
    "Mechanism  | Current user job",
    "Mechanism\t| Current user job",
  ]) {
    assert.doesNotThrow(() =>
      validateRoadmapInventory({
        roadmap: `${roadmap}
${header}

This header-shaped line has no delimiter or data row.
`,
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
      }),
    );
  }
});

test("rejects a no-leading-pipe data row inside the accountability table", () => {
  expectCategory(
    "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
    (source) =>
      source.replace(
        "| Parser ports | Substitute deterministic adapters. |",
        [
          "| Parser ports | Substitute deterministic adapters. |",
          "Parser ports | Duplicate decision.",
        ].join("\n"),
      ),
  );
});

test("requires a delimiter and data row for the accountability table", () => {
  for (const replacement of [
    "| Mechanism",
    "| Mechanism | Example only |",
    ["| Mechanism | Example only |", "| --- | --- |"].join("\n"),
    [
      "| Mechanism | Example only |",
      "| - | --- |",
      "| Parser ports | Invalid first delimiter. |",
    ].join("\n"),
    [
      "| Mechanism | Example only |",
      "| --- | nope |",
      "| Parser ports | Invalid second delimiter. |",
    ].join("\n"),
    [
      "| Mechanism | Example only |",
      "| --- |",
      "| Parser ports | Missing second delimiter. |",
    ].join("\n"),
    [
      "| Mechanism | Example only |",
      "| --- | --- | --- |",
      "| Parser ports | Unexpected third delimiter. |",
    ].join("\n"),
    [
      "```markdown",
      "| Mechanism | Example only |",
      "| --- | --- |",
      "| Parser ports | Not authoritative. |",
      "```",
    ].join("\n"),
    [
      "<!--",
      "| Mechanism | Example only |",
      "| --- | --- |",
      "| Parser ports | Not authoritative. |",
      "-->",
    ].join("\n"),
    [
      "    | Mechanism | Example only |",
      "    | --- | --- |",
      "    | Parser ports | Indented code, not a table. |",
    ].join("\n"),
  ]) {
    expectCategory("E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE", (source) =>
      source.replace(/\n\| Mechanism \|[\s\S]*$/u, `\n${replacement}\n`),
    );
  }
});

test("rejects a later table after an empty accountability table", () => {
  const headerAndDelimiter = [
    "| Mechanism | Current user job |",
    "| --- | --- |",
  ].join("\n");
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) =>
      source.replace(
        headerAndDelimiter,
        [headerAndDelimiter, "", headerAndDelimiter].join("\n"),
      ),
    {
      messagePattern:
        /^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE: fixture\/roadmap\.md:\d+: canonical table already begins at fixture\/roadmap\.md:23$/u,
    },
  );
});

test("compares displayed mechanism identity across inline-code styling", () => {
  expectCategory("E_ROADMAP_DUPLICATE_MECHANISM", (source) =>
    source.replace(
      "| Parser ports | Substitute deterministic adapters. |",
      [
        "| Parser ports | Substitute deterministic adapters. |",
        "| `Parser ports` | Same displayed mechanism. |",
      ].join("\n"),
    ),
  );
});

test("does not close an inline-code span at a longer backtick run", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(
        "| Parser ports | Substitute deterministic adapters. |",
        [
          "| foobarbaz | Plain identity. |",
          "| `foo``bar``baz` | Internal backtick runs remain displayed. |",
        ].join("\n"),
      ),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("normalizes escaped pipes inside inline-code mechanism identities", () => {
  const mechanismRow =
    String.raw`| Parser \| compiler ports | Compile deterministic structure. |`;
  expectCategory("E_ROADMAP_DUPLICATE_MECHANISM", (source) =>
    source.replace(
      mechanismRow,
      [
        mechanismRow,
        "| `Parser \\| compiler ports` | Same displayed mechanism. |",
      ].join("\n"),
    ),
  );
});

test("rejects noncanonical mechanism-cell Markdown", () => {
  expectCategory("E_ROADMAP_NONCANONICAL_MECHANISM", (source) =>
    source.replace("| Parser ports |", "| **Parser ports** |"),
  );
});

test("rejects character references in mechanism identities", () => {
  for (const identity of [
    "Parser &amp; compiler ports",
    "Parser &#38; compiler ports",
    "Parser &#x26; compiler ports",
  ]) {
    expectCategory("E_ROADMAP_NONCANONICAL_MECHANISM", (source) =>
      source.replace("| Parser ports |", `| ${identity} |`),
    );
  }
});

test("allows literal ampersands and character-reference text inside code", () => {
  for (const identity of ["Parser & compiler ports", "`Parser &amp; ports`"]) {
    assert.doesNotThrow(() =>
      validateRoadmapInventory({
        roadmap: roadmap.replace("| Parser ports |", `| ${identity} |`),
        issues,
        roadmapPath: "fixture/roadmap.md",
        issuePath: "fixture/issues.json",
      }),
    );
  }
});

test("rejects an empty architecture-accountability mechanism", () => {
  expectCategory("E_ROADMAP_EMPTY_MECHANISM", (source) =>
    source.replace(
      "| Parser ports | Substitute deterministic adapters. |",
      "|  | Unnamed decisions are not accountable. |",
    ),
  );
});

test("rejects a backslash before a non-punctuation mechanism character", () => {
  expectCategory("E_ROADMAP_NONCANONICAL_MECHANISM", (source) =>
    source.replace("| Parser ports |", String.raw`| \Parser ports |`),
  );
});

test("compares canonically equivalent Unicode mechanism identities", () => {
  const composed = "Caf\u00e9";
  const decomposed = "Cafe\u0301";
  expectCategory("E_ROADMAP_DUPLICATE_MECHANISM", (source) =>
    source.replace(
      "| Parser ports | Substitute deterministic adapters. |",
      [
        `| ${composed} | Composed identity. |`,
        `| ${decomposed} | Decomposed identity. |`,
      ].join("\n"),
    ),
  );
});

test("rejects a closed slice presented as active", () => {
  expectCategory("E_ROADMAP_CLOSED_ACTIVE", (source) =>
    source.replace(
      "roadmap-primary: delivered #103",
      "roadmap-primary: active #103",
    ),
  );
});

test("rejects an open slice presented as delivered", () => {
  expectCategory("E_ROADMAP_OPEN_DELIVERED", (source) =>
    source.replace(
      "roadmap-primary: active #101",
      "roadmap-primary: delivered #101",
    ),
  );
});

test("rejects a primary marker for an unknown issue", () => {
  expectCategory(
    "E_ROADMAP_UNKNOWN_ISSUE",
    (source) => `${source}\n<!-- roadmap-primary: active #999 -->\n`,
  );
});

test("rejects an unrecognized primary disposition", () => {
  expectCategory("E_ROADMAP_INVALID_MARKER", (source) =>
    source.replace(
      "roadmap-primary: active #101",
      "roadmap-primary: someday #101",
    ),
  );
});

test("treats issues closed by the current pull request as delivered", () => {
  const transitioningRoadmap = roadmap.replace(
    "roadmap-primary: active #101",
    "roadmap-primary: delivered #101",
  );

  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: transitioningRoadmap,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
      closingIssueNumbers: new Set([101]),
    }),
  );
});

test("requires a delivered marker for a slice closed by the pull request", () => {
  expectCategory(
    "E_ROADMAP_MISSING_DELIVERED",
    (source) =>
      source.replace("  <!-- roadmap-primary: active #101 -->\n", ""),
    { closingIssueNumbers: new Set([101]) },
  );
});

test("ignores closing references to a different repository", () => {
  const references = [
    {
      number: 101,
      repository: {
        name: "colorful-language",
        owner: { login: "flyingrobots" },
      },
    },
    {
      number: 101,
      repository: {
        name: "other-project",
        owner: { login: "someone-else" },
      },
    },
    {
      number: 202,
      repository: {
        name: "other-project",
        owner: { login: "someone-else" },
      },
    },
  ];

  assert.deepEqual(
    closingIssueNumbersForRepository(
      references,
      "flyingrobots/colorful-language",
    ),
    new Set([101]),
  );
});

test("rejects a missing option value with a stable usage error", () => {
  assert.throws(
    () => run(["--roadmap"]),
    (error) => {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, "E_ROADMAP_USAGE");
      assert.match(error.message, /arguments/u);
      assert.match(error.message, /--roadmap/u);
      return true;
    },
  );
});

test("rejects malformed issue JSON with a stable snapshot error", () => {
  const roadmapPath = fileURLToPath(new URL("roadmap.md", fixtureRoot));
  const issuePath = fileURLToPath(
    new URL("invalid-issues.txt", fixtureRoot),
  );

  assert.throws(
    () => run(["--roadmap", roadmapPath, "--issues", issuePath]),
    (error) => {
      assert.ok(error instanceof InventoryError);
      assert.equal(error.category, "E_ROADMAP_INVALID_ISSUE_SNAPSHOT");
      assert.match(error.message, /invalid-issues\.txt/u);
      return true;
    },
  );
});

test("bounds live GitHub calls by time and response size", () => {
  const checker = readFileSync(
    new URL("./check-roadmap-inventory.mjs", import.meta.url),
    "utf8",
  );

  assert.match(checker, /timeout:\s*30_000/u);
  assert.match(checker, /maxBuffer:\s*16 \* 1024 \* 1024/u);
});

test("defines the canonical accountability heading in one source location", () => {
  const checker = readFileSync(
    new URL("./check-roadmap-inventory.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(
    [...checker.matchAll(/## Architecture accountability/gu)].length,
    1,
  );
});

test("the workflow reference pins the canonical accountability heading", () => {
  const reference = readFileSync(
    new URL(
      "../docs/workflows/repository-maintenance/README.md",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    reference,
    /canonical\s+`## Architecture accountability`\s+H2/u,
  );
  assert.doesNotMatch(
    reference,
    /canonical\s+`## Architecture Accountability`\s+H2/u,
  );
});

test("the repository wires offline and live reconciliation into distinct lanes", () => {
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const maintenance = readFileSync(
    new URL("../.github/workflows/maintenance.yml", import.meta.url),
    "utf8",
  );
  const releasePrep = readFileSync(
    new URL("./release-prep.sh", import.meta.url),
    "utf8",
  );

  for (const source of [ci, releasePrep]) {
    assert.match(
      source,
      /node --test scripts\/check-roadmap-inventory\.test\.mjs/u,
    );
    assert.match(
      source,
      /node scripts\/check-roadmap-inventory\.mjs(?:\s|$)/u,
    );
  }
  assert.match(ci, /--closing-pr "\$PULL_REQUEST"/u);
  assert.match(
    ci,
    /^\s*issues:\s*read\s*# Live issue snapshot reconciliation\.\s*$/mu,
  );
  assert.match(
    ci,
    /^\s*pull-requests:\s*read\s*# Closing-issue references\.\s*$/mu,
  );
  assert.match(maintenance, /^\s*schedule:\s*$/mu);
  assert.match(maintenance, /^\s*workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(maintenance, /^\s*pull_request:\s*$/mu);
  assert.match(
    maintenance,
    /^concurrency:\s*\n\s+group:\s*roadmap-issue-reconciliation\s*\n\s+cancel-in-progress:\s*false\s*$/mu,
  );
  assert.match(maintenance, /^\s*persist-credentials:\s*false\s*$/mu);
  assert.match(
    maintenance,
    /^\s*contents:\s*read\s*# Repository checkout\.\s*$/mu,
  );
  assert.match(
    maintenance,
    /^\s*issues:\s*read\s*# Live issue snapshot reconciliation\.\s*$/mu,
  );
  assert.match(
    maintenance,
    /node scripts\/check-roadmap-inventory\.mjs\s+--live\s+--repo "\$REPOSITORY"/u,
  );
});
