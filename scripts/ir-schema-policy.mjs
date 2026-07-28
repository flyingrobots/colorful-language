const NAME = "[_A-Za-z][_0-9A-Za-z]*";
const DEFINITION = new RegExp(`^(type|enum)\\s+(${NAME})\\s*\\{$`, "u");
const FIELD = new RegExp(`^(${NAME})\\s*:\\s*(.+)$`, "u");
const ENUM_VALUE = new RegExp(`^${NAME}$`, "u");
const NAMED_TYPE = new RegExp(`^${NAME}!?$`, "u");
const LIST_TYPE = new RegExp(`^\\[${NAME}!?\\]!?$`, "u");
const BUILT_IN_TYPES = new Set(["Boolean", "Float", "ID", "Int", "String"]);

export class SchemaPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaPolicyError";
  }
}

function fail(message) {
  throw new SchemaPolicyError(message);
}

function typeReference(source, context) {
  const compact = source.replaceAll(/\s/gu, "");
  if (!NAMED_TYPE.test(compact) && !LIST_TYPE.test(compact)) {
    fail(`${context} uses unsupported GraphQL type syntax ${source}`);
  }
  return compact;
}

function namedType(reference) {
  return reference.replaceAll(/[\[\]!]/gu, "");
}

function parseSchema(sdl) {
  if (typeof sdl !== "string") {
    fail("schema source must be a string");
  }
  const definitions = new Map();
  let active = null;
  for (const [lineIndex, rawLine] of sdl.split(/\r\n|\n/u).entries()) {
    const line = rawLine.trim();
    const context = `line ${lineIndex + 1}`;
    if (
      line.length === 0 ||
      line.startsWith("#") ||
      (line.startsWith('"') && line.endsWith('"'))
    ) {
      continue;
    }
    if (active === null) {
      const match = DEFINITION.exec(line);
      if (match === null) {
        fail(`${context} has unsupported top-level GraphQL syntax`);
      }
      const [, kind, name] = match;
      if (definitions.has(name)) {
        fail(`${context} repeats definition ${name}`);
      }
      active =
        kind === "type"
          ? { kind, name, fields: new Map() }
          : { kind, name, values: new Set() };
      definitions.set(name, active);
      continue;
    }
    if (line === "}") {
      active = null;
      continue;
    }
    if (active.kind === "enum") {
      if (!ENUM_VALUE.test(line)) {
        fail(`${context} has unsupported enum syntax in ${active.name}`);
      }
      if (active.values.has(line)) {
        fail(`${context} repeats enum value ${active.name}.${line}`);
      }
      active.values.add(line);
      continue;
    }
    const match = FIELD.exec(line);
    if (match === null) {
      fail(`${context} has unsupported field syntax in ${active.name}`);
    }
    const [, fieldName, sourceType] = match;
    if (active.fields.has(fieldName)) {
      fail(`${context} repeats field ${active.name}.${fieldName}`);
    }
    active.fields.set(
      fieldName,
      typeReference(sourceType, `${active.name}.${fieldName}`),
    );
  }
  if (active !== null) {
    fail(`definition ${active.name} is missing its closing brace`);
  }
  if (definitions.size === 0) {
    fail("schema contains no supported definitions");
  }
  return definitions;
}

function sameValues(left, right) {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function compareExistingDefinition(name, predecessor, current, additions) {
  if (current === undefined || current.kind !== predecessor.kind) {
    fail(`definition ${name} was removed or reinterpreted`);
  }
  if (predecessor.kind === "enum") {
    if (!sameValues(predecessor.values, current.values)) {
      fail(`existing enum ${name} changed members`);
    }
    return;
  }
  for (const [fieldName, predecessorType] of predecessor.fields) {
    const currentType = current.fields.get(fieldName);
    if (currentType !== predecessorType) {
      fail(`field ${name}.${fieldName} was removed or reinterpreted`);
    }
  }
  for (const [fieldName, currentType] of current.fields) {
    if (predecessor.fields.has(fieldName)) continue;
    if (currentType.endsWith("!")) {
      fail(`new field ${name}.${fieldName} is required`);
    }
    additions.push({
      coordinate: `${name}.${fieldName}`,
      referencedType: namedType(currentType),
    });
  }
}

function reachableNewDefinitions(current, predecessor, additions) {
  const newDefinitions = new Set(
    [...current.keys()].filter((name) => !predecessor.has(name)),
  );
  const reachable = new Set();
  const pending = additions.map((addition) => addition.referencedType);
  while (pending.length > 0) {
    const name = pending.pop();
    if (
      BUILT_IN_TYPES.has(name) ||
      predecessor.has(name) ||
      reachable.has(name)
    ) {
      continue;
    }
    const definition = current.get(name);
    if (definition === undefined) {
      fail(`new nullable field refers to missing definition ${name}`);
    }
    reachable.add(name);
    if (definition.kind === "type") {
      for (const reference of definition.fields.values()) {
        pending.push(namedType(reference));
      }
    }
  }
  for (const name of newDefinitions) {
    if (!reachable.has(name)) {
      fail(`new definition ${name} is not reachable from an added nullable field`);
    }
  }
}

export function classifySyntaxTransition(predecessorSdl, currentSdl) {
  const predecessor = parseSchema(predecessorSdl);
  const current = parseSchema(currentSdl);
  const additions = [];
  for (const [name, definition] of predecessor) {
    compareExistingDefinition(name, definition, current.get(name), additions);
  }
  reachableNewDefinitions(current, predecessor, additions);
  return additions
    .map((addition) => addition.coordinate)
    .sort();
}
