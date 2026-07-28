#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/check-workflow-security.mjs");

function runFixture(name) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--root",
      resolve("scripts", "fixtures", "workflow-security", name),
    ],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
}

test("accepts a workflow with read-only permissions and ephemeral checkout credentials", () => {
  const result = runFixture("safe");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    "check-workflow-security: 1 workflow passed zizmor 1.28.0\n",
  );
});

test("rejects persisted checkout credentials with a stable category", () => {
  const result = runFixture("unsafe-artipacked");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^E_WORKFLOW_SECURITY_FINDING: artipacked: scripts\/fixtures\/workflow-security\/unsafe-artipacked\/\.github\/workflows\/unsafe\.yml:/u,
  );
});

test("rejects overbroad workflow permissions with a stable category", () => {
  const result = runFixture("unsafe-permissions");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^E_WORKFLOW_SECURITY_FINDING: excessive-permissions: scripts\/fixtures\/workflow-security\/unsafe-permissions\/\.github\/workflows\/unsafe\.yml:/u,
  );
});

test("the repository passes the pinned workflow-security analysis", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    /^check-workflow-security: \d+ workflows passed zizmor 1\.28\.0\n$/u,
  );
});
