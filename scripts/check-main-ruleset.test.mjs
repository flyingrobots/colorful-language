#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  RulesetContractError,
  loadManifest,
  makeUpdatePayload,
  validateRuleset,
} from "./check-main-ruleset.mjs";

function liveShape(manifest = loadManifest()) {
  return {
    id: manifest.ruleset_id,
    name: manifest.name,
    target: manifest.target,
    enforcement: manifest.enforcement,
    bypass_actors: structuredClone(manifest.bypass_actors),
    conditions: structuredClone(manifest.conditions),
    rules: structuredClone(manifest.rules),
  };
}

function expectCode(actual, code) {
  assert.throws(
    () => validateRuleset(actual),
    (error) =>
      error instanceof RulesetContractError && error.code === code,
  );
}

function rule(actual, type) {
  return actual.rules.find((candidate) => candidate.type === type);
}

test("accepts the exact governed ruleset contract", () => {
  assert.doesNotThrow(() => validateRuleset(liveShape()));
});

test("rejects a missing required-status-check rule", () => {
  const actual = liveShape();
  actual.rules = actual.rules.filter(
    (candidate) => candidate.type !== "required_status_checks",
  );
  expectCode(actual, "E_RULESET_STATUS_MISSING");
});

test("requires strict default-branch freshness", () => {
  const actual = liveShape();
  rule(actual, "required_status_checks").parameters
    .strict_required_status_checks_policy = false;
  expectCode(actual, "E_RULESET_STATUS_STRICT");
});

test("enforces required checks when a matching branch is created", () => {
  const actual = liveShape();
  rule(actual, "required_status_checks").parameters.do_not_enforce_on_create =
    true;
  expectCode(actual, "E_RULESET_STATUS_CREATE");
});

test("pins required context names and their source application", () => {
  const actual = liveShape();
  const [first] = rule(
    actual,
    "required_status_checks",
  ).parameters.required_status_checks;
  first.context = "renamed without migration";
  first.integration_id = 1;
  expectCode(actual, "E_RULESET_STATUS_CONTEXTS");
});

test("preserves the bypass actor before evaluating status checks", () => {
  const actual = liveShape();
  actual.bypass_actors[0].actor_id = 4;
  actual.rules = actual.rules.filter(
    (candidate) => candidate.type !== "required_status_checks",
  );
  expectCode(actual, "E_RULESET_BYPASS");
});

test("accepts API-redacted bypass actors only in explicit CI mode", () => {
  const actual = liveShape();
  actual.bypass_actors = null;
  expectCode(actual, "E_RULESET_BYPASS");
  assert.doesNotThrow(() =>
    validateRuleset(actual, loadManifest(), {
      allowRedactedBypass: true,
    }),
  );

  delete actual.bypass_actors;
  expectCode(actual, "E_RULESET_BYPASS");
  assert.doesNotThrow(() =>
    validateRuleset(actual, loadManifest(), {
      allowRedactedBypass: true,
    }),
  );

  actual.bypass_actors = [];
  assert.throws(
    () =>
      validateRuleset(actual, loadManifest(), {
        allowRedactedBypass: true,
      }),
    (error) =>
      error instanceof RulesetContractError &&
      error.code === "E_RULESET_BYPASS",
  );
});

test("preserves merge-only pull requests and thread resolution", () => {
  const actual = liveShape();
  rule(actual, "pull_request").parameters.allowed_merge_methods.push("squash");
  expectCode(actual, "E_RULESET_PULL_REQUEST");
});

test("preserves deletion, non-fast-forward, and signature protection", () => {
  const actual = liveShape();
  actual.rules = actual.rules.filter(
    (candidate) => candidate.type !== "required_signatures",
  );
  expectCode(actual, "E_RULESET_PROTECTION");
});

test("rejects undeclared live rule types", () => {
  const actual = liveShape();
  actual.rules.push({ type: "required_linear_history" });
  expectCode(actual, "E_RULESET_RULE_TYPES");
});

test("prints an update payload without local manifest metadata", () => {
  const payload = makeUpdatePayload(loadManifest());
  const status = rule(payload, "required_status_checks");
  assert.equal("repository" in payload, false);
  assert.equal("ruleset_id" in payload, false);
  assert.equal(payload.name, "mainline");
  assert.equal(payload.rules.length, 5);
  assert.deepEqual(
    status.parameters.required_status_checks,
    [
      "Docs & whitespace",
      "Rust (fmt, clippy, test)",
      "Rust coverage",
      "Cargo package witness",
      "IR cross-language round-trip witness",
      "Editor integrations (compile)",
      "Rust dependency policy",
      "Dependency review",
      "CodeQL (rust)",
      "CodeQL (javascript-typescript)",
      "Workflow security",
    ].map((context) => ({ context, integration_id: 15368 })),
  );
});
