#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACTION_SHA = /^[0-9a-f]{40}$/u;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;
const REQUIRED_PATHS = [
  "rust-toolchain.toml",
  ".node-version",
  "package.json",
  "package-lock.json",
  ".npmrc",
  ".github/workflows/ci.yml",
  ".github/workflows/compatibility.yml",
  ".github/workflows/release.yml",
  "Cargo.toml",
  "CONTRIBUTING.md",
  "README.md",
  "docs/workflows/evidence-toolchains/README.md",
  "editors/vscode/package-lock.json",
  "editors/vscode/package.json",
  "scripts/ir-witness.sh",
  "scripts/release-prep.sh",
];

class PolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new PolicyError(code, message);
}

function parseJson(files, file) {
  try {
    return JSON.parse(files.get(file));
  } catch (error) {
    reject("E_JSON", `${file}: ${error.message}`);
  }
}

function exactVersion(value, code, subject) {
  if (typeof value !== "string" || !EXACT_VERSION.test(value)) {
    reject(code, `${subject} must be an exact X.Y.Z release`);
  }
  return value;
}

function tomlString(source, key) {
  return source.match(
    new RegExp(
      `^\\s*${key}\\s*=\\s*"([^"]+)"\\s*(?:#.*)?$`,
      "mu",
    ),
  )?.[1];
}

