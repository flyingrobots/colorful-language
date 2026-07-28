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
/// \`\`\`
pub trait Parser {}
/// # Examples
/// \`\`\`
/// # // public-api-doctest: annotator
/// \`\`\`
pub trait Annotator {}
/// # Examples
/// \`\`\`
/// # // public-api-doctest: analyzer
/// \`\`\`
pub trait Analyzer {}
`,
  projection: `
/// # Examples
/// \`\`\`
/// # // public-api-doctest: ir-projection
/// \`\`\`
pub fn build_document() {}
`,
  vocabulary: `
/// # Examples
/// \`\`\`
/// # // public-api-doctest: vocabulary
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
      "/// ```\n/// # // public-api-doctest: parser\n/// ```",
      "/// ```\n/// ```\n/// # // public-api-doctest: parser",
    ),
  };
  expectPolicyError(snapshot, "E_API_DOCTEST_MISSING", /fenced parser/);
});
