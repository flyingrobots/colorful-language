import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const PACKAGE_POLICY_COMMAND =
  "node --test scripts/check-editor-package-smoke.test.mjs";
const EDITOR_INSTALL_COMMAND = "npm --prefix editors/vscode ci";
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
  "editors/vscode/smoke/timing-witness.mjs",
  "editors/vscode/scripts/package-vsix.mjs",
  "editors/vscode/runtime-policy.json",
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
  const runtimePolicy = JSON.parse(
    readFileSync("editors/vscode/runtime-policy.json", "utf8"),
  );

  for (const [name, version] of Object.entries(EXPECTED_TOOL_VERSIONS)) {
    assert.equal(packageJson.devDependencies?.[name], version);
    assert.equal(lockfile.packages?.[""]?.devDependencies?.[name], version);
    assert.equal(lockfile.packages?.[`node_modules/${name}`]?.version, version);
  }
  assert.equal(
    packageJson.scripts?.["package:vsix"],
    "node scripts/package-vsix.mjs",
  );
  const packageIgnore = readFileSync(
    "editors/vscode/.vscodeignore",
    "utf8",
  );
  assert.match(packageIgnore, /^node_modules\/\*\*$/mu);
  assert.match(packageIgnore, /^runtime-policy\.json$/mu);
  assert.match(packageIgnore, /^scripts\/\*\*$/mu);
  assert.match(packageIgnore, /^\*\*\/\*\.map$/mu);
  assert.equal(
    packageJson.scripts?.["smoke:package"],
    "node smoke/run-packaged-smoke.mjs",
  );
  assert.equal(packageJson.repository?.directory, "editors/vscode");
  assert.equal(
    packageJson.engines?.vscode,
    `^${runtimePolicy.minimumVscodeVersion}`,
  );
  assert.equal(packageJson.devDependencies?.["@types/node"], "^20");
  assert.equal(
    lockfile.packages?.["node_modules/@types/node"]?.version.split(".")[0],
    runtimePolicy.nodeVersion.split(".")[0],
  );

  const smokeRunner = readFileSync(
    "editors/vscode/smoke/run-packaged-smoke.mjs",
    "utf8",
  );
  assert.match(smokeRunner, /validateVscodeHostPolicy/u);
  assert.match(smokeRunner, /minimumVscodeVersion: VSCODE_VERSION/u);
});

test("VSIX packaging resolves the publisher binary from its package manifest", () => {
  const source = readFileSync(
    "editors/vscode/scripts/package-vsix.mjs",
    "utf8",
  );
  assert.match(source, /@vscode\/vsce\/package\.json/u);
  assert.match(source, /\.bin/u);
  assert.doesNotMatch(
    source,
    /node_modules",\s*"@vscode",\s*"vsce",\s*"vsce"/u,
  );
});

