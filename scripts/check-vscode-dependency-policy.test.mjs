#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("runs the high-severity advisory audit in CI and release preparation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /- run: npm audit --audit-level=high\n\s+working-directory: editors\/vscode/u,
  );

  const releasePrep = readFileSync(
    new URL("./release-prep.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    releasePrep,
    /^npm --prefix editors\/vscode audit --audit-level=high$/mu,
  );
});
