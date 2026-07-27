#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const manifestUrl = new URL("../.github/rulesets/mainline.json", import.meta.url);

export class RulesetContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RulesetContractError";
    this.code = code;
  }
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }

  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function fail(code, message) {
  throw new RulesetContractError(code, message);
}

function exactlyOneRule(rules, type, missingCode) {
  const matches = rules.filter((rule) => rule.type === type);
  if (matches.length !== 1) {
    fail(
      missingCode,
      `expected exactly one ${type} rule; found ${matches.length}`,
    );
  }
  return matches[0];
}

function sortedActors(actors) {
  return [...actors].sort((left, right) =>
    `${left.actor_type}:${left.actor_id}:${left.bypass_mode}`.localeCompare(
      `${right.actor_type}:${right.actor_id}:${right.bypass_mode}`,
    ),
  );
}

function sortedChecks(checks) {
  return [...checks].sort((left, right) =>
    `${left.context}:${left.integration_id}`.localeCompare(
      `${right.context}:${right.integration_id}`,
    ),
  );
}

export function loadManifest() {
  return JSON.parse(readFileSync(manifestUrl, "utf8"));
}

export function makeUpdatePayload(manifest) {
  const {
    name,
    target,
    enforcement,
    bypass_actors: bypassActors,
    conditions,
    rules,
  } = manifest;

  return {
    name,
    target,
    enforcement,
    bypass_actors: bypassActors,
    conditions,
    rules,
  };
}

export function validateRuleset(actual, expected = loadManifest()) {
  if (actual.id !== expected.ruleset_id) {
    fail(
      "E_RULESET_ID",
      `expected ruleset ${expected.ruleset_id}; found ${actual.id}`,
    );
  }

  for (const field of ["name", "target", "enforcement"]) {
    if (actual[field] !== expected[field]) {
      fail(
        "E_RULESET_METADATA",
        `${field} must be ${JSON.stringify(expected[field])}; found ${JSON.stringify(actual[field])}`,
      );
    }
  }

  if (!same(actual.conditions, expected.conditions)) {
    fail(
      "E_RULESET_SCOPE",
      "default-branch include/exclude conditions differ from the manifest",
    );
  }

  if (
    !same(
      sortedActors(actual.bypass_actors ?? []),
      sortedActors(expected.bypass_actors),
    )
  ) {
    fail(
      "E_RULESET_BYPASS",
      "bypass actors or bypass modes differ from the manifest",
    );
  }

  const actualRules = actual.rules ?? [];
  const expectedRules = expected.rules;
  for (const type of [
    "deletion",
    "non_fast_forward",
    "required_signatures",
  ]) {
    exactlyOneRule(actualRules, type, "E_RULESET_PROTECTION");
  }

  const actualPullRequest = exactlyOneRule(
    actualRules,
    "pull_request",
    "E_RULESET_PULL_REQUEST",
  );
  const expectedPullRequest = exactlyOneRule(
    expectedRules,
    "pull_request",
    "E_RULESET_MANIFEST",
  );
  if (!same(actualPullRequest.parameters, expectedPullRequest.parameters)) {
    fail(
      "E_RULESET_PULL_REQUEST",
      "pull-request merge, review, or thread policy differs from the manifest",
    );
  }

  const actualStatus = exactlyOneRule(
    actualRules,
    "required_status_checks",
    "E_RULESET_STATUS_MISSING",
  );
  const expectedStatus = exactlyOneRule(
    expectedRules,
    "required_status_checks",
    "E_RULESET_MANIFEST",
  );
  if (actualStatus.parameters?.do_not_enforce_on_create !== false) {
    fail(
      "E_RULESET_STATUS_CREATE",
      "required checks must remain enforced when a matching branch is created",
    );
  }
  if (actualStatus.parameters?.strict_required_status_checks_policy !== true) {
    fail(
      "E_RULESET_STATUS_STRICT",
      "required checks must test the latest default-branch state",
    );
  }

  if (
    !same(
      sortedChecks(actualStatus.parameters?.required_status_checks ?? []),
      sortedChecks(expectedStatus.parameters.required_status_checks),
    )
  ) {
    fail(
      "E_RULESET_STATUS_CONTEXTS",
      "required context names or GitHub Actions integration IDs differ from the manifest",
    );
  }

  const actualTypes = actualRules.map(({ type }) => type).sort();
  const expectedTypes = expectedRules.map(({ type }) => type).sort();
  if (!same(actualTypes, expectedTypes)) {
    fail(
      "E_RULESET_RULE_TYPES",
      "the live ruleset has an unexpected or missing rule type",
    );
  }
}

function readLiveRuleset(manifest) {
  const endpoint = `repos/${manifest.repository}/rulesets/${manifest.ruleset_id}`;
  return JSON.parse(
    execFileSync("gh", ["api", endpoint], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
}

function readInput(path) {
  return path === "-"
    ? JSON.parse(readFileSync(0, "utf8"))
    : JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  return [
    "usage: node scripts/check-main-ruleset.mjs [--input <path|->]",
    "       node scripts/check-main-ruleset.mjs --print-update-payload",
  ].join("\n");
}

function main(args) {
  const manifest = loadManifest();
  if (args.length === 1 && args[0] === "--print-update-payload") {
    process.stdout.write(`${JSON.stringify(makeUpdatePayload(manifest), null, 2)}\n`);
    return;
  }

  let actual;
  if (args.length === 0) {
    actual = readLiveRuleset(manifest);
  } else if (args.length === 2 && args[0] === "--input") {
    actual = readInput(args[1]);
  } else {
    fail("E_USAGE", usage());
  }

  validateRuleset(actual, manifest);
  process.stdout.write(
    `merge-gate: OK ruleset ${manifest.ruleset_id} matches the manifest\n`,
  );
}

if (process.argv[1] === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof RulesetContractError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`E_RULESET_IO: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
