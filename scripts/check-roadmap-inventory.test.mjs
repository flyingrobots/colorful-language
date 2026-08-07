import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  closingIssueNumbersForRepository,
  InventoryError,
  run,
  validateRoadmapInventory,
} from "./check-roadmap-inventory.mjs";
import { GITHUB_CALL_BOUNDS } from "./roadmap-inventory-runner.mjs";

const fixtureRoot = new URL("./fixtures/roadmap-inventory/", import.meta.url);
const script = fileURLToPath(
  new URL("./check-roadmap-inventory.mjs", import.meta.url),
);
const accountabilityPolicyScript = fileURLToPath(
  new URL("./roadmap-accountability-policy.mjs", import.meta.url),
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

function runFixtureProcess({
  roadmapSource = roadmap,
  issueSnapshot = issues,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "colorful-roadmap-contract-"));
  const roadmapPath = join(root, "ROADMAP.md");
  const issuePath = join(root, "issues.json");
  writeFileSync(roadmapPath, roadmapSource, "utf8");
  writeFileSync(issuePath, JSON.stringify(issueSnapshot), "utf8");
  return {
    roadmapPath,
    issuePath,
    result: spawnSync(
      process.execPath,
      [script, "--roadmap", roadmapPath, "--issues", issuePath],
      { encoding: "utf8", timeout: 5_000 },
    ),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
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

test("accepts canonical leading-pipe rows without trailing pipes", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(/ \|$/gmu, ""),
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

test("ignores primary markers inside non-authoritative code blocks", () => {
  expectCategory("E_ROADMAP_MISSING_OPEN", (source) =>
    source.replace(
      "  <!-- roadmap-primary: active #101 -->",
      [
        "  ```markdown",
        "  <!-- roadmap-primary: active #101 -->",
        "  ```",
      ].join("\n"),
    ),
  );
});

test("rejects duplicate primary homes", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_PRIMARY",
    (source) => `${source}\n<!-- roadmap-primary: active #101 -->\n`,
  );
});

test("pins exact process bytes across the roadmap ownership seam", () => {
  const mechanismRow =
    "| Parser ports | Substitute deterministic adapters. |";
  const duplicated = roadmap.replace(
    mechanismRow,
    `${mechanismRow}\n${mechanismRow}`,
  );
  const malformedMarker = roadmap.replace(
    "roadmap-primary: active #101",
    "roadmap-primary: someday #101",
  );
  const mismatchedIssues = issues.map((issue) =>
    issue.number === 101 ? { ...issue, state: "CLOSED" } : issue,
  );
  const cases = [
    {
      name: "structural success",
      expectedStatus: 0,
      expectedStdout:
        "check-roadmap-inventory: 2 open slices and 3 primary markers agree\n",
      expectedStderr: () => "",
    },
    {
      name: "duplicate accountability mechanism",
      roadmapSource: duplicated,
      expectedStatus: 1,
      expectedStdout: "",
      expectedStderr: ({ roadmapPath }) => {
        const firstLine = duplicated.split("\n").indexOf(mechanismRow) + 1;
        return `E_ROADMAP_DUPLICATE_MECHANISM: ${roadmapPath}:${firstLine + 1}: architecture-accountability mechanism "Parser ports" already appears at ${roadmapPath}:${firstLine}\n`;
      },
    },
    {
      name: "malformed primary marker",
      roadmapSource: malformedMarker,
      expectedStatus: 1,
      expectedStdout: "",
      expectedStderr: ({ roadmapPath }) => {
        const line =
          malformedMarker
            .split("\n")
            .findIndex((sourceLine) => sourceLine.includes("someday #101")) +
          1;
        return `E_ROADMAP_INVALID_MARKER: ${roadmapPath}:${line}: expected "<active|parked|delivered> #NN [#NN ...]", found "someday #101"\n`;
      },
    },
    {
      name: "issue state mismatch",
      issueSnapshot: mismatchedIssues,
      expectedStatus: 1,
      expectedStdout: "",
      expectedStderr: ({ roadmapPath }) => {
        const line =
          roadmap
            .split("\n")
            .findIndex((sourceLine) => sourceLine.includes("active #101")) + 1;
        return `E_ROADMAP_CLOSED_ACTIVE: ${roadmapPath}:${line}: closed issue #101 is marked active; use delivered\n`;
      },
    },
  ];

  for (const scenario of cases) {
    const invocation = runFixtureProcess(scenario);
    try {
      assert.equal(invocation.result.error, undefined, scenario.name);
      assert.equal(
        invocation.result.status,
        scenario.expectedStatus,
        scenario.name,
      );
      assert.equal(
        invocation.result.stdout,
        scenario.expectedStdout,
        scenario.name,
      );
      assert.equal(
        invocation.result.stderr,
        scenario.expectedStderr(invocation),
        scenario.name,
      );
    } finally {
      invocation.remove();
    }
  }
});

test("processes active table rows before Setext heading lookahead", () => {
  const mechanismRow =
    "| Parser \\| analyzer ports | Analyze deterministic structure. |";
  for (const underline of ["---", "==="]) {
    expectCategory("E_ROADMAP_DUPLICATE_MECHANISM", (source) =>
      source.replace(
        mechanismRow,
        [mechanismRow, mechanismRow, underline].join("\n"),
      ),
    );
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
    ["<custom-element disabled>", ...table, "</custom-element>"],
    ["<custom-element data-kind=value>", ...table, "</custom-element>"],
    ['<custom-element data-kind="two words">', ...table, "</custom-element>"],
    ["<custom-element data-kind='two words'/>", ...table],
  ]) {
    expectCategory("E_ROADMAP_MISSING_ACCOUNTABILITY_TABLE", (source) =>
      source.replace(
        /\n\| Mechanism \|[\s\S]*$/u,
        `\n${rawHtmlBlock.join("\n")}\n`,
      ),
    );
  }
});

