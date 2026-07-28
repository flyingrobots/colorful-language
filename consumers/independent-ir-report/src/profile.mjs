import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { fail, isRecord, parseJson, sha256 } from "./common.mjs";

function requiredString(record, field) {
  if (typeof record[field] !== "string" || record[field].length === 0) {
    fail("E_PROFILE", `profile ${field} must be a non-empty string`);
  }
  return record[field];
}

function axisKey(tokenKind, lexicalClass, openClassKind) {
  return JSON.stringify([
    tokenKind,
    lexicalClass ?? null,
    openClassKind ?? null,
  ]);
}

function enumValues(syntax, name, optional = false) {
  const match = new RegExp(
    `(?:^|\\n)enum ${name} \\{([\\s\\S]*?)\\n\\}`,
    "u",
  ).exec(syntax);
  if (!match) {
    if (optional) return null;
    fail("E_PROFILE", `profile SDL is missing enum ${name}`);
  }
  const values = new Set(
    match[1]
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => /^[_A-Z][_0-9A-Z]*$/u.test(line)),
  );
  if (values.size === 0) {
    fail("E_PROFILE", `profile SDL enum ${name} has no values`);
  }
  return values;
}

export function loadProfile(directory) {
  const metadata = parseJson(
    readFileSync(path.join(directory, "profile.json"), "utf8"),
    "E_PROFILE",
  );
  const syntax = readFileSync(path.join(directory, "syntax.v1.graphql"), "utf8");
  const vocabularyText = readFileSync(
    path.join(directory, "vocabulary.v1.json"),
    "utf8",
  );
  const vocabulary = parseJson(vocabularyText, "E_PROFILE");

  if (
    !isRecord(metadata) ||
    metadata.profileVersion !== "colorful.consumer-profile/v1" ||
    typeof metadata.openClassKindField !== "boolean" ||
    !isRecord(vocabulary) ||
    vocabulary.version !== "colorful.vocabulary/v1" ||
    !Array.isArray(vocabulary.classRoles) ||
    !Array.isArray(vocabulary.roleProjections)
  ) {
    fail("E_PROFILE", "release profile has an unsupported shape");
  }

  const schemaHash = sha256(syntax);
  const vocabularyHash = sha256(vocabularyText);
  if (schemaHash !== metadata.schemaHash) {
    fail("E_PROFILE", "profile schema hash does not match its bundled SDL");
  }
  if (vocabularyHash !== metadata.vocabularyHash) {
    fail(
      "E_PROFILE",
      "profile vocabulary hash does not match its bundled manifest",
    );
  }

  const rolesByAxes = new Map();
  for (const entry of vocabulary.classRoles) {
    if (
      !isRecord(entry) ||
      typeof entry.tokenKind !== "string" ||
      typeof entry.visualRole !== "string"
    ) {
      fail("E_PROFILE", "profile contains a malformed class-role entry");
    }
    const key = axisKey(
      entry.tokenKind,
      entry.lexicalClass,
      entry.openClassKind,
    );
    if (rolesByAxes.has(key)) {
      fail("E_PROFILE", `profile contains duplicate token axes ${key}`);
    }
    rolesByAxes.set(key, entry.visualRole);
  }

  const projectionsByRole = new Map();
  const rolesByAnsi = new Map();
  const rolesByLspType = new Map();
  const lspLegend = [];
  for (const projection of vocabulary.roleProjections) {
    if (
      !isRecord(projection) ||
      typeof projection.visualRole !== "string" ||
      !(
        projection.ansi === null || typeof projection.ansi === "string"
      ) ||
      !(
        projection.lspTokenType === null ||
        typeof projection.lspTokenType === "string"
      )
    ) {
      fail("E_PROFILE", "profile contains a malformed role projection");
    }
    if (projectionsByRole.has(projection.visualRole)) {
      fail(
        "E_PROFILE",
        `profile contains duplicate role ${projection.visualRole}`,
      );
    }
    projectionsByRole.set(projection.visualRole, projection);
    if (projection.ansi !== null) {
      if (rolesByAnsi.has(projection.ansi)) {
        fail("E_PROFILE", `profile contains duplicate ANSI ${projection.ansi}`);
      }
      rolesByAnsi.set(projection.ansi, projection.visualRole);
    }
    if (projection.lspTokenType !== null) {
      if (rolesByLspType.has(projection.lspTokenType)) {
        fail(
          "E_PROFILE",
          `profile contains duplicate LSP type ${projection.lspTokenType}`,
        );
      }
      rolesByLspType.set(projection.lspTokenType, projection.visualRole);
      lspLegend.push(projection.lspTokenType);
    }
  }

  return Object.freeze({
    directory,
    profileVersion: metadata.profileVersion,
    release: requiredString(metadata, "release"),
    commit: requiredString(metadata, "commit"),
    contractVersion: requiredString(metadata, "contractVersion"),
    schemaHash,
    vocabularyHash,
    openClassKindField: metadata.openClassKindField,
    enums: Object.freeze({
      tokenKind: enumValues(syntax, "TokenKind"),
      lexicalClass: enumValues(syntax, "LexicalClass"),
      functionKind: enumValues(syntax, "FunctionKind"),
      openClassKind: enumValues(
        syntax,
        "OpenClassKind",
        !metadata.openClassKindField,
      ),
      outlineKind: enumValues(syntax, "OutlineKind"),
      diagnosticSeverity: enumValues(syntax, "DiagnosticSeverity"),
    }),
    rolesByAxes,
    projectionsByRole,
    rolesByAnsi,
    rolesByLspType,
    lspLegend,
  });
}

export function loadProfiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadProfile(path.join(directory, entry.name)))
    .sort((left, right) =>
      left.release < right.release ? -1 : Number(left.release > right.release),
    );
}

export function roleForAxes(
  profile,
  tokenKind,
  lexicalClass,
  openClassKind,
) {
  return profile.rolesByAxes.get(
    axisKey(tokenKind, lexicalClass, openClassKind),
  );
}
