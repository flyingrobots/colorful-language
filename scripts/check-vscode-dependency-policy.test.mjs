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
    dependabotPolicy: {
      version: 2,
      updates: [
        {
          "package-ecosystem": "npm",
          directory: "/editors/vscode",
          ignore: [
            {
              "dependency-name": "typescript",
            },
            {
              "dependency-name": "@types/node",
            },
          ],
        },
      ],
    },
    documentation: {
      adapter: [
        "VS Code 1.91.0 uses Electron 29.4.0 and Node 20.9.0 with `@types/node` 20.19.43.",
        "https://releases.electronjs.org/release/v29.4.0",
      ].join(" "),
      topic: [
        "VS Code 1.91.0 uses Electron 29.4.0 and Node 20.9.0 with `@types/node` 20.19.43.",
        "https://releases.electronjs.org/release/v29.4.0",
      ].join(" "),
    },
    editorPackage: {
      dependencies: {
        "vscode-languageclient": "^10.1.0",
      },
      devDependencies: {
        "@types/node": "20.19.43",
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
          devDependencies: {
            "@types/node": "20.19.43",
          },
        },
        "node_modules/@types/node": {
          version: "20.19.43",
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
    runtimePolicy: {
      minimumVscodeVersion: "1.91.0",
      electronVersion: "29.4.0",
      nodeVersion: "20.9.0",
      nodeTypesVersion: "20.19.43",
      evidenceUrl: "https://releases.electronjs.org/release/v29.4.0",
    },
    tsconfig: {
      compilerOptions: {
        skipLibCheck: false,
        strict: true,
      },
    },
  };
}

function validateFixture({
  dependabotPolicy,
  documentation,
  editorPackage,
  lockfile,
  runtimePolicy,
  tsconfig,
}) {
  validateVscodeDependencyPolicy(editorPackage, lockfile, {
    dependabotPolicy,
    documentation,
    runtimePolicy,
    tsconfig,
  });
}

function expectCode(input, code) {
  assert.throws(
    () => validateFixture(input),
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
  assert.doesNotThrow(() => validateFixture(fixture()));
});

test("rejects a vulnerable declared language client", () => {
  const input = fixture();
  input.editorPackage.dependencies["vscode-languageclient"] = "^9.0.1";
  expectCode(input, "E_VSCODE_CLIENT_RANGE");
});

test("rejects a prerelease declared language client", () => {
  const input = fixture();
  input.editorPackage.dependencies["vscode-languageclient"] = "^10.1.0-next.1";
  expectCode(input, "E_VSCODE_CLIENT_RANGE");
});

test("rejects a vulnerable locked language client", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/vscode-languageclient"].version =
    "9.0.1";
  expectCode(input, "E_VSCODE_CLIENT_LOCK");
});

test("rejects a prerelease locked language client", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/vscode-languageclient"].version =
    "10.1.0-next.1";
  expectCode(input, "E_VSCODE_CLIENT_LOCK");
});

test("rejects a manifest and lockfile dependency mismatch", () => {
  const input = fixture();
  input.lockfile.packages[""].dependencies["vscode-languageclient"] = "^10.2.0";
  expectCode(input, "E_VSCODE_LOCK_DEPENDENCY");
});

test("rejects the last vulnerable brace-expansion release", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/brace-expansion"].version = "5.0.7";
  expectCode(input, "E_BRACE_EXPANSION");
});

test("rejects the currently locked vulnerable brace-expansion major", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/brace-expansion"].version = "2.1.2";
  expectCode(input, "E_BRACE_EXPANSION");
});

test("rejects a prerelease patched brace-expansion", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/brace-expansion"].version =
    "5.0.8-beta.0";
  expectCode(input, "E_BRACE_EXPANSION");
});

test("rejects an extension floor below the client floor", () => {
  const input = fixture();
  input.editorPackage.engines.vscode = "^1.90.0";
  expectCode(input, "E_VSCODE_ENGINE");
});

test("rejects a prerelease extension engine floor", () => {
  const input = fixture();
  input.editorPackage.engines.vscode = "^1.91.0-insiders";
  expectCode(input, "E_VSCODE_ENGINE");
});

test("rejects a prerelease locked client engine floor", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/vscode-languageclient"].engines.vscode =
    "^1.91.0-next.1";
  expectCode(input, "E_VSCODE_ENGINE");
});

