import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderVocabularyValidators } from "./generate-vocabulary-validators.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const authorityPath = `${root}/contracts/colorful/vocabulary.v1.schema.json`;
const extensionPath =
  `${root}/crates/colorful-ir/tests/fixtures/vocabulary-schema-extension.json`;
const rustPath =
  `${root}/crates/colorful-ir/src/generated/vocabulary_validator_v1.rs`;
const javascriptPath =
  `${root}/consumers/generated/vocabulary-validator-v1.mjs`;

const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
const extension = JSON.parse(readFileSync(extensionPath, "utf8"));
const rendered = renderVocabularyValidators(authority);

assert.equal(
  rendered.rust,
  readFileSync(rustPath, "utf8"),
  "committed Rust validator must match the schema authority",
);
assert.equal(
  rendered.javascript,
  readFileSync(javascriptPath, "utf8"),
  "committed JavaScript validator must match the schema authority",
);

const extendedAuthority = structuredClone(authority);
extendedAuthority.$defs.visualRole.enum.push(extension.visualRole);
extendedAuthority.$defs.classRoleKey.oneOf.push({ const: extension.classRoleKey });
const extended = renderVocabularyValidators(extendedAuthority);
const key = [
  extension.classRoleKey.tokenKind,
  extension.classRoleKey.lexicalClass ?? "<none>",
  extension.classRoleKey.openClassKind ?? "<none>",
].join("/");

assert.notEqual(extended.rust, rendered.rust);
assert.notEqual(extended.javascript, rendered.javascript);
for (const output of [extended.rust, extended.javascript]) {
  assert.match(output, new RegExp(`\\b${extension.visualRole}\\b`));
  assert.match(output, new RegExp(key));
}

console.log("vocabulary validator generation tests passed");