test("VSIX packaging is reproducible across ambient build times", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "colorful-vsix-repro-"));
  const first = path.join(scratch, "first.vsix");
  const second = path.join(scratch, "second.vsix");
  const packageVsix = (output, sourceDateEpoch) => {
    const result = spawnSync(
      "npm",
      [
        "--prefix",
        VSCODE_DIRECTORY,
        "run",
        "package:vsix",
        "--",
        "--out",
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch },
      },
    );
    assert.equal(
      result.status,
      0,
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  };
  try {
    packageVsix(first, "1600000000");
    packageVsix(second, "1700000000");
    const digest = (filename) =>
      createHash("sha256").update(readFileSync(filename)).digest("hex");
    assert.equal(digest(first), digest(second));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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

test("installation timing is ordered observational evidence", async () => {
  const { createInstallationTimingWitness } = await import(
    "../editors/vscode/smoke/timing-witness.mjs"
  );
  const witness = createInstallationTimingWitness({
    installationStartedAtUnixMs: 1_000,
    firstHighlightAtUnixMs: 1_375,
    environment: {
      architecture: "arm64",
      cpu: "Example CPU",
      extension: "flyingrobots.colorful-language@0.4.0",
      logicalCpuCount: 8,
      memoryBytes: 16_000_000_000,
      node: "v22.23.1",
      operatingSystem: "darwin 25.0.0",
      rustc: "rustc 1.97.1",
      server: "colorful-lsp@0.4.0",
      vscode: "1.91.0",
    },
  });

  assert.deepEqual(witness, {
    schemaVersion: "colorful.install-to-first-highlight/v1",
    observational: true,
    correctnessThresholdMs: null,
    startEvent: "before-isolated-vsix-install",
    endEvent: "first-plaintext-diagnostic-and-semantic-tokens",
    installationStartedAtUnixMs: 1_000,
    firstHighlightAtUnixMs: 1_375,
    durationMs: 375,
    environment: {
      architecture: "arm64",
      cpu: "Example CPU",
      extension: "flyingrobots.colorful-language@0.4.0",
      logicalCpuCount: 8,
      memoryBytes: 16_000_000_000,
      node: "v22.23.1",
      operatingSystem: "darwin 25.0.0",
      rustc: "rustc 1.97.1",
      server: "colorful-lsp@0.4.0",
      vscode: "1.91.0",
    },
  });
  assert.throws(
    () =>
      createInstallationTimingWitness({
        installationStartedAtUnixMs: 1_000,
        firstHighlightAtUnixMs: 999,
        environment: witness.environment,
    }),
    /must not precede installation start/u,
  );
  assert.throws(
    () =>
      createInstallationTimingWitness({
        installationStartedAtUnixMs: 1_000,
        firstHighlightAtUnixMs: 1_375,
        environment: {
          ...witness.environment,
          rustc: undefined,
        },
      }),
    /environment\.rustc/u,
  );

  const runner = readFileSync(
    "editors/vscode/smoke/run-packaged-smoke.mjs",
    "utf8",
  );
  const suite = readFileSync(
    "editors/vscode/smoke/suite/index.cjs",
    "utf8",
  );
  const start = runner.indexOf(
    "const installationStartedAtUnixMs = Date.now();",
  );
  const install = runner.indexOf(
    "installVsix(vscodeExecutablePath, vsixPath, extensionsDirectory);",
  );
  assert.ok(
    start >= 0 && install > start,
    "timing must begin immediately before the isolated VSIX installation",
  );
  assert.match(runner, /COLORFUL_TIMING_PATH/u);
  assert.match(runner, /installationToFirstHighlight/u);
  assert.match(
    suite,
    /first-plaintext-diagnostic-and-semantic-tokens/u,
  );
});

test("installation timing requires typed positive environment measurements", async () => {
  const { createInstallationTimingWitness } = await import(
    "../editors/vscode/smoke/timing-witness.mjs"
  );
  const environment = {
    architecture: "arm64",
    cpu: "Example CPU",
    extension: "flyingrobots.colorful-language@0.4.0",
    logicalCpuCount: 8,
    memoryBytes: 16_000_000_000,
    node: "v22.23.1",
    operatingSystem: "darwin 25.0.0",
    rustc: "rustc 1.97.1",
    server: "colorful-lsp@0.4.0",
    vscode: "1.91.0",
  };
  for (const [field, value] of [
    ["cpu", 8],
    ["logicalCpuCount", "8"],
    ["logicalCpuCount", 0],
    ["logicalCpuCount", -1],
    ["memoryBytes", "16000000000"],
    ["memoryBytes", 0],
    ["memoryBytes", -1],
  ]) {
    assert.throws(
      () =>
        createInstallationTimingWitness({
          installationStartedAtUnixMs: 1_000,
          firstHighlightAtUnixMs: 1_375,
          environment: { ...environment, [field]: value },
        }),
      new RegExp(`environment\\.${field}`, "u"),
      `${field} accepted ${JSON.stringify(value)}`,
    );
  }
});

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../gu)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return (
    0.2126 * channels[0] +
    0.7152 * channels[1] +
    0.0722 * channels[2]
  );
}

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

