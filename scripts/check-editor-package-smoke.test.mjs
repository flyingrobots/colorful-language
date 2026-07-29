import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parse as parseYaml } from "yaml";

const VSCODE_DIRECTORY = "editors/vscode";
const PACKAGE_SMOKE_COMMAND = "npm run smoke:package";
const RELEASE_PACKAGE_SMOKE_COMMAND =
  "npm --prefix editors/vscode run smoke:package";
const EXPECTED_TOOL_VERSIONS = {
  "@vscode/test-electron": "3.1.0",
  "@vscode/vsce": "3.9.2",
  esbuild: "0.28.1",
};
const EXPECTED_HARNESS_PATHS = [
  "editors/vscode/.vscodeignore",
  "editors/vscode/LICENSE",
  "editors/vscode/smoke/harness/package.json",
  "editors/vscode/smoke/run-packaged-smoke.mjs",
  "editors/vscode/smoke/suite/index.cjs",
  "scripts/stage-zed-extension.mjs",
];

test("package tooling and smoke commands are exact and lockfile-backed", () => {
  const packageJson = JSON.parse(
    readFileSync("editors/vscode/package.json", "utf8"),
  );
  const lockfile = JSON.parse(
    readFileSync("editors/vscode/package-lock.json", "utf8"),
  );

  for (const [name, version] of Object.entries(EXPECTED_TOOL_VERSIONS)) {
    assert.equal(packageJson.devDependencies?.[name], version);
    assert.equal(lockfile.packages?.[""]?.devDependencies?.[name], version);
    assert.equal(lockfile.packages?.[`node_modules/${name}`]?.version, version);
  }
  assert.equal(
    packageJson.scripts?.["package:vsix"],
    "vsce package --no-yarn --no-dependencies",
  );
  assert.match(
    readFileSync("editors/vscode/.vscodeignore", "utf8"),
    /^node_modules\/\*\*$/mu,
  );
  assert.equal(
    packageJson.scripts?.["smoke:package"],
    "node smoke/run-packaged-smoke.mjs",
  );
  assert.equal(packageJson.repository?.directory, "editors/vscode");
});

test("the packaged VS Code license stays byte-identical to repository authority", () => {
  assert.equal(
    readFileSync("editors/vscode/LICENSE", "utf8"),
    readFileSync("LICENSE", "utf8"),
  );
});

test("the committed package harness has every portable evidence boundary", () => {
  for (const path of EXPECTED_HARNESS_PATHS) {
    assert.equal(existsSync(path), true, `missing package evidence: ${path}`);
  }
});

test("documentation lint excludes the downloaded VS Code test application", () => {
  assert.match(
    readFileSync(".markdownlint-cli2.jsonc", "utf8"),
    /"\*\*\/\.vscode-test\/\*\*"/u,
  );
});

test("CI runs the headless package smoke from the editor directory", () => {
  const workflow = parseYaml(
    readFileSync(".github/workflows/ci.yml", "utf8"),
  );
  const steps = workflow?.jobs?.editors?.steps;
  assert.ok(Array.isArray(steps), "workflow job editors must have steps");
  const smokeStep = steps.find((step) => step.run === PACKAGE_SMOKE_COMMAND);
  assert.ok(smokeStep, `editors job must run ${PACKAGE_SMOKE_COMMAND}`);
  assert.equal(smokeStep["working-directory"], VSCODE_DIRECTORY);
});

test("release preparation reruns the packaged editor smoke", () => {
  const commands = readFileSync("scripts/release-prep.sh", "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  assert.ok(
    commands.includes(RELEASE_PACKAGE_SMOKE_COMMAND),
    `release preparation must run ${RELEASE_PACKAGE_SMOKE_COMMAND}`,
  );
});
