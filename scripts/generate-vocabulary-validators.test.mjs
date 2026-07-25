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

const invalidSchemas = [
  {
    name: "malformed $defs",
    error: "$defs must be an object",
    mutate(schema) {
      schema.$defs = null;
    },
  },
  {
    name: "malformed enum definition",
    error: "$defs.tokenKind must be an object",
    mutate(schema) {
      schema.$defs.tokenKind = null;
    },
  },
  {
    name: "empty enum",
    error: "$defs.tokenKind.enum must be a non-empty array",
    mutate(schema) {
      schema.$defs.tokenKind.enum = [];
    },
  },
  {
    name: "invalid enum value",
    error: '$defs.tokenKind.enum contains invalid value "word"',
    mutate(schema) {
      schema.$defs.tokenKind.enum[0] = "word";
    },
  },
  {
    name: "duplicate enum value",
    error: "$defs.tokenKind.enum contains duplicate WORD",
    mutate(schema) {
      schema.$defs.tokenKind.enum.push("WORD");
    },
  },
  {
    name: "malformed class-role key definition",
    error: "$defs.classRoleKey must be an object",
    mutate(schema) {
      schema.$defs.classRoleKey = null;
    },
  },
  {
    name: "empty class-role key matrix",
    error: "$defs.classRoleKey.oneOf must be a non-empty array",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf = [];
    },
  },
  {
    name: "malformed class-role key",
    error: "classRoleKey.oneOf[0] must be an object",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0] = null;
    },
  },
  {
    name: "malformed class-role properties",
    error: "classRoleKey.oneOf[0].properties must be an object",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].properties = null;
    },
  },
  {
    name: "unexpected class-role property",
    error:
      "classRoleKey.oneOf[0].properties must contain exactly lexicalClass, openClassKind, tokenKind",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].properties.unexpected = {
        const: null,
      };
    },
  },
  {
    name: "incomplete class-role required fields",
    error:
      "classRoleKey.oneOf[0].required must contain exactly lexicalClass, openClassKind, tokenKind",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].required.pop();
    },
  },
  {
    name: "malformed class-role constraint",
    error:
      "classRoleKey.oneOf[0].properties.tokenKind must be an object",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].properties.tokenKind = null;
    },
  },
  {
    name: "non-const class-role constraint",
    error:
      "classRoleKey.oneOf[0].properties.tokenKind must contain only const",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].properties.tokenKind.type = "string";
    },
  },
  {
    name: "unknown tokenKind reference",
    error: "classRoleKey.oneOf[0] has unknown tokenKind UNKNOWN",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].properties.tokenKind.const = "UNKNOWN";
    },
  },
  {
    name: "unknown lexicalClass reference",
    error: "classRoleKey.oneOf[0] has unknown lexicalClass UNKNOWN",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[0].properties.lexicalClass.const =
        "UNKNOWN";
    },
  },
  {
    name: "unknown openClassKind reference",
    error: "classRoleKey.oneOf[2] has unknown openClassKind UNKNOWN",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf[2].properties.openClassKind.const =
        "UNKNOWN";
    },
  },
  {
    name: "duplicate class-role key",
    error: "classRoleKey.oneOf contains duplicate WORD/FUNCTION/<none>",
    mutate(schema) {
      schema.$defs.classRoleKey.oneOf.push(
        structuredClone(schema.$defs.classRoleKey.oneOf[0]),
      );
    },
  },
];

for (const { name, error, mutate } of invalidSchemas) {
  const schema = structuredClone(authority);
  mutate(schema);
  assert.throws(
    () => renderVocabularyValidators(schema),
    {
      name: "Error",
      message: `invalid vocabulary validator schema: ${error}`,
    },
    name,
  );
}

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