test("does not scan comment-shaped text inside raw HTML blocks", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(
        "## Architecture accountability",
        [
          "<script>",
          "<!-- comment-shaped script text",
          "</script>",
          "",
          "## Architecture accountability",
        ].join("\n"),
      ),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("escaped comment syntax cannot hide a duplicate accountability table", () => {
  expectCategory("E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE", (source) =>
    [
      source,
      String.raw`\<!-- literal comment opener`,
      "",
      "| Mechanism | Current user job |",
      "| --- | --- |",
      "| Escaped-comment duplicate | Must remain visible. |",
      "-->",
    ].join("\n"),
  );

  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: [
        roadmap,
        String.raw`\\<!-- active comment opener`,
        "",
        "| Mechanism | Example only |",
        "| --- | --- |",
        "| Even-escape control | Hidden in the comment. |",
        "-->",
      ].join("\n"),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("does not let a generic HTML tag interrupt a paragraph", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(
        "## Architecture accountability",
        [
          "Ordinary paragraph text.",
          "<custom-element>",
          "## Architecture accountability",
        ].join("\n"),
      ),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("keeps an incomplete accountability header inside its paragraph", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: roadmap.replace(
        "## Architecture accountability",
        [
          "| Mechanism | Header-shaped paragraph without a delimiter. |",
          "<custom-element>",
          "## Architecture accountability",
        ].join("\n"),
      ),
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
});

test("does not reintroduce a generic HTML block grammar", () => {
  const accountabilityPolicy = readFileSync(
    accountabilityPolicyScript,
    "utf8",
  );
  assert.match(
    accountabilityPolicy,
    /from "mdast-util-from-markdown";/u,
  );
  assert.doesNotMatch(
    accountabilityPolicy,
    /GENERIC_HTML_(?:OPEN|CLOSE)_TAG/u,
  );
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

test("resumes table scanning after a multiline comment closer", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `${source}

<!-- explanatory note
--> | Mechanism | Second authority |
| --- | --- |
| Parser ports | Visible after the comment closer. |
`,
  );
});

test("resumes table scanning after a closed inline comment", () => {
  expectCategory(
    "E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE",
    (source) => `${source}

<!-- explanatory note --> | Mechanism | Second authority |
| --- | --- |
| Parser ports | Visible after the inline comment. |
`,
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
    "[Mech](#other)anism",
    "Mech&#97;nism",
    "Mech&#x61;nism",
    "**Mech**anism",
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

test("preserves intraword underscores in unrelated table headers", () => {
  assert.doesNotThrow(() =>
    validateRoadmapInventory({
      roadmap: `${roadmap}

| Mech__anism__ | Current user job |
| --- | --- |
| Literal underscores | This is not an accountability authority. |
`,
      issues,
      roadmapPath: "fixture/roadmap.md",
      issuePath: "fixture/issues.json",
    }),
  );
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

test("rejects overlapping comment delimiters in a table header", () => {
  expectCategory(
    "E_ROADMAP_NONCANONICAL_ACCOUNTABILITY_TABLE",
    (source) =>
      source.replace(
        "| Mechanism | Current user job |",
        "<!<!--note-->-->| Mechanism | Current user job |",
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
      messagePattern: new RegExp(
        `^E_ROADMAP_DUPLICATE_ACCOUNTABILITY_TABLE: fixture/roadmap\\.md:\\d+: canonical table already begins at fixture/roadmap\\.md:${canonicalTableLine}$`,
        "u",
      ),
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

test("compares NUL-normalized mechanism identities", () => {
  expectCategory("E_ROADMAP_DUPLICATE_MECHANISM", (source) =>
    source.replace(
      "| Parser ports | Substitute deterministic adapters. |",
      [
        "| A\u0000B | NUL input normalizes before rendering. |",
        "| A\uFFFDB | Same displayed mechanism. |",
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

test("rejects primary markers with trailing HTML-block content", () => {
  expectCategory(
    "E_ROADMAP_INVALID_MARKER",
    (source) =>
      `${source}\n<!-- roadmap-primary: active #101 --> trailing note\n`,
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

test("rejects duplicate runner options with a stable usage error", () => {
  for (const argv of [
    ["--live", "--live"],
    ["--roadmap", "first", "--roadmap", "second", "--closing-pr", "1"],
    ["--issues", "first", "--issues", "second", "--live", "--repo", "owner/repo"],
    ["--repo", "owner/first", "--repo", "owner/second", "--closing-pr", "1"],
    ["--closing-pr", "1", "--closing-pr", "2"],
  ]) {
    assert.throws(
      () => run(argv),
      (error) => {
        assert.ok(error instanceof InventoryError);
        assert.equal(error.category, "E_ROADMAP_USAGE");
        assert.match(error.message, /may be specified only once/u);
        return true;
      },
      argv.join(" "),
    );
  }
});

test("rejects malformed repository coordinates before transport", () => {
  for (const repo of [
    "missing-slash",
    "/repo",
    "owner/",
    "owner/repo/extra",
    "owner with space/repo",
  ]) {
    assert.throws(
      () => run(["--repo", repo, "--closing-pr", "1"]),
      (error) => {
        assert.ok(error instanceof InventoryError);
        assert.equal(error.category, "E_ROADMAP_USAGE");
        assert.match(error.message, /--repo requires OWNER\/NAME/u);
        return true;
      },
      repo,
    );
  }
});

test("categorizes unreadable roadmap and issue-snapshot paths", () => {
  const root = mkdtempSync(join(tmpdir(), "colorful-roadmap-inputs-"));
  const roadmapPath = fileURLToPath(new URL("roadmap.md", fixtureRoot));
  const missingRoadmap = join(root, "missing-roadmap.md");
  const missingIssues = join(root, "missing-issues.json");

  try {
    for (const { argv, category, location } of [
      {
        argv: ["--roadmap", missingRoadmap],
        category: "E_ROADMAP_UNREADABLE_ROADMAP",
        location: missingRoadmap,
      },
      {
        argv: ["--roadmap", roadmapPath, "--issues", missingIssues],
        category: "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
        location: missingIssues,
      },
    ]) {
      assert.throws(
        () => run(argv),
        (error) => {
          assert.ok(error instanceof InventoryError);
          assert.equal(error.category, category);
          assert.match(error.message, /unable to read/u);
          assert.ok(error.message.includes(location));
          return true;
        },
        location,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  assert.deepEqual(GITHUB_CALL_BOUNDS, {
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(Object.isFrozen(GITHUB_CALL_BOUNDS));
});

test("fails closed when the live issue listing reaches its ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "colorful-roadmap-live-"));
  const fakeGh = join(root, "gh");
  const issueOutput = join(root, "issues.json");
  const roadmapPath = fileURLToPath(new URL("roadmap.md", fixtureRoot));
  const fillerCount = 10_000 - issues.length;
  const liveIssues = [
    ...issues,
    ...Array.from({ length: fillerCount }, (_, index) => ({
      number: 1_000_000 + index,
      state: "CLOSED",
      title: `historical epic ${index}`,
      labels: ["epic"],
    })),
  ];

  try {
    writeFileSync(
      fakeGh,
      '#!/bin/sh\ncat "$ROADMAP_FAKE_ISSUES"\n',
      "utf8",
    );
    chmodSync(fakeGh, 0o755);
    writeFileSync(issueOutput, JSON.stringify(liveIssues), "utf8");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--roadmap",
        roadmapPath,
        "--live",
        "--repo",
        "flyingrobots/colorful-language",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}${pathDelimiter}${process.env.PATH}`,
          ROADMAP_FAKE_ISSUES: issueOutput,
        },
      },
    );

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^E_ROADMAP_GITHUB: /u);
    assert.match(result.stderr, /10,000-issue ceiling/u);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("defines the canonical accountability heading in one source location", () => {
  const checker = readFileSync(script, "utf8");
  const accountabilityPolicy = readFileSync(
    accountabilityPolicyScript,
    "utf8",
  );

  assert.equal(
    [checker, accountabilityPolicy].reduce(
      (count, source) =>
        count + [...source.matchAll(/## Architecture accountability/gu)].length,
      0,
    ),
    1,
  );
  assert.doesNotMatch(checker, /## Architecture accountability/u);
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

function sourceMeasurement(source) {
  return {
    lines: source.trimEnd().split(/\r?\n/u).length,
    helpers: source.match(/^(?:export )?function /gmu)?.length ?? 0,
  };
}

function assertRoadmapPolicyOwnership({ inventory, accountability, runner }) {
  assert.match(
    inventory,
    /import\s+\{\s*validateArchitectureAccountability\s*\}\s+from\s+"\.\/roadmap-accountability-policy\.mjs";/u,
    "the inventory owner must import the accountability policy",
  );
  assert.match(
    inventory,
    /validateArchitectureAccountability\(\s*roadmap,\s*roadmapPath,\s*fail,?\s*\)/u,
    "the inventory owner must invoke the accountability policy",
  );
  assert.match(
    accountability,
    /from "mdast-util-from-markdown";/u,
    "the accountability owner must delegate block interpretation to mdast",
  );
  assert.doesNotMatch(
    inventory,
    /(?:mdast|micromark|fromMarkdown|gfmTable)/u,
    "the inventory owner must not interpret Markdown",
  );
  assert.doesNotMatch(
    runner,
    /(?:fromMarkdown|mdast|micromark)/u,
    "the transport runner must not acquire Markdown interpretation",
  );
  assert.doesNotMatch(
    accountability,
    /(?:node:|process\.|readFile|writeFile|execFile|spawnSync)/u,
    "the pure accountability policy must not acquire transport",
  );

  for (const policyHelper of [
    "accountabilityHeaderKind",
    "canonicalMechanismIdentity",
    "markdownCommentRanges",
    "parseMarkdown",
    "validateArchitectureAccountability",
  ]) {
    assert.doesNotMatch(
      inventory,
      new RegExp(`function ${policyHelper}\\(`, "u"),
      `the inventory owner must not define ${policyHelper}`,
    );
  }

  const budgets = [
    ["roadmap inventory owner", inventory, 350, 10],
    ["accountability policy owner", accountability, 700, 20],
    ["roadmap transport runner", runner, 250, 2],
  ];
  for (const [name, source, lineCeiling, helperCeiling] of budgets) {
    const measurement = sourceMeasurement(source);
    assert.ok(
      measurement.lines <= lineCeiling,
      `${name} has ${measurement.lines} lines; reviewed ceiling is ${lineCeiling}`,
    );
    assert.ok(
      measurement.helpers <= helperCeiling,
      `${name} has ${measurement.helpers} helpers; reviewed ceiling is ${helperCeiling}`,
    );
  }
}

test("delegates roadmap policy to bounded pure owners", () => {
  const checker = readFileSync(script, "utf8");
  const accountabilityPolicy = readFileSync(
    accountabilityPolicyScript,
    "utf8",
  );
  const runner = readFileSync(
    new URL("./roadmap-inventory-runner.mjs", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const expectedParserPins = {
    "mdast-util-from-markdown": "2.0.3",
    "mdast-util-gfm-table": "2.0.0",
    "mdast-util-to-string": "4.0.0",
    "micromark-extension-gfm-table": "2.1.1",
  };

  for (const [packageName, version] of Object.entries(expectedParserPins)) {
    assert.equal(
      packageJson.devDependencies?.[packageName],
      version,
      `${packageName} must be an exact direct development dependency`,
    );
  }
  for (const bespokeParserHelper of [
    "findExactBacktickRun",
    "keepsMarkdownParagraphOpen",
    "markdownInlineLinkAt",
    "markdownTableCells",
    "rawHtmlBlockEnds",
    "rawHtmlBlockStart",
    "renderInlineLinkLabels",
    "stripClosedInlineHtmlComments",
  ]) {
    assert.doesNotMatch(
      accountabilityPolicy,
      new RegExp(`function ${bespokeParserHelper}\\(`, "u"),
      `${bespokeParserHelper} must not recreate maintained Markdown parsing`,
    );
  }

  assertRoadmapPolicyOwnership({
    inventory: checker,
    accountability: accountabilityPolicy,
    runner,
  });
  assert.throws(
    () =>
      assertRoadmapPolicyOwnership({
        inventory: `${checker}\nfunction parseMarkdown(source) { return source; }\n`,
        accountability: accountabilityPolicy,
        runner,
      }),
    /inventory owner must not define parseMarkdown/u,
  );

  const inventoryMeasurement = sourceMeasurement(checker);
  const accountabilityMeasurement = sourceMeasurement(accountabilityPolicy);
  for (const referencePath of [
    "../docs/workflows/repository-maintenance/README.md",
    "../docs/workflows/repository-maintenance/test-plan.md",
  ]) {
    const reference = readFileSync(
      new URL(referencePath, import.meta.url),
      "utf8",
    );
    assert.match(
      reference,
      new RegExp(
        `${inventoryMeasurement.lines}\\s+lines\\s+and\\s+${inventoryMeasurement.helpers}\\s+top-level\\s+helpers`,
        "u",
      ),
      `${referencePath} must publish the inventory-owner measurement`,
    );
    assert.match(
      reference,
      new RegExp(
        `${accountabilityMeasurement.lines}\\s+lines\\s+and\\s+${accountabilityMeasurement.helpers}\\s+top-level\\s+helpers`,
        "u",
      ),
      `${referencePath} must publish the accountability-owner measurement`,
    );
    assert.match(
      reference,
      /down from 1,429\s+lines and 38\s+(?:top-level\s+)?helpers/u,
      `${referencePath} must publish the measured baseline`,
    );
    assert.doesNotMatch(reference, /34-helper baseline/u);
  }
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
  const installDependencies = maintenance.indexOf("run: npm ci");
  const selfTest = maintenance.indexOf(
    "run: node --test scripts/check-roadmap-inventory.test.mjs",
  );
  assert.ok(
    installDependencies >= 0 && installDependencies < selfTest,
    "the clean maintenance lane must install locked parser dependencies before use",
  );
  assert.match(
    maintenance,
    /node scripts\/check-roadmap-inventory\.mjs\s+--live\s+--repo "\$REPOSITORY"/u,
  );
});
