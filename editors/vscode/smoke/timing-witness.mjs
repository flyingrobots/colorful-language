const SCHEMA_VERSION = "colorful.install-to-first-highlight/v1";
const START_EVENT = "before-isolated-vsix-install";
const END_EVENT = "first-plaintext-diagnostic-and-semantic-tokens";
const STRING_ENVIRONMENT_FIELDS = Object.freeze([
  "architecture",
  "cpu",
  "extension",
  "node",
  "operatingSystem",
  "rustc",
  "server",
  "vscode",
]);
const POSITIVE_INTEGER_ENVIRONMENT_FIELDS = Object.freeze([
  "logicalCpuCount",
  "memoryBytes",
]);
const REQUIRED_ENVIRONMENT_FIELDS = Object.freeze([
  ...STRING_ENVIRONMENT_FIELDS,
  ...POSITIVE_INTEGER_ENVIRONMENT_FIELDS,
]);

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function requireEnvironment(environment) {
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new TypeError("environment must be a mapping");
  }
  for (const [name, value] of Object.entries(environment)) {
    if (
      (typeof value !== "string" || value.length === 0) &&
      !Number.isSafeInteger(value)
    ) {
      throw new TypeError(
        `environment.${name} must be a non-empty string or safe integer`,
      );
    }
  }
  for (const name of REQUIRED_ENVIRONMENT_FIELDS) {
    if (!Object.hasOwn(environment, name)) {
      throw new TypeError(`environment.${name} is required`);
    }
  }
  for (const name of STRING_ENVIRONMENT_FIELDS) {
    requireNonEmptyString(environment[name], `environment.${name}`);
  }
  for (const name of POSITIVE_INTEGER_ENVIRONMENT_FIELDS) {
    requirePositiveInteger(environment[name], `environment.${name}`);
  }
}

export function createInstallationTimingWitness({
  installationStartedAtUnixMs,
  firstHighlightAtUnixMs,
  environment,
}) {
  requireNonNegativeInteger(
    installationStartedAtUnixMs,
    "installationStartedAtUnixMs",
  );
  requireNonNegativeInteger(firstHighlightAtUnixMs, "firstHighlightAtUnixMs");
  if (firstHighlightAtUnixMs < installationStartedAtUnixMs) {
    throw new RangeError("first highlight must not precede installation start");
  }
  requireEnvironment(environment);

  return {
    schemaVersion: SCHEMA_VERSION,
    observational: true,
    correctnessThresholdMs: null,
    startEvent: START_EVENT,
    endEvent: END_EVENT,
    installationStartedAtUnixMs,
    firstHighlightAtUnixMs,
    durationMs: firstHighlightAtUnixMs - installationStartedAtUnixMs,
    environment: { ...environment },
  };
}

export const installationTimingEvents = Object.freeze({
  start: START_EVENT,
  end: END_EVENT,
});
