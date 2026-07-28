import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { fail, isRecord, parseJson, sha256 } from "./common.mjs";

const COMPATIBILITY = loadCompatibilityManifest();
const PROFILE_FIELDS = [
  "commit",
  "contractVersion",
  "profileVersion",
  "release",
  "schemaHash",
  "vocabularyHash",
];

function requiredString(record, field) {
  if (typeof record[field] !== "string" || record[field].length === 0) {
    fail("E_PROFILE", `profile ${field} must be a non-empty string`);
  }
  return record[field];
}

function hasExactFields(record, expected) {
  if (!isRecord(record)) return false;
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((field, index) => field === wanted[index])
  );
}

function loadCompatibilityManifest() {
  const manifest = parseJson(
    readFileSync(
      new URL("../compatibility.v1.json", import.meta.url),
      "utf8",
    ),
    "E_PROFILE",
  );
  if (
    !isRecord(manifest) ||
    manifest.version !== "colorful.syntax-compatibility/v1" ||
    manifest.contractFamily !== "colorful.syntax/v1" ||
    !Array.isArray(manifest.generations)
  ) {
    fail("E_PROFILE", "compatibility manifest has an unsupported shape");
  }
  return manifest;
}

function selectGeneration(metadata, compatibility) {
  const matches = compatibility.generations.filter((generation) =>
    isRecord(generation) &&
    isRecord(generation.identity) &&
    generation.identity.contractVersion === metadata.contractVersion &&
    generation.identity.schemaHash === metadata.schemaHash &&
    generation.identity.vocabularyHash === metadata.vocabularyHash
  );
  if (matches.length !== 1) {
    fail("E_PROFILE", "release profile names an unsupported identity tuple");
  }
  const [generation] = matches;
  if (
    typeof generation.id !== "string" ||
    !isRecord(generation.wireShape) ||
    !(
      generation.wireShape.openClassKind === "absent" ||
      generation.wireShape.openClassKind === "nullable"
    ) ||
    !(
      generation.schemaHashMode === "raw-sdl-sha256" ||
      generation.schemaHashMode === "descriptions-stripped-sdl-sha256"
    )
  ) {
    fail("E_PROFILE", "selected compatibility generation is malformed");
  }
  return generation;
}

function stripGraphqlDescriptions(sdl) {
  const lines = sdl.split(/\r\n|\n/u);
  if (
    lines.length > 0 &&
    lines[lines.length - 1] === "" &&
    /(?:\r\n|\n)$/u.test(sdl)
  ) {
    lines.pop();
  }
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        trimmed.length >= 2 &&
        trimmed.startsWith('"') &&
        trimmed.endsWith('"')
      );
    })
    .join("\n");
}

function profileSchemaHash(syntax, mode) {
  if (mode === "raw-sdl-sha256") return sha256(syntax);
  return sha256(stripGraphqlDescriptions(syntax));
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

export function loadProfile(directory, compatibility = COMPATIBILITY) {
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
    !hasExactFields(metadata, PROFILE_FIELDS) ||
    metadata.profileVersion !== "colorful.consumer-profile/v1" ||
    !isRecord(vocabulary) ||
    vocabulary.version !== "colorful.vocabulary/v1" ||
    !Array.isArray(vocabulary.classRoles) ||
    !Array.isArray(vocabulary.roleProjections)
  ) {
    fail("E_PROFILE", "release profile has an unsupported shape");
  }

  const contractVersion = requiredString(metadata, "contractVersion");
  const declaredSchemaHash = requiredString(metadata, "schemaHash");
  const declaredVocabularyHash = requiredString(metadata, "vocabularyHash");
  const generation = selectGeneration(
    {
      contractVersion,
      schemaHash: declaredSchemaHash,
      vocabularyHash: declaredVocabularyHash,
    },
    compatibility,
  );
  const schemaHash = profileSchemaHash(syntax, generation.schemaHashMode);
  const vocabularyHash = sha256(vocabularyText);
  if (schemaHash !== declaredSchemaHash) {
    fail("E_PROFILE", "profile schema hash does not match its bundled SDL");
  }
  if (vocabularyHash !== declaredVocabularyHash) {
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
  for (const [axes, role] of rolesByAxes) {
    if (!projectionsByRole.has(role)) {
      fail(
        "E_PROFILE",
        `profile class role ${role} for axes ${axes} has no projection`,
      );
    }
  }

  return Object.freeze({
    directory,
    profileVersion: metadata.profileVersion,
    generationId: generation.id,
    release: requiredString(metadata, "release"),
    commit: requiredString(metadata, "commit"),
    contractVersion,
    schemaHash,
    vocabularyHash,
    openClassKindField: generation.wireShape.openClassKind === "nullable",
    enums: Object.freeze({
      tokenKind: enumValues(syntax, "TokenKind"),
      lexicalClass: enumValues(syntax, "LexicalClass"),
      functionKind: enumValues(syntax, "FunctionKind"),
      openClassKind: enumValues(
        syntax,
        "OpenClassKind",
        generation.wireShape.openClassKind === "absent",
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

export function loadProfiles(directory, compatibility = COMPATIBILITY) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      loadProfile(path.join(directory, entry.name), compatibility)
    )
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
