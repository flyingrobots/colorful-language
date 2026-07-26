#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const authorityPath = `${root}/contracts/colorful/vocabulary.v1.schema.json`;
const generatedPaths = Object.freeze({
  rust: "crates/colorful-ir/src/generated/vocabulary_validator_v1.rs",
  javascript: "consumers/generated/vocabulary-validator-v1.mjs",
  schemaCopy: "crates/colorful-ir/contracts/vocabulary.v1.schema.json",
});

function fail(message) {
  throw new Error(`invalid vocabulary validator schema: ${message}`);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function enumValues(schema, name) {
  const definition = object(object(schema.$defs, "$defs")[name], `$defs.${name}`);
  if (!Array.isArray(definition.enum) || definition.enum.length === 0) {
    fail(`$defs.${name}.enum must be a non-empty array`);
  }
  const values = definition.enum;
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
      fail(`$defs.${name}.enum contains invalid value ${JSON.stringify(value)}`);
    }
    if (seen.has(value)) fail(`$defs.${name}.enum contains duplicate ${value}`);
    seen.add(value);
  }
  return values;
}

function classRoleKeys(schema, enums) {
  const definition = object(
    object(schema.$defs, "$defs").classRoleKey,
    "$defs.classRoleKey",
  );
  if (!Array.isArray(definition.oneOf) || definition.oneOf.length === 0) {
    fail("$defs.classRoleKey.oneOf must be a non-empty array");
  }
  const keys = [];
  const seen = new Set();
  const expectedFields = ["lexicalClass", "openClassKind", "tokenKind"];
  for (const [index, entry] of definition.oneOf.entries()) {
    const candidate = object(entry, `classRoleKey.oneOf[${index}]`);
    const properties = object(
      candidate.properties,
      `classRoleKey.oneOf[${index}].properties`,
    );
    const fields = Object.keys(properties).sort();
    if (
      fields.length !== expectedFields.length ||
      fields.some((field, fieldIndex) => field !== expectedFields[fieldIndex])
    ) {
      fail(
        `classRoleKey.oneOf[${index}].properties must contain exactly ${expectedFields.join(", ")}`,
      );
    }
    if (
      !Array.isArray(candidate.required) ||
      candidate.required.length !== expectedFields.length ||
      [...candidate.required]
        .sort()
        .some((field, fieldIndex) => field !== expectedFields[fieldIndex])
    ) {
      fail(
        `classRoleKey.oneOf[${index}].required must contain exactly ${expectedFields.join(", ")}`,
      );
    }
    const value = {};
    for (const field of expectedFields) {
      const constraint = object(
        properties[field],
        `classRoleKey.oneOf[${index}].properties.${field}`,
      );
      if (
        !Object.hasOwn(constraint, "const") ||
        Object.keys(constraint).length !== 1
      ) {
        fail(
          `classRoleKey.oneOf[${index}].properties.${field} must contain only const`,
        );
      }
      value[field] = constraint.const;
    }
    if (!enums.tokenKinds.includes(value.tokenKind)) {
      fail(`classRoleKey.oneOf[${index}] has unknown tokenKind ${value.tokenKind}`);
    }
    if (value.lexicalClass !== null && !enums.lexicalClasses.includes(value.lexicalClass)) {
      fail(`classRoleKey.oneOf[${index}] has unknown lexicalClass ${value.lexicalClass}`);
    }
    if (value.openClassKind !== null && !enums.openClassKinds.includes(value.openClassKind)) {
      fail(`classRoleKey.oneOf[${index}] has unknown openClassKind ${value.openClassKind}`);
    }
    const key = [
      value.tokenKind,
      value.lexicalClass ?? "<none>",
      value.openClassKind ?? "<none>",
    ].join("/");
    if (seen.has(key)) fail(`classRoleKey.oneOf contains duplicate ${key}`);
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function rustVariant(value) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function rustMatch(typeName, functionName, values) {
  const arms = values
    .map((value) => `        ${typeName}::${rustVariant(value)} => "${value}",`)
    .join("\n");
  return `pub(crate) fn ${functionName}(value: &${typeName}) -> &'static str {\n    match value {\n${arms}\n    }\n}`;
}

function rustArray(name, values) {
  const lines = values.map((value) => `    "${value}",`).join("\n");
  return `pub(crate) const ${name}: &[&str] = &[\n${lines}\n];`;
}

function javascriptSet(name, values) {
  const lines = values.map((value) => `  ${JSON.stringify(value)},`).join("\n");
  return `export const ${name} = new Set([\n${lines}\n]);`;
}

export function renderVocabularyValidators(schema) {
  object(schema, "root");
  const enums = {
    tokenKinds: enumValues(schema, "tokenKind"),
    lexicalClasses: enumValues(schema, "lexicalClass"),
    openClassKinds: enumValues(schema, "openClassKind"),
    visualRoles: enumValues(schema, "visualRole"),
  };
  const keys = classRoleKeys(schema, enums);

  const rust = `// @generated by scripts/generate-vocabulary-validators.mjs.
// Source: contracts/colorful/vocabulary.v1.schema.json. DO NOT EDIT.

use crate::syntax_v1::{LexicalClass, OpenClassKind, TokenKind};
use crate::vocabulary_v1::VisualRole;

${rustArray("VISUAL_ROLE_NAMES", enums.visualRoles)}

${rustArray("EXPECTED_CLASS_ROLE_KEYS", keys)}

${rustMatch("TokenKind", "token_kind_name", enums.tokenKinds)}

${rustMatch("LexicalClass", "lexical_class_name", enums.lexicalClasses)}

${rustMatch("OpenClassKind", "open_class_kind_name", enums.openClassKinds)}

${rustMatch("VisualRole", "visual_role_name", enums.visualRoles)}

pub(crate) fn class_role_key(
    token_kind: &TokenKind,
    lexical_class: Option<&LexicalClass>,
    open_class_kind: Option<&OpenClassKind>,
) -> Result<String, String> {
    let token_kind = token_kind_name(token_kind);
    let lexical_class = lexical_class.map_or("<none>", lexical_class_name);
    let open_class_kind = open_class_kind.map_or("<none>", open_class_kind_name);
    let key = format!("{token_kind}/{lexical_class}/{open_class_kind}");
    if EXPECTED_CLASS_ROLE_KEYS.contains(&key.as_str()) {
        Ok(key)
    } else {
        Err(format!(
            "{token_kind} class role has unsupported lexicalClass/openClassKind key \`{key}\`"
        ))
    }
}
`;

  const javascript = `// @generated by scripts/generate-vocabulary-validators.mjs.
// Source: contracts/colorful/vocabulary.v1.schema.json. DO NOT EDIT.

${javascriptSet("TOKEN_KINDS", enums.tokenKinds)}

${javascriptSet("LEXICAL_CLASSES", enums.lexicalClasses)}

${javascriptSet("OPEN_CLASS_KINDS", enums.openClassKinds)}

${javascriptSet("VISUAL_ROLES", enums.visualRoles)}

${javascriptSet("EXPECTED_CLASS_KEYS", keys)}

export function classRoleKey(rule) {
  if (!TOKEN_KINDS.has(rule.tokenKind)) {
    throw new Error(\`unknown tokenKind \${rule.tokenKind}\`);
  }
  if (rule.lexicalClass !== null && !LEXICAL_CLASSES.has(rule.lexicalClass)) {
    throw new Error(\`unknown lexicalClass \${rule.lexicalClass}\`);
  }
  if (rule.openClassKind !== null && !OPEN_CLASS_KINDS.has(rule.openClassKind)) {
    throw new Error(\`unknown openClassKind \${rule.openClassKind}\`);
  }
  if (!VISUAL_ROLES.has(rule.visualRole)) {
    throw new Error(\`unknown visualRole \${rule.visualRole}\`);
  }
  const key =
    \`\${rule.tokenKind}/\${rule.lexicalClass ?? "<none>"}/\${rule.openClassKind ?? "<none>"}\`;
  if (!EXPECTED_CLASS_KEYS.has(key)) {
    throw new Error(
      \`\${rule.tokenKind} class role has unsupported lexicalClass/openClassKind key \${key}\`,
    );
  }
  return key;
}
`;

  return { rust, javascript };
}

export function generateVocabularyValidators(outputRoot = root) {
  const schemaText = readFileSync(authorityPath, "utf8");
  const schema = JSON.parse(schemaText);
  const rendered = renderVocabularyValidators(schema);
  const outputs = {
    [generatedPaths.rust]: rendered.rust,
    [generatedPaths.javascript]: rendered.javascript,
    [generatedPaths.schemaCopy]: schemaText,
  };
  for (const [relativePath, contents] of Object.entries(outputs)) {
    const outputPath = resolve(outputRoot, relativePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, contents);
  }
  return Object.keys(outputs);
}

function main(args) {
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--output-root")) {
    throw new Error("usage: node scripts/generate-vocabulary-validators.mjs [--output-root DIR]");
  }
  const outputRoot = args.length === 0 ? root : resolve(args[1]);
  const outputs = generateVocabularyValidators(outputRoot);
  for (const output of outputs) console.log(`generated ${output}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2));
}