test("rejects Node 26 declarations for the VS Code 1.91 host", () => {
  const input = fixture();
  input.editorPackage.devDependencies["@types/node"] = "26.1.2";
  input.lockfile.packages[""].devDependencies["@types/node"] = "26.1.2";
  input.lockfile.packages["node_modules/@types/node"].version = "26.1.2";
  assert.throws(
    () => validateFixture(input),
    (error) =>
      error instanceof VscodeDependencyPolicyError &&
      error.code === "E_VSCODE_NODE_TYPES" &&
      error.message.includes(
        'editors/vscode/package.json#devDependencies["@types/node"]',
      ),
  );
});

test("rejects a caret range even when it stays on the host major", () => {
  const input = fixture();
  input.editorPackage.devDependencies["@types/node"] = "^20";
  input.lockfile.packages[""].devDependencies["@types/node"] = "^20";
  expectCode(input, "E_VSCODE_NODE_TYPES");
});

test("rejects drift from the reviewed declaration release", () => {
  const input = fixture();
  input.editorPackage.devDependencies["@types/node"] = "20.20.0";
  input.lockfile.packages[""].devDependencies["@types/node"] = "20.20.0";
  input.lockfile.packages["node_modules/@types/node"].version = "20.20.0";
  expectCode(input, "E_VSCODE_NODE_TYPES");
});

test("rejects a lockfile root that stops repeating the declaration pin", () => {
  const input = fixture();
  input.lockfile.packages[""].devDependencies["@types/node"] = "20.20.0";
  expectCode(input, "E_VSCODE_NODE_TYPES");
});

test("rejects a locked Node declaration major outside the host line", () => {
  const input = fixture();
  input.lockfile.packages["node_modules/@types/node"].version = "21.7.3";
  expectCode(input, "E_VSCODE_NODE_TYPES");
});

test("rejects a runtime policy that drifts from the extension floor", () => {
  const input = fixture();
  input.runtimePolicy.minimumVscodeVersion = "1.92.0";
  expectCode(input, "E_VSCODE_HOST_POLICY");
});

test("rejects an evidence URL that drifts from the Electron pin", () => {
  const input = fixture();
  input.runtimePolicy.evidenceUrl =
    "https://releases.electronjs.org/release/v30.0.0";
  expectCode(input, "E_VSCODE_HOST_POLICY");
});

test("rejects Dependabot policy without the Node declaration freeze", () => {
  const input = fixture();
  input.dependabotPolicy.updates[0].ignore.pop();
  expectCode(input, "E_VSCODE_DEPENDABOT_POLICY");
});

test("rejects a partial scalar Dependabot update-types impostor", () => {
  const input = fixture();
  input.dependabotPolicy.updates[0].ignore[1]["update-types"] =
    "version-update:semver-major";
  expectCode(input, "E_VSCODE_DEPENDABOT_POLICY");
});

test("categorizes malformed Dependabot policy containers", () => {
  const input = fixture();
  input.dependabotPolicy.updates = {};
  expectCode(input, "E_VSCODE_DEPENDABOT_POLICY");
});

test("rejects weakened TypeScript declaration checking", () => {
  const input = fixture();
  input.tsconfig.compilerOptions.skipLibCheck = true;
  expectCode(input, "E_VSCODE_TYPESCRIPT_POLICY");
});

test("rejects disabled TypeScript strict mode", () => {
  const input = fixture();
  input.tsconfig.compilerOptions.strict = false;
  expectCode(input, "E_VSCODE_TYPESCRIPT_POLICY");
});

test("rejects current editor documentation that drifts from host policy", () => {
  const input = fixture();
  input.documentation.adapter =
    "VS Code 1.91.0 is supported, but the host runtime is undocumented.";
  expectCode(input, "E_VSCODE_RUNTIME_DOCS");
});

test("rejects a documented Node declaration major outside the host line", () => {
  const input = fixture();
  input.documentation.topic = input.documentation.topic.replace(
    "`@types/node` 20.19.43",
    "`@types/node` 26.1.2",
  );
  expectCode(input, "E_VSCODE_RUNTIME_DOCS");
});

test("accepts runtime documentation facts wrapped across lines", () => {
  const input = fixture();
  input.documentation.adapter = input.documentation.adapter
    .replace("VS Code 1.91.0", "VS Code\n1.91.0")
    .replace("`@types/node` 20.19.43", "`@types/node`\n20.19.43");
  assert.doesNotThrow(() => validateFixture(input));
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
