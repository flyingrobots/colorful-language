import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderVocabularyValidators } from "./generate-vocabulary-validators.mjs";
import {
  classRoleKey as javascriptClassRoleKey,
} from "../consumers/generated/vocabulary-validator-v1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const authorityPath = `${root}/contracts/colorful/vocabulary.v1.schema.json`;
const extensionPath =
  `${root}/crates/colorful-ir/tests/fixtures/vocabulary-schema-extension.json`;
const parityPath =
  `${root}/crates/colorful-ir/tests/fixtures/vocabulary-validator-parity.json`;
const rustPath =
  `${root}/crates/colorful-ir/src/generated/vocabulary_validator_v1.rs`;
const javascriptPath =
  `${root}/consumers/generated/vocabulary-validator-v1.mjs`;

const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
const extension = JSON.parse(readFileSync(extensionPath, "utf8"));
const parity = JSON.parse(readFileSync(parityPath, "utf8"));
const rendered = renderVocabularyValidators(authority);

assert.equal(
  authority.$defs.classRole.$ref,
  "#/$defs/classRoleKey",
  "classRole must apply the legal axis-key matrix during standard schema validation",
);
assert.equal(
  Object.hasOwn(authority.$defs.classRole, "allOf"),
  false,
  "classRole must use a direct draft-2020-12 $ref",
);

function schemaAcceptsClassRoleKey(schema, rule) {
  const matches = schema.$defs.classRoleKey.oneOf.filter((candidate) =>
    Object.entries(candidate.properties).every(
      ([field, constraint]) => rule[field] === constraint.const,
    ),
  );
  return matches.length === 1;
}

assert.equal(
  schemaAcceptsClassRoleKey(authority, {
    tokenKind: "NUMBER",
    lexicalClass: null,
    openClassKind: null,
  }),
  true,
  "the schema key matrix must accept a legal NUMBER role",
);
assert.equal(
  schemaAcceptsClassRoleKey(authority, {
    tokenKind: "NUMBER",
    lexicalClass: "CONTENT",
    openClassKind: null,
  }),
  false,
  "the schema key matrix must reject a NUMBER role with lexicalClass",
);

for (const { name, accepted, ...rule } of parity.cases) {
  let actual = true;
  try {
    javascriptClassRoleKey(rule);
  } catch {
    actual = false;
  }
  assert.equal(
    actual,
    accepted,
    `generated JavaScript validator parity case ${name}`,
  );
}

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
extendedAuthority.$defs.classRoleKey.oneOf.push({
  properties: Object.fromEntries(
    Object.entries(extension.classRoleKey).map(([field, value]) => [
      field,
      { const: value },
    ]),
  ),
  required: ["tokenKind", "lexicalClass", "openClassKind"],
});
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
