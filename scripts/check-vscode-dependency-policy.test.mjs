#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import {
  validateVscodeDependencyPolicy,
  VscodeDependencyPolicyError,
} from "./check-vscode-dependency-policy.mjs";

function fixture() {
  return {
    editorPackage: {
      dependencies: {
        "vscode-languageclient": "^10.1.0",
      },
      engines: {
        vscode: "^1.91.0",
      },
    },
    lockfile: {
      packages: {
        "": {
          dependencies: {
            "vscode-languageclient": "^10.1.0",
          },
        },
        "node_modules/brace-expansion": {
          version: "5.0.8",
        },
        "node_modules/vscode-languageclient": {
          version: "10.1.0",
          engines: {
            vscode: "^1.91.0",
          },
        },
      },
    },
  };
}

function expectCode(editorPackage, lockfile, code) {
  assert.throws(
    () => validateVscodeDependencyPolicy(editorPackage, lockfile),
    (error) =>
      error instanceof VscodeDependencyPolicyError && error.code === code,
  );
}

const EDITOR_DIRECTORY = "editors/vscode";
const WORKFLOW_AUDIT_COMMAND = "npm audit --audit-level=high";
const RELEASE_AUDIT_COMMAND =
  "npm --prefix editors/vscode audit --audit-level=high";

function assertWorkflowAuditStep(workflow) {
  const document = parseYaml(workflow);
  const steps = document?.jobs?.editors?.steps;
  assert.ok(Array.isArray(steps), "workflow job editors must have steps");
  const auditStep = steps.find((step) => step.run === WORKFLOW_AUDIT_COMMAND);
  assert.ok(auditStep, `editors job must run ${WORKFLOW_AUDIT_COMMAND}`);
  assert.equal(auditStep["working-directory"], EDITOR_DIRECTORY);
}

function assertReleaseAuditCommand(releasePrep) {
  const commands = releasePrep
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  assert.ok(
    commands.includes(RELEASE_AUDIT_COMMAND),
    `release preparation must run ${RELEASE_AUDIT_COMMAND}`,
  );
}

test("accepts the fixed client, leaf, and editor floors", () => {
  const { editorPackage, lockfile } = fixture();
  assert.doesNotThrow(() =>
    validateVscodeDependencyPolicy(editorPackage, lockfile),
  );
});

test("rejects a vulnerable declared language client", () => {
  const { editorPackage, lockfile } = fixture();
  editorPackage.dependencies["vscode-languageclient"] = "^9.0.1";
  expectCode(editorPackage, lockfile, "E_VSCODE_CLIENT_RANGE");
});

test("rejects a prerelease declared language client", () => {
  const { editorPackage, lockfile } = fixture();
  editorPackage.dependencies["vscode-languageclient"] = "^10.1.0-next.1";
  expectCode(editorPackage, lockfile, "E_VSCODE_CLIENT_RANGE");
});

test("rejects a vulnerable locked language client", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages["node_modules/vscode-languageclient"].version = "9.0.1";
  expectCode(editorPackage, lockfile, "E_VSCODE_CLIENT_LOCK");
});

test("rejects a prerelease locked language client", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages["node_modules/vscode-languageclient"].version =
    "10.1.0-next.1";
  expectCode(editorPackage, lockfile, "E_VSCODE_CLIENT_LOCK");
});

test("rejects a manifest and lockfile dependency mismatch", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages[""].dependencies["vscode-languageclient"] = "^10.2.0";
  expectCode(editorPackage, lockfile, "E_VSCODE_LOCK_DEPENDENCY");
});

test("rejects the last vulnerable brace-expansion release", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages["node_modules/brace-expansion"].version = "5.0.7";
  expectCode(editorPackage, lockfile, "E_BRACE_EXPANSION");
});

test("rejects the currently locked vulnerable brace-expansion major", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages["node_modules/brace-expansion"].version = "2.1.2";
  expectCode(editorPackage, lockfile, "E_BRACE_EXPANSION");
});

test("rejects a prerelease patched brace-expansion", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages["node_modules/brace-expansion"].version = "5.0.8-beta.0";
  expectCode(editorPackage, lockfile, "E_BRACE_EXPANSION");
});

test("rejects an extension floor below the client floor", () => {
  const { editorPackage, lockfile } = fixture();
  editorPackage.engines.vscode = "^1.90.0";
  expectCode(editorPackage, lockfile, "E_VSCODE_ENGINE");
});

test("rejects a prerelease extension engine floor", () => {
  const { editorPackage, lockfile } = fixture();
  editorPackage.engines.vscode = "^1.91.0-insiders";
  expectCode(editorPackage, lockfile, "E_VSCODE_ENGINE");
});

test("rejects a prerelease locked client engine floor", () => {
  const { editorPackage, lockfile } = fixture();
  lockfile.packages["node_modules/vscode-languageclient"].engines.vscode =
    "^1.91.0-next.1";
  expectCode(editorPackage, lockfile, "E_VSCODE_ENGINE");
});

test("runs the high-severity advisory audit in CI and release preparation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assertWorkflowAuditStep(workflow);

  const releasePrep = readFileSync(
    new URL("./release-prep.sh", import.meta.url),
    "utf8",
  );
  assertReleaseAuditCommand(releasePrep);
});

test("audit wiring checks ignore formatting and YAML property order", () => {
  assertWorkflowAuditStep(`
jobs:
    editors:
      steps:
        - working-directory: "editors/vscode"
          name: Audit locked dependencies
          run: "npm audit --audit-level=high"
`);
  assertReleaseAuditCommand(
    `
      npm --prefix editors/vscode audit --audit-level=high
`,
  );
});

test("tracks the advisory slice in the editor plan and roadmap", () => {
  const issueLink =
    "https://github.com/flyingrobots/colorful-language/issues/185";
  const testPlan = readFileSync(
    new URL(
      "../docs/topics/editor-integrations/test-plan.md",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(testPlan, new RegExp(issueLink, "u"));

  const roadmap = readFileSync(
    new URL("../ROADMAP.md", import.meta.url),
    "utf8",
  );
  assert.match(roadmap, new RegExp(issueLink, "u"));
});