function tomlStringArray(source, key) {
  const body = source.match(
    new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]\\s*(?:#.*)?$`, "mu"),
  )?.[1];
  if (body === undefined) {
    return null;
  }
  return [...body.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function actionStepBlocks(workflow, action) {
  const lines = workflow.split("\n");
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(
      /^(\s*)-\s+uses:\s+([^@\s]+)@([^\s#]+).*$/u,
    );
    if (!match || match[2] !== action) {
      continue;
    }
    const indent = match[1].length;
    let end = index + 1;
    while (
      end < lines.length &&
      !new RegExp(`^\\s{${indent}}-\\s+`, "u").test(lines[end])
    ) {
      end += 1;
    }
    steps.push({
      ref: match[3],
      body: lines.slice(index, end).join("\n"),
    });
  }
  return steps;
}

function workflowJobBodies(workflow) {
  const lines = workflow.split("\n");
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (jobsIndex === -1) {
    return [workflow];
  }

  const jobs = [];
  let current = [];
  for (const line of lines.slice(jobsIndex + 1)) {
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/u.test(line)) {
      if (current.length > 0) {
        jobs.push(current.join("\n"));
      }
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    jobs.push(current.join("\n"));
  }
  return jobs;
}

function jobEnvValue(job, key) {
  const lines = job.split("\n");
  const headerIndent = lines[0].match(/^\s*/u)[0].length;
  const envIndent = headerIndent + 2;
  const valueIndent = envIndent + 2;
  const envIndex = lines.findIndex((line) =>
    new RegExp(`^\\s{${envIndent}}env:\\s*$`, "u").test(line),
  );
  if (envIndex === -1) {
    return null;
  }
  const valuePattern = new RegExp(
    `^\\s{${valueIndent}}${key}:\\s*["']?([^"'\\s]+)["']?\\s*$`,
    "u",
  );
  for (const line of lines.slice(envIndex + 1)) {
    const indent = line.match(/^\s*/u)[0].length;
    if (line.trim() && indent <= envIndent) {
      break;
    }
    const match = line.match(valuePattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function hasRootRunBefore(job, prerequisite, target) {
  const lines = job.split("\n");
  const targetIndexes = lines
    .map((line, index) => [line.trim(), index])
    .filter(([line]) => line === `- run: ${target}`)
    .map(([, index]) => index);
  if (targetIndexes.length === 0) {
    return null;
  }

  return targetIndexes.every((targetIndex) => {
    for (let index = 0; index < targetIndex; index += 1) {
      if (lines[index].trim() !== `- run: ${prerequisite}`) {
        continue;
      }
      const indent = lines[index].match(/^\s*/u)[0].length;
      const following = lines.slice(index + 1, targetIndex);
      const nextStep = following.findIndex((line) =>
        new RegExp(`^\\s{${indent}}-\\s+`, "u").test(line),
      );
      const stepTail =
        nextStep === -1 ? following : following.slice(0, nextStep);
      if (!stepTail.some((line) => /^\s*working-directory:/u.test(line))) {
        return true;
      }
    }
    return false;
  });
}

function assertPinnedActions(workflow, file) {
  for (const match of workflow.matchAll(
    /^\s*(?:-\s+)?uses:\s+[^@\s]+@([^\s#]+).*$/gmu,
  )) {
    if (!ACTION_SHA.test(match[1])) {
      reject(
        "E_PRIMARY_ACTION_PIN",
        `${file}: every action must use a full commit SHA`,
      );
    }
  }
}

function assertPinnedRustActions(workflow, file, rustVersion) {
  const actions = actionStepBlocks(workflow, "dtolnay/rust-toolchain");
  if (actions.length === 0) {
    reject("E_PRIMARY_RUST_SELECTOR", `${file}: no Rust setup action found`);
  }
  const selector = new RegExp(
    `^\\s*toolchain:\\s*["']?${rustVersion.replaceAll(".", "\\.")}["']?\\s*$`,
    "gmu",
  );
  for (const action of actions) {
    if (!ACTION_SHA.test(action.ref)) {
      reject(
        "E_PRIMARY_RUST_SELECTOR",
        `${file}: Rust setup action must use a full commit SHA`,
      );
    }
    if (countMatches(action.body, selector) !== 1) {
      reject(
        "E_PRIMARY_RUST_SELECTOR",
        `${file}: every Rust action must select ${rustVersion}`,
      );
    }
  }
}

function assertPinnedNodeActions(workflow, file) {
  const actions = actionStepBlocks(workflow, "actions/setup-node");
  if (actions.length === 0) {
    return;
  }
  for (const action of actions) {
    const fileSelectorCount = countMatches(
      action.body,
      /^\s*node-version-file:\s*["']?\.node-version["']?\s*$/gmu,
    );
    if (
      fileSelectorCount !== 1 ||
      /^\s*node-version:\s*/mu.test(action.body)
    ) {
      reject(
        "E_PRIMARY_NODE_SELECTOR",
        `${file}: every Node action must select .node-version`,
      );
    }
  }
}

function assertTypeScriptLock(lock, file, expected) {
  const declared = lock.packages?.[""]?.devDependencies?.typescript;
  const installed = lock.packages?.["node_modules/typescript"]?.version;
  if (declared !== expected || installed !== expected) {
    reject(
      "E_TYPESCRIPT_LOCK",
      `${file}: declared and installed TypeScript must both be ${expected}`,
    );
  }
}

function assertCompatibilityWorkflow(workflow, nodeMajor) {
  for (const marker of ["schedule:", "workflow_dispatch:", "cron:"]) {
    if (!workflow.includes(marker)) {
      reject(
        "E_COMPAT_TRIGGER",
        `.github/workflows/compatibility.yml: missing ${marker}`,
      );
    }
  }
  if (
    !workflow.includes(
      "concurrency:\n  group: ${{ github.workflow }}\n  cancel-in-progress: false",
    )
  ) {
    reject(
      "E_COMPAT_CONCURRENCY",
      "compatibility workflow must serialize runs without cancellation",
    );
  }
  const rustJobs = workflowJobBodies(workflow)
    .map((job) => ({
      job,
      actions: actionStepBlocks(job, "dtolnay/rust-toolchain"),
    }))
    .filter(({ actions }) => actions.length > 0);
  if (rustJobs.length === 0) {
    reject(
      "E_COMPAT_RUST_SELECTOR",
      "compatibility workflow must select the moving Rust stable channel",
    );
  }
  for (const { job, actions } of rustJobs) {
    for (const action of actions) {
      const selectors = [
        ...action.body.matchAll(/^\s*toolchain:\s*["']?([^"'\s]+)["']?\s*$/gmu),
      ];
      if (selectors.length !== 1 || selectors[0][1] !== "stable") {
        reject(
          "E_COMPAT_RUST_SELECTOR",
          "compatibility workflow must select the moving Rust stable channel",
        );
      }
    }
    if (jobEnvValue(job, "RUSTUP_TOOLCHAIN") !== "stable") {
      reject(
        "E_COMPAT_RUST_OVERRIDE",
        "compatibility workflow must override the checked-in Rust toolchain",
      );
    }
  }
  const nodeActions = actionStepBlocks(workflow, "actions/setup-node");
  if (nodeActions.length === 0) {
    reject(
      "E_COMPAT_NODE_SELECTOR",
      `compatibility workflow must select supported Node line ${nodeMajor}`,
    );
  }
  for (const action of nodeActions) {
    const selectors = [
      ...action.body.matchAll(
        /^\s*node-version:\s*["']?([^"'\s]+)["']?\s*$/gmu,
      ),
    ];
    if (selectors.length !== 1 || selectors[0][1] !== nodeMajor) {
      reject(
        "E_COMPAT_NODE_SELECTOR",
        `compatibility workflow must select supported Node line ${nodeMajor}`,
      );
    }
  }
  for (const match of workflow.matchAll(/^\s*-\s+uses:\s+[^@\s]+@([^\s#]+).*$/gmu)) {
    if (!ACTION_SHA.test(match[1])) {
      reject(
        "E_COMPAT_ACTION_PIN",
        "compatibility workflow actions must use full commit SHAs",
      );
    }
  }
}

function assertPolicyDocs(files, rustVersion, nodeVersion, typeScriptVersion) {
  const workflowDoc = files.get("docs/workflows/evidence-toolchains/README.md");
  for (const required of [
    rustVersion,
    nodeVersion,
    typeScriptVersion,
    "MSRV",
    "weekly",
    "maintainer",
    "advisory",
  ]) {
    if (!workflowDoc.includes(required)) {
      reject(
        "E_POLICY_DOC",
        `evidence-toolchain reference must document ${required}`,
      );
    }
  }
  for (const file of ["README.md", "CONTRIBUTING.md"]) {
    const document = files.get(file);
    if (!document.includes(rustVersion) || !document.includes("MSRV")) {
      reject(
        "E_POLICY_DOC",
        `${file}: must name the evidence Rust release and MSRV status`,
      );
    }
  }
}

function validatePolicy(files) {
  for (const file of REQUIRED_PATHS) {
    if (!files.has(file)) {
      reject("E_REQUIRED_FILE", `missing required policy input: ${file}`);
    }
  }

  const rustToolchain = files.get("rust-toolchain.toml");
  const rustVersion = exactVersion(
    tomlString(rustToolchain, "channel"),
    "E_RUST_PIN",
    "rust-toolchain.toml channel",
  );
  const components = tomlStringArray(rustToolchain, "components");
  const targets = tomlStringArray(rustToolchain, "targets");
  if (
    tomlString(rustToolchain, "profile") !== "minimal" ||
    !components?.includes("rustfmt") ||
    !components.includes("clippy") ||
    !targets?.includes("wasm32-wasip1")
  ) {
    reject(
      "E_RUST_TOOLCHAIN_SHAPE",
      "rust-toolchain.toml must select minimal, rustfmt, clippy, and wasm32-wasip1",
    );
  }

  const nodeVersion = exactVersion(
    files.get(".node-version").trim(),
    "E_NODE_PIN",
    ".node-version",
  );
  const nodeMajor = nodeVersion.split(".", 1)[0];
  const nodeEngine = `>=${nodeVersion} <${Number(nodeMajor) + 1}`;

  for (const [file, contents] of files) {
    if (
      file.endsWith("Cargo.toml") &&
      /^\s*rust-version\s*=/mu.test(contents)
    ) {
      reject(
        "E_MSRV_UNVERIFIED",
        `${file} must not declare rust-version until an MSRV lane verifies it`,
      );
    }
  }

  const rootPackage = parseJson(files, "package.json");
  const editorPackage = parseJson(files, "editors/vscode/package.json");
  if (
    rootPackage.engines?.node !== nodeEngine ||
    files.get(".npmrc").trim() !== "engine-strict=true"
  ) {
    reject(
      "E_NODE_ENGINE",
      `root npm installs must enforce Node ${nodeEngine}`,
    );
  }
  const typeScriptVersion = exactVersion(
    rootPackage.devDependencies?.typescript,
    "E_TYPESCRIPT_PIN",
    "root TypeScript dependency",
  );
  if (editorPackage.devDependencies?.typescript !== typeScriptVersion) {
    reject(
      "E_TYPESCRIPT_PIN",
      `editor TypeScript dependency must exactly match ${typeScriptVersion}`,
    );
  }
  assertTypeScriptLock(
    parseJson(files, "package-lock.json"),
    "package-lock.json",
    typeScriptVersion,
  );
  assertTypeScriptLock(
    parseJson(files, "editors/vscode/package-lock.json"),
    "editors/vscode/package-lock.json",
    typeScriptVersion,
  );

  const ci = files.get(".github/workflows/ci.yml");
  const release = files.get(".github/workflows/release.yml");
  assertPinnedActions(ci, ".github/workflows/ci.yml");
  assertPinnedActions(release, ".github/workflows/release.yml");
  assertPinnedRustActions(ci, ".github/workflows/ci.yml", rustVersion);
  assertPinnedRustActions(release, ".github/workflows/release.yml", rustVersion);
  assertPinnedNodeActions(ci, ".github/workflows/ci.yml");
  assertPinnedNodeActions(release, ".github/workflows/release.yml");

  if (ci.includes("npm install -g typescript")) {
    reject(
      "E_AMBIENT_TYPESCRIPT",
      ".github/workflows/ci.yml must not install a global TypeScript compiler",
    );
  }
  const installOrdering = workflowJobBodies(ci)
    .map((job) => hasRootRunBefore(job, "npm ci", "bash scripts/ir-witness.sh"))
    .filter((result) => result !== null);
  if (
    installOrdering.length === 0 ||
    installOrdering.some((result) => !result)
  ) {
    reject(
      "E_TYPESCRIPT_INSTALL",
      "primary CI must install root evidence dependencies before the IR witness",
    );
  }

  const witness = files.get("scripts/ir-witness.sh");
  if (
    !witness.includes('"$root/node_modules/.bin/tsc" -p witness/tsconfig.json') ||
    witness.includes("command -v tsc")
  ) {
    reject(
      "E_AMBIENT_TYPESCRIPT",
      "IR witness must invoke the root-local TypeScript compiler",
    );
  }
  const releasePrep = files.get("scripts/release-prep.sh");
  if (!/^\s*npm ci\s*$/mu.test(releasePrep)) {
    reject(
      "E_TYPESCRIPT_INSTALL",
      "release preparation must install root evidence dependencies",
    );
  }

  assertCompatibilityWorkflow(
    files.get(".github/workflows/compatibility.yml"),
    nodeMajor,
  );
  assertPolicyDocs(files, rustVersion, nodeVersion, typeScriptVersion);
}

function fixtureFiles() {
  const rustVersion = "1.97.1";
  const nodeVersion = "22.23.1";
  const typeScriptVersion = "5.9.3";
  const fullSha = "0123456789abcdef0123456789abcdef01234567";
  const packageJson = JSON.stringify({
    private: true,
    engines: { node: ">=22.23.1 <23" },
    devDependencies: { typescript: typeScriptVersion },
  });
  const packageLock = JSON.stringify({
    packages: {
      "": { devDependencies: { typescript: typeScriptVersion } },
      "node_modules/typescript": { version: typeScriptVersion },
    },
  });
  const primaryWorkflow = `
- uses: dtolnay/rust-toolchain@${fullSha}
  with:
    toolchain: "${rustVersion}"
- uses: actions/setup-node@${fullSha}
  with:
    node-version-file: ".node-version"
- run: npm ci
- run: bash scripts/ir-witness.sh
`;
  return new Map([
    [".github/workflows/ci.yml", primaryWorkflow],
    [
      ".github/workflows/compatibility.yml",
      `on:
  schedule:
    - cron: "0 0 * * 1"
  workflow_dispatch:
concurrency:
  group: \${{ github.workflow }}
  cancel-in-progress: false
jobs:
  rust:
    env:
      RUSTUP_TOOLCHAIN: stable
    steps:
      - uses: dtolnay/rust-toolchain@${fullSha}
        with:
          toolchain: stable
  node:
    steps:
      - uses: actions/setup-node@${fullSha}
        with:
          node-version: "22"
`,
    ],
    [".github/workflows/release.yml", primaryWorkflow],
    [".node-version", `${nodeVersion}\n`],
    [".npmrc", "engine-strict=true\n"],
    [
      "Cargo.toml",
      "# rust-version is intentionally unset until an MSRV lane verifies it.\n",
    ],
    [
      "CONTRIBUTING.md",
      `Evidence Rust ${rustVersion}; MSRV is intentionally unset.\n`,
    ],
    ["README.md", `Evidence Rust ${rustVersion}; MSRV is intentionally unset.\n`],
    [
      "docs/workflows/evidence-toolchains/README.md",
      `Rust ${rustVersion}; Node ${nodeVersion}; TypeScript ${typeScriptVersion}.
MSRV is unset. The maintainer reviews the weekly advisory lane.
`,
    ],
    ["editors/vscode/package-lock.json", packageLock],
    ["editors/vscode/package.json", packageJson],
    ["package-lock.json", packageLock],
    ["package.json", packageJson],
    [
      "rust-toolchain.toml",
      `[toolchain]
channel = "${rustVersion}"
profile = "minimal"
components = ["rustfmt", "clippy"]
targets = ["wasm32-wasip1"]
`,
    ],
    [
      "scripts/ir-witness.sh",
      '"$root/node_modules/.bin/tsc" -p witness/tsconfig.json\n',
    ],
    ["scripts/release-prep.sh", "npm ci\n"],
  ]);
}

function expectRejection(name, mutate, expectedCode) {
  const files = fixtureFiles();
  mutate(files);
  assert.throws(
    () => validatePolicy(files),
    (error) => error instanceof PolicyError && error.code === expectedCode,
    name,
  );
}

function selfTest() {
  validatePolicy(fixtureFiles());
  const cases = [
    [
      "moving Rust evidence channel",
      (files) =>
        files.set(
          "rust-toolchain.toml",
          files.get("rust-toolchain.toml").replace('1.97.1', "stable"),
        ),
      "E_RUST_PIN",
    ],
    [
      "incomplete Rust toolchain shape",
      (files) =>
        files.set(
          "rust-toolchain.toml",
          files.get("rust-toolchain.toml").replace('"clippy"', '"llvm-tools"'),
        ),
      "E_RUST_TOOLCHAIN_SHAPE",
    ],
    [
      "commented Rust toolchain component",
      (files) =>
        files.set(
          "rust-toolchain.toml",
          files
            .get("rust-toolchain.toml")
            .replace(
              'components = ["rustfmt", "clippy"]',
              'components = ["rustfmt"] # "clippy"',
            ),
        ),
      "E_RUST_TOOLCHAIN_SHAPE",
    ],
    [
      "moving primary Rust selector",
      (files) =>
        files.set(
          ".github/workflows/ci.yml",
          files
            .get(".github/workflows/ci.yml")
            .replace('toolchain: "1.97.1"', "toolchain: stable"),
        ),
      "E_PRIMARY_RUST_SELECTOR",
    ],
    [
      "misplaced primary Rust selector",
      (files) =>
        files.set(
          ".github/workflows/ci.yml",
          `${files
            .get(".github/workflows/ci.yml")
            .replace('toolchain: "1.97.1"', "toolchain: stable")}
- run: echo misplaced
  env:
    toolchain: "1.97.1"
`,
        ),
      "E_PRIMARY_RUST_SELECTOR",
    ],
    [
      "moving primary Node selector",
      (files) =>
        files.set(
          ".github/workflows/ci.yml",
          files
            .get(".github/workflows/ci.yml")
            .replace('node-version-file: ".node-version"', 'node-version: "22"'),
        ),
      "E_PRIMARY_NODE_SELECTOR",
    ],
    [
      "misplaced primary Node selector",
      (files) =>
        files.set(
          ".github/workflows/ci.yml",
          `${files
            .get(".github/workflows/ci.yml")
            .replace('node-version-file: ".node-version"', "cache: npm")}
- run: echo misplaced
  env:
    node-version-file: ".node-version"
`,
        ),
      "E_PRIMARY_NODE_SELECTOR",
    ],
    [
      "moving release Node selector",
      (files) =>
        files.set(
          ".github/workflows/release.yml",
          `${files.get(".github/workflows/release.yml")}
- uses: actions/setup-node@0123456789abcdef0123456789abcdef01234567
  with:
    node-version: "22"
`,
        ),
      "E_PRIMARY_NODE_SELECTOR",
    ],
    [
      "unpinned primary action",
      (files) =>
        files.set(
          ".github/workflows/ci.yml",
          files
            .get(".github/workflows/ci.yml")
            .replace(
              "actions/setup-node@0123456789abcdef0123456789abcdef01234567",
              "actions/setup-node@v5",
            ),
        ),
      "E_PRIMARY_ACTION_PIN",
    ],
    [
      "non-exact Node evidence release",
      (files) => files.set(".node-version", "22\n"),
      "E_NODE_PIN",
    ],
    [
      "missing Node engine constraint",
      (files) => {
        const json = JSON.parse(files.get("package.json"));
        delete json.engines;
        files.set("package.json", JSON.stringify(json));
      },
      "E_NODE_ENGINE",
    ],
    [
      "TypeScript dependency range",
      (files) => {
        const json = JSON.parse(files.get("package.json"));
        json.devDependencies.typescript = "^5.9.3";
        files.set("package.json", JSON.stringify(json));
      },
      "E_TYPESCRIPT_PIN",
    ],
    [
      "TypeScript lock drift",
      (files) => {
        const json = JSON.parse(files.get("package-lock.json"));
        json.packages["node_modules/typescript"].version = "5.9.2";
        files.set("package-lock.json", JSON.stringify(json));
      },
      "E_TYPESCRIPT_LOCK",
    ],
    [
      "unverified MSRV declaration",
      (files) => files.set("Cargo.toml", 'rust-version = "1.80"\n'),
      "E_MSRV_UNVERIFIED",
    ],
    [
      "unverified package-level MSRV declaration",
      (files) =>
        files.set("crates/sample/Cargo.toml", 'rust-version = "1.80"\n'),
      "E_MSRV_UNVERIFIED",
    ],
    [
      "ambient TypeScript compiler",
      (files) =>
        files.set(
          "scripts/ir-witness.sh",
          "command -v tsc\ntsc -p witness/tsconfig.json\n",
        ),
      "E_AMBIENT_TYPESCRIPT",
    ],
    [
      "editor install after the IR witness",
      (files) =>
        files.set(
          ".github/workflows/ci.yml",
          `${files
            .get(".github/workflows/ci.yml")
            .replace("- run: npm ci\n", "")}
- run: npm ci
  working-directory: editors/vscode
`,
        ),
      "E_TYPESCRIPT_INSTALL",
    ],
    [
      "fixed Rust compatibility selector",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          files
            .get(".github/workflows/compatibility.yml")
            .replace("toolchain: stable", 'toolchain: "1.97.1"'),
        ),
      "E_COMPAT_RUST_SELECTOR",
    ],
    [
      "missing compatibility concurrency",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          files
            .get(".github/workflows/compatibility.yml")
            .replace(
              `concurrency:
  group: \${{ github.workflow }}
  cancel-in-progress: false
`,
              "",
            ),
        ),
      "E_COMPAT_CONCURRENCY",
    ],
    [
      "missing Rust compatibility override",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          files
            .get(".github/workflows/compatibility.yml")
            .replace("RUSTUP_TOOLCHAIN: stable", "RUSTUP_TOOLCHAIN: 1.97.1"),
        ),
      "E_COMPAT_RUST_OVERRIDE",
    ],
    [
      "misplaced Rust compatibility override",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          `${files
            .get(".github/workflows/compatibility.yml")
            .replace(
              "RUSTUP_TOOLCHAIN: stable",
              'RUSTUP_TOOLCHAIN: "1.97.1"',
            )}
env:
  RUSTUP_TOOLCHAIN: stable
`,
        ),
      "E_COMPAT_RUST_OVERRIDE",
    ],
    [
      "second fixed Rust compatibility selector",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          `${files.get(".github/workflows/compatibility.yml")}
- uses: dtolnay/rust-toolchain@0123456789abcdef0123456789abcdef01234567
  with:
    toolchain: "1.97.1"
`,
        ),
      "E_COMPAT_RUST_SELECTOR",
    ],
    [
      "fixed Node compatibility selector",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          files
            .get(".github/workflows/compatibility.yml")
            .replace('node-version: "22"', 'node-version: "22.23.1"'),
        ),
      "E_COMPAT_NODE_SELECTOR",
    ],
    [
      "second incompatible Node selector",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          `${files.get(".github/workflows/compatibility.yml")}
- uses: actions/setup-node@0123456789abcdef0123456789abcdef01234567
  with:
    node-version: "24"
`,
        ),
      "E_COMPAT_NODE_SELECTOR",
    ],
    [
      "unpinned compatibility action",
      (files) =>
        files.set(
          ".github/workflows/compatibility.yml",
          files
            .get(".github/workflows/compatibility.yml")
            .replace(
              "actions/setup-node@0123456789abcdef0123456789abcdef01234567",
              "actions/setup-node@v5",
            ),
        ),
      "E_COMPAT_ACTION_PIN",
    ],
    [
      "missing policy ownership",
      (files) =>
        files.set(
          "docs/workflows/evidence-toolchains/README.md",
          files
            .get("docs/workflows/evidence-toolchains/README.md")
            .replace("maintainer", "operator"),
        ),
      "E_POLICY_DOC",
    ],
  ];
  for (const [name, mutate, expectedCode] of cases) {
    expectRejection(name, mutate, expectedCode);
  }
  console.log(
    `check-evidence-toolchains: ${cases.length} mutation cases passed`,
  );
}

function findCargoManifests(directory, relative = "") {
  const manifests = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childRelative = relative
      ? `${relative}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "target"].includes(entry.name)) {
        continue;
      }
      manifests.push(
        ...findCargoManifests(path.join(directory, entry.name), childRelative),
      );
    } else if (entry.name === "Cargo.toml") {
      manifests.push(childRelative);
    }
  }
  return manifests;
}

function repositoryFiles(root) {
  const files = new Map();
  const inputs = new Set([...REQUIRED_PATHS, ...findCargoManifests(root)]);
  for (const file of inputs) {
    const absolute = path.join(root, file);
    if (fs.existsSync(absolute)) {
      files.set(file, fs.readFileSync(absolute, "utf8"));
    }
  }
  return files;
}

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");

try {
  if (process.argv.length === 3 && process.argv[2] === "--self-test") {
    selfTest();
  } else if (process.argv.length === 2) {
    validatePolicy(repositoryFiles(root));
    console.log("check-evidence-toolchains: policy satisfied");
  } else {
    console.error("usage: node scripts/check-evidence-toolchains.mjs [--self-test]");
    process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof PolicyError) {
    console.error(`check-evidence-toolchains: ${error.code}: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
