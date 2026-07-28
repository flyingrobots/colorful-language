import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicApiDoctestPolicyError,
  validatePublicApiDoctestPolicy,
} from "./check-public-api-doctests.mjs";

const VALID_SNAPSHOT = Object.freeze({
  core: `
/// # Examples
/// \`\`\`
/// # // public-api-doctest: parser
/// let tree = parser.parse("text");
/// assert_eq!(tree.len(), 1);
/// \`\`\`
pub trait Parser {}
/// # Examples
/// \`\`\`
/// # // public-api-doctest: annotator
/// let tokens = annotator.annotate("text", &tree);
/// assert_eq!(tokens.len(), 1);
/// \`\`\`
pub trait Annotator {}
/// # Examples
/// \`\`\`
/// # // public-api-doctest: analyzer
/// let findings = analyzer.analyze("text", &tree, &tokens);
/// assert_eq!(findings.len(), 1);
/// \`\`\`
pub trait Analyzer {}
`,
  projection: `
/// # Examples
/// \`\`\`
/// # // public-api-doctest: ir-projection
/// let document = build_document("id", "text", &parser, &annotator)?;
/// assert_eq!(document.tokens.len(), 1);
/// \`\`\`
pub fn build_document() {}
`,
  vocabulary: `
/// # Examples
/// \`\`\`
/// # // public-api-doctest: vocabulary
/// let role = visual_role(&kind, None, None);
/// assert_eq!(role, None);
/// \`\`\`
pub fn visual_role() {}
`,
  workflow: `
jobs:
  rust:
    steps:
      - run: cargo test --doc --workspace --locked
`,
});

function expectPolicyError(snapshot, code, detail) {
  assert.throws(
    () => validatePublicApiDoctestPolicy(snapshot),
    (error) => {
      assert.ok(error instanceof PublicApiDoctestPolicyError);
      assert.equal(error.code, code);
      assert.match(error.message, detail);
      return true;
    },
  );
}

test("accepts every named doctest and the explicit CI command", () => {
  assert.doesNotThrow(() => validatePublicApiDoctestPolicy(VALID_SNAPSHOT));
});

for (const [file, marker] of [
  ["core", "parser"],
  ["core", "annotator"],
  ["core", "analyzer"],
  ["projection", "ir-projection"],
  ["vocabulary", "vocabulary"],
]) {
  test(`rejects a missing ${marker} doctest marker`, () => {
    const snapshot = {
      ...VALID_SNAPSHOT,
      [file]: VALID_SNAPSHOT[file].replace(
        `# // public-api-doctest: ${marker}`,
        "",
      ),
    };
    expectPolicyError(snapshot, "E_API_DOCTEST_MISSING", new RegExp(marker));
  });

  test(`rejects a duplicate ${marker} doctest marker`, () => {
    const snapshot = {
      ...VALID_SNAPSHOT,
      [file]: `${VALID_SNAPSHOT[file]}\n# // public-api-doctest: ${marker}\n`,
    };
    expectPolicyError(snapshot, "E_API_DOCTEST_DUPLICATE", new RegExp(marker));
  });
}

test("rejects an implicit or misspelled workspace doctest command", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow.replace(" --doc", ""),
  };
  expectPolicyError(
    snapshot,
    "E_API_DOCTEST_CI_MISSING",
    /cargo test --doc --workspace --locked/,
  );
});

test("rejects the doctest command when it exists only in a comment", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: `
# cargo test --doc --workspace --locked
jobs:
  rust:
    steps: []
`,
  };
  expectPolicyError(
    snapshot,
    "E_API_DOCTEST_CI_MISSING",
    /cargo test --doc --workspace --locked/,
  );
});

test("rejects a doctest command outside the normal Rust job", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow.replace("rust:", "docs:"),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_CI_MISSING", /Rust job/);
});

test("rejects a guarded Rust job", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow.replace(
      "  rust:\n",
      "  rust:\n    if: false\n",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_CI_DISABLED", /Rust job/);
});

test("rejects a guarded doctest step", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow.replace(
      "      - run:",
      "      - if: false\n        run:",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_CI_DISABLED", /doctest step/);
});

test("rejects a non-blocking Rust job", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow.replace(
      "  rust:\n",
      "  rust:\n    continue-on-error: true\n",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_CI_NON_BLOCKING", /Rust job/);
});

test("rejects a non-blocking doctest step", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow.replace(
      "      - run:",
      "      - continue-on-error: true\n        run:",
    ),
  };
  expectPolicyError(
    snapshot,
    "E_API_DOCTEST_CI_NON_BLOCKING",
    /doctest step/,
  );
});

test("accepts explicit blocking configuration", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    workflow: VALID_SNAPSHOT.workflow
      .replace("  rust:\n", "  rust:\n    continue-on-error: false\n")
      .replace(
        "      - run:",
        "      - continue-on-error: false\n        run:",
      ),
  };
  assert.doesNotThrow(() => validatePublicApiDoctestPolicy(snapshot));
});

test("rejects a marker moved outside its API documentation", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    core: VALID_SNAPSHOT.core.replace(
      "/// # // public-api-doctest: parser",
      "// # // public-api-doctest: parser",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_MISSING", /pub trait Parser/);
});

test("rejects an API marker moved outside a rustdoc code fence", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    core: VALID_SNAPSHOT.core.replace(
      "/// ```\n/// # // public-api-doctest: parser",
      "/// ```\n/// ```\n/// # // public-api-doctest: parser",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_MISSING", /fenced parser/);
});

test("rejects a marker-only doctest fence", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    core: VALID_SNAPSHOT.core
      .replace('/// let tree = parser.parse("text");\n', "")
      .replace("/// assert_eq!(tree.len(), 1);\n", ""),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_ORACLE_MISSING", /parser/);
});

test("rejects an example without its named API invocation", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    core: VALID_SNAPSHOT.core.replace(
      '/// let tree = parser.parse("text");',
      "/// let tree = vec![1];",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_ORACLE_MISSING", /\.parse/);
});

test("rejects an example without an executable assertion", () => {
  const snapshot = {
    ...VALID_SNAPSHOT,
    core: VALID_SNAPSHOT.core.replace(
      "/// assert_eq!(tree.len(), 1);",
      "/// let _length = tree.len();",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_ORACLE_MISSING", /assertion/);
});
