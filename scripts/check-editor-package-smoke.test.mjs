import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import ts from "typescript";
import { parse as parseYaml } from "yaml";

import {
  stageZedExtension,
  validateZedSourcePackage,
} from "./stage-zed-extension.mjs";

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
  "editors/vscode/smoke/log-files.mjs",
  "editors/vscode/smoke/run-packaged-smoke.mjs",
  "editors/vscode/smoke/suite/index.cjs",
  "scripts/stage-zed-extension.mjs",
];

async function importTypeScriptModule(filename) {
  const source = readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  assert.deepEqual(transpiled.diagnostics, []);
  const encoded = Buffer.from(transpiled.outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

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
  const packageIgnore = readFileSync(
    "editors/vscode/.vscodeignore",
    "utf8",
  );
  assert.match(packageIgnore, /^node_modules\/\*\*$/mu);
  assert.match(packageIgnore, /^\*\*\/\*\.map$/mu);
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

test("package evidence has independent validation boundaries", () => {
  const source = readFileSync(
    "editors/vscode/smoke/run-packaged-smoke.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /new Set\(channels\.map/gu);

  const stage = source.indexOf(
    "stageZedExtension(repositoryRoot, zedPackageRoot)",
  );
  const build = source.indexOf(
    '"--manifest-path",\n    path.join(zedPackageRoot, "Cargo.toml")',
    stage,
  );
  const revalidate = source.indexOf(
    "const zedPackage = validateZedSourcePackage(",
    build,
  );
  assert.ok(
    stage >= 0 && build > stage && revalidate > build,
    "the staged Zed tree must be revalidated after its isolated build",
  );
});

test("the package smoke never delegates argument parsing to a shell", () => {
  const source = readFileSync(
    "editors/vscode/smoke/run-packaged-smoke.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /\bshell\s*:/u);
});

test("startup failures inspect causes before narrow message fallback", async () => {
  const { startupFailureCategory } = await importTypeScriptModule(
    "editors/vscode/src/startup-failure.ts",
  );
  assert.equal(
    startupFailureCategory({ cause: { cause: { code: "ENOENT" } } }),
    "colorful/server-not-found",
  );
  assert.equal(
    startupFailureCategory(new Error("colorful-lsp executable not found")),
    "colorful/server-not-found",
  );
  assert.equal(
    startupFailureCategory(new Error("lexicon file not found")),
    "colorful/server-start-failed",
  );
});

test("startup failures keep machine categories in error logs only", () => {
  const source = readFileSync("editors/vscode/src/extension.ts", "utf8");
  assert.match(
    source,
    /output\.error\(`\[\$\{category\}\] Failed to start colorful-lsp:/u,
  );
  assert.match(
    source,
    /showErrorMessage\(\s*`Colorful Language could not start colorful-lsp:/u,
  );
});

test("the persisted-log scan skips transient profile entries", async () => {
  const { readTextFile, textFiles } = await import(
    "../editors/vscode/smoke/log-files.mjs"
  );
  const transient = (code) => Object.assign(new Error(code), { code });
  const directory = (name) => ({
    name,
    isDirectory: () => true,
    isFile: () => false,
  });
  const file = (name) => ({
    name,
    isDirectory: () => false,
    isFile: () => true,
  });
  const filesystem = {
    readdirSync(current) {
      if (current.endsWith("busy")) {
        throw transient("EPERM");
      }
      return [directory("busy"), file("gone.log"), file("kept.log")];
    },
    statSync(filename) {
      if (filename.endsWith("gone.log")) {
        throw transient("ENOENT");
      }
      return { size: 12 };
    },
    readFileSync(filename) {
      if (filename.endsWith("gone.log")) {
        throw transient("EBUSY");
      }
      return "kept";
    },
  };

  assert.deepEqual(textFiles("/profile", filesystem), ["/profile/kept.log"]);
  assert.equal(readTextFile("/profile/gone.log", filesystem), undefined);
  assert.equal(readTextFile("/profile/kept.log", filesystem), "kept");
});

test("Zed package validation is table-aware and formatting-independent", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "colorful-zed-package-"));
  const staged = path.join(scratch, "staged");
  const authority = path.join(scratch, "authority");
  mkdirSync(authority);
  try {
    stageZedExtension(process.cwd(), staged);
    writeFileSync(
      path.join(authority, "Cargo.toml"),
      `[workspace.metadata.shadow]\nversion = "9.9.9"\n\n${readFileSync("Cargo.toml", "utf8")}`,
    );
    writeFileSync(
      path.join(authority, "LICENSE"),
      readFileSync("LICENSE"),
    );
    writeFileSync(
      path.join(staged, "Cargo.toml"),
      `[package.metadata.shadow]\nversion = "9.9.9"\n\n${readFileSync(
        "editors/zed/Cargo.toml",
        "utf8",
      )}`,
    );
    const manifestPath = path.join(staged, "extension.toml");
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, "utf8").replace(
        'languages = ["Markdown", "Plain Text"]',
        'languages = [ "Plain Text", "Markdown" ]',
      ),
    );

    assert.doesNotThrow(() => validateZedSourcePackage(authority, staged));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the Zed missing-server oracle targets the extension-owned PATH branch", () => {
  const readme = readFileSync("editors/zed/README.md", "utf8");
  const plan = readFileSync(
    "docs/topics/editor-integrations/test-plan.md",
    "utf8",
  );
  assert.match(
    readme,
    /If no binary path is configured and `PATH` does not resolve the server/u,
  );
  assert.match(plan, /PATH=\/usr\/bin:\/bin "\$zed_bin"/u);
  assert.match(
    plan,
    /Remove `lsp\.colorful-lsp\.binary\.path` and restart the language server/u,
  );
});

test("the Zed host oracle remains planned until manual evidence is recorded", () => {
  const plan = readFileSync(
    "docs/topics/editor-integrations/test-plan.md",
    "utf8",
  );
  const edit8c = /- \*\*EDIT-8c\*\*[\s\S]*?(?=\n- \*\*EDIT-9a\*\*)/u.exec(plan);
  assert.ok(edit8c, "missing EDIT-8c package and host case");
  assert.match(edit8c[0], /\*Status:\* planned(?:[.;])/u);
});

test("the VS Code packaging warning precedes every package command", () => {
  const readme = readFileSync("editors/vscode/README.md", "utf8");
  const warning = readme.indexOf("> [!WARNING]");
  const packageCommand = readme.indexOf("npm run package:vsix");
  assert.ok(
    warning >= 0 && packageCommand > warning,
    "the package side-effect warning must precede the first package command",
  );
});

test("the extension-host smoke rejects cross-drive install paths", () => {
  const source = readFileSync(
    "editors/vscode/smoke/suite/index.cjs",
    "utf8",
  );
  assert.match(source, /!path\.isAbsolute\(relative\)/u);
});

test("the semantic-token smoke checks protocol stride, not buffer capacity", () => {
  const source = readFileSync(
    "editors/vscode/smoke/suite/index.cjs",
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /encoded\.buffer\.byteLength\s*===\s*encoded\.byteLength/u,
  );
  assert.match(source, /encoded\.byteLength\s*%\s*5\s*===\s*0/u);
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