test("the visual demo has a text-equivalent accessible role mapping", () => {
  const demoPath =
    "docs/topics/editor-integrations/assets/semantic-role-demo.svg";
  assert.equal(existsSync(demoPath), true, `missing editor demo: ${demoPath}`);
  const svg = readFileSync(demoPath, "utf8");
  const readme = readFileSync(
    "docs/topics/editor-integrations/README.md",
    "utf8",
  );
  assert.match(svg, /<title[^>]*>Colorful semantic-role editor demo<\/title>/u);
  assert.match(svg, /<desc[^>]*>[\s\S]*cat: noun[\s\S]*writes: verb/u);
  assert.match(
    svg,
    /<desc[^>]*>[\s\S]*separate diagnostic fixture[\s\S]*really/iu,
  );
  assert.match(
    readme,
    /Separate diagnostic example[\s\S]*`really`[\s\S]*`weak-word`/u,
  );
  assert.doesNotMatch(
    svg,
    /(?:fill|stroke):\s*var\(/u,
    "demo paint must render without CSS custom-property support",
  );

  const classFill = (className) =>
    new RegExp(
      `\\.${className}\\s*\\{\\s*fill:\\s*(#[0-9a-f]{6})`,
      "u",
    ).exec(svg)?.[1];
  const surface = classFill("panel");
  assert.ok(surface, "demo must declare one semantic surface token");
  const roles = {
    noun: ["cat", "prose"],
    verb: ["writes"],
    adjective: ["careful"],
    adverb: ["quickly"],
  };
  for (const [role, words] of Object.entries(roles)) {
    const color = classFill(role);
    assert.ok(color, `demo must declare the ${role} reference color`);
    assert.ok(
      contrastRatio(color, surface) >= 4.5,
      `${role} must meet 4.5:1 contrast against the demo surface`,
    );
    assert.match(
      svg,
      new RegExp(`class="[^"]*\\b${role}\\b[^"]*"`, "u"),
    );
    for (const word of words) {
      assert.match(
        readme,
        new RegExp(`\\| ${word} \\| \`${role}\` \\|`, "u"),
      );
    }
  }
  assert.match(
    readme,
    /!\[Colorful semantic-role demo with each word labeled by role\]/u,
  );
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

test("Zed source validation compares the missing-server constant literally", () => {
  const source = readFileSync("scripts/stage-zed-extension.mjs", "utf8");
  assert.doesNotMatch(source, /ZED_SERVER_NOT_FOUND_CATEGORY\.replace/u);
  assert.match(
    source,
    /source\.includes\(\s*`const SERVER_NOT_FOUND_CATEGORY: &str = "\$\{ZED_SERVER_NOT_FOUND_CATEGORY\}";`/u,
  );
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

test("immutable editor package READMEs avoid time-bound publication claims", () => {
  for (const filename of [
    "editors/vscode/README.md",
    "editors/zed/README.md",
  ]) {
    const readme = readFileSync(filename, "utf8");
    assert.doesNotMatch(readme, /\bnot yet published\b/iu);
    assert.doesNotMatch(readme, /\bfirst synchronized editor release\b/iu);
    assert.match(readme, /matching tag/u);
    assert.match(readme, /that exact target and version/u);
  }
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
  assert.match(
    source,
    /semanticTokenHeaderBytes\s*=\s*3\s*\*\s*Uint32Array\.BYTES_PER_ELEMENT/u,
  );
  assert.match(
    source,
    /semanticTokenStrideBytes\s*=\s*5\s*\*\s*Uint32Array\.BYTES_PER_ELEMENT/u,
  );
  assert.match(
    source,
    /semanticTokenBytes\s*%\s*semanticTokenStrideBytes\s*===\s*0/u,
  );
});

test("documentation lint excludes the downloaded VS Code test application", () => {
  assert.match(
    readFileSync(".markdownlint-cli2.jsonc", "utf8"),
    /"\*\*\/\.vscode-test\/\*\*"/u,
  );
  for (const filename of [
    "scripts/check-doc-citations.mjs",
    "scripts/check-internal-links.mjs",
  ]) {
    const source = readFileSync(filename, "utf8");
    assert.doesNotMatch(source, /startsWith\("\.vscode-test\/"\)/u);
    assert.match(source, /split\(sep\)\[0\]\s*===\s*"\.vscode-test"/u);
  }
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

test("clean gates install editor dependencies before package policy", () => {
  const workflow = parseYaml(
    readFileSync(".github/workflows/ci.yml", "utf8"),
  );
  const steps = workflow?.jobs?.editors?.steps;
  assert.ok(Array.isArray(steps), "workflow job editors must have steps");
  const hostedInstall = steps.findIndex(
    (step) =>
      step.run === "npm ci" &&
      step["working-directory"] === VSCODE_DIRECTORY,
  );
  const hostedPolicy = steps.findIndex(
    (step) => step.run === PACKAGE_POLICY_COMMAND,
  );
  assert.ok(
    hostedInstall >= 0 && hostedPolicy > hostedInstall,
    "hosted editor dependencies must precede package policy",
  );

  const commands = readFileSync("scripts/release-prep.sh", "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  const localInstall = commands.indexOf(EDITOR_INSTALL_COMMAND);
  const localPolicy = commands.indexOf(PACKAGE_POLICY_COMMAND);
  assert.ok(
    localInstall >= 0 && localPolicy > localInstall,
    "release-prep editor dependencies must precede package policy",
  );
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
