#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROPERTY_VERSION = "1.11.0";
const FUZZ_RUNTIME_VERSION = "0.4.13";
const CARGO_FUZZ_VERSION = "0.13.2";
const PROPERTY_CASES = 256;
const PROPERTY_SEED = Object.freeze([
  0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
  0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
  0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
  0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
]);
const BOUNDED_COMMAND =
  "cargo test --locked -p colorful-cli --test property_boundaries -- --test-threads=1";
const FUZZ_FMT_COMMAND =
  "cargo fmt --manifest-path fuzz/Cargo.toml --all -- --check";
const FUZZ_CLIPPY_COMMAND =
  "cargo clippy --manifest-path fuzz/Cargo.toml --locked --bins -- -D warnings";
const FUZZ_CHECK_COMMAND =
  "cargo check --manifest-path fuzz/Cargo.toml --locked --bins";
const FUZZ_TARGETS = Object.freeze([
  "parser",
  "annotator",
  "ir_projection",
  "coordinates",
]);
const INPUT_PATHS = Object.freeze({
  rootManifest: "Cargo.toml",
  rootLock: "Cargo.lock",
  cliManifest: "crates/colorful-cli/Cargo.toml",
  propertyTest: "crates/colorful-cli/tests/property_boundaries.rs",
  coordinateSupport:
    "crates/colorful-cli/tests/support/property_coordinates.rs",
  fuzzManifest: "fuzz/Cargo.toml",
  fuzzLock: "fuzz/Cargo.lock",
  workflow: ".github/workflows/ci.yml",
  releasePrep: "scripts/release-prep.sh",
  reference: "docs/workflows/evidence-toolchains/README.md",
});
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class PropertyFuzzPolicyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PropertyFuzzPolicyError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new PropertyFuzzPolicyError(code, message);
}

function exactTomlVersion(source, dependency, version) {
  const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^\\s*${escaped}\\s*=\\s*"=${version.replaceAll(".", "\\.")}"\\s*$`,
    "mu",
  ).test(source);
}

function manifestTargets(source) {
  return [
    ...source.matchAll(
      /^\[\[bin\]\]\s*\nname\s*=\s*"([^"]+)"\s*\npath\s*=\s*"fuzz_targets\/([^"]+)\.rs"\s*$/gmu,
    ),
  ].map((match) => ({ name: match[1], path: match[2] }));
}

function lockHasPackage(source, name, version) {
  return new RegExp(
    `\\[\\[package\\]\\]\\s+name\\s*=\\s*"${name}"\\s+version\\s*=\\s*"${version.replaceAll(".", "\\.")}"`,
    "u",
  ).test(source);
}

function propertySeed(source) {
  const body = source.match(
    /^[ \t]*const[ \t]+PROPERTY_SEED:[ \t]*\[u8;[ \t]*32\][ \t]*=[ \t]*\[([\s\S]*?)^[ \t]*\];[ \t]*$/mu,
  )?.[1];
  if (body === undefined) {
    return null;
  }
  return [...body.matchAll(/\b0x([0-9a-fA-F]{2})\b/gu)].map((match) =>
    Number.parseInt(match[1], 16),
  );
}

function sameSequence(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function exactActiveLineCount(source, line) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [...source.matchAll(new RegExp(`^[ \\t]*${escaped}[ \\t]*$`, "gmu"))]
    .length;
}

function exactLine(source, line) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^\\s*${escaped}\\s*$`, "mu").test(source);
}

function jobBlock(workflow, name) {
  const lines = workflow.split("\n");
  const header = new RegExp(`^  ${name}:\\s*$`, "u");
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) {
    return null;
  }
  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/u.test(lines[end])) {
    end += 1;
  }
  return lines.slice(start, end);
}

function blockingRustStep(workflow, command) {
  const job = jobBlock(workflow, "rust");
  if (job === null) {
    return false;
  }
  if (
    job.some((line) => /^    if:/u.test(line)) ||
    job.some(
      (line) =>
        /^    continue-on-error:/u.test(line) &&
        !/^    continue-on-error:\s*false\s*$/u.test(line),
    )
  ) {
    return false;
  }

  const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const commandLine = new RegExp(`^      - run:\\s*${escaped}\\s*$`, "u");
  const start = job.findIndex((line) => commandLine.test(line));
  if (start === -1) {
    return false;
  }
  let end = start + 1;
  while (end < job.length && !/^      - /u.test(job[end])) {
    end += 1;
  }
  return !job.slice(start, end).some(
    (line) =>
      /^        if:/u.test(line) ||
      (/^        continue-on-error:/u.test(line) &&
        !/^        continue-on-error:\s*false\s*$/u.test(line)),
  );
}

export function validatePropertyFuzzPolicy(snapshot) {
  if (
    !exactTomlVersion(snapshot.rootManifest, "proptest", PROPERTY_VERSION)
  ) {
    reject(
      "E_PROPERTY_VERSION",
      `workspace proptest must be pinned as =${PROPERTY_VERSION}`,
    );
  }
  if (!lockHasPackage(snapshot.rootLock, "proptest", PROPERTY_VERSION)) {
    reject(
      "E_PROPERTY_LOCK",
      `Cargo.lock must resolve proptest ${PROPERTY_VERSION}`,
    );
  }
  if (
    !/^\s*proptest\s*=\s*\{\s*workspace\s*=\s*true\s*\}\s*$/mu.test(
      snapshot.cliManifest,
    )
  ) {
    reject(
      "E_PROPERTY_DEPENDENCY",
      "colorful-cli must consume the workspace proptest dependency",
    );
  }
  if (
    !/^\[\[test\]\][ \t]*\nname[ \t]*=[ \t]*"property_boundaries"[ \t]*\npath[ \t]*=[ \t]*"tests\/property_boundaries\.rs"[ \t]*\ntest[ \t]*=[ \t]*false[ \t]*$/mu.test(
      snapshot.cliManifest,
    )
  ) {
    reject(
      "E_PROPERTY_DEFAULT",
      "the bounded property target must run only through its explicit gate",
    );
  }

  const cases = Number(
    snapshot.propertyTest.match(
      /^[ \t]*const[ \t]+PROPERTY_CASES:[ \t]*u32[ \t]*=[ \t]*(\d+);[ \t]*$/mu,
    )?.[1],
  );
  if (cases !== PROPERTY_CASES) {
    reject(
      "E_PROPERTY_CASES",
      `the correctness corpus must contain exactly ${PROPERTY_CASES} cases`,
    );
  }
  const seed = propertySeed(snapshot.propertyTest);
  if (seed === null || !sameSequence(seed, PROPERTY_SEED)) {
    reject(
      "E_PROPERTY_SEED",
      "PROPERTY_SEED must match the reviewed 32-byte seed",
    );
  }
  if (
    !/^[ \t]*cases:[ \t]*PROPERTY_CASES,[ \t]*$/mu.test(
      snapshot.propertyTest,
    ) ||
    !/^[ \t]*TestRng::from_seed\(RngAlgorithm::ChaCha,[ \t]*&PROPERTY_SEED\)[,;][ \t]*$/mu.test(
      snapshot.propertyTest,
    ) ||
    exactActiveLineCount(snapshot.propertyTest, "runner()") !== 1
  ) {
    reject(
      "E_PROPERTY_RUNNER",
      "the property runner must use the reviewed case constant and ChaCha seed",
    );
  }
  if (
    !exactTomlVersion(
      snapshot.fuzzManifest,
      "libfuzzer-sys",
      FUZZ_RUNTIME_VERSION,
    )
  ) {
    reject(
      "E_FUZZ_VERSION",
      `fuzz libfuzzer-sys must be pinned as =${FUZZ_RUNTIME_VERSION}`,
    );
  }
  if (
    !lockHasPackage(
      snapshot.fuzzLock,
      "libfuzzer-sys",
      FUZZ_RUNTIME_VERSION,
    )
  ) {
    reject(
      "E_FUZZ_LOCK",
      `fuzz/Cargo.lock must resolve libfuzzer-sys ${FUZZ_RUNTIME_VERSION}`,
    );
  }

  const targetNames = Object.keys(snapshot.fuzzTargets).sort();
  const expectedNames = [...FUZZ_TARGETS].sort();
  if (!sameSequence(targetNames, expectedNames)) {
    reject(
      "E_FUZZ_TARGET",
      `fuzz target files must be exactly: ${FUZZ_TARGETS.join(", ")}`,
    );
  }
  for (const target of FUZZ_TARGETS) {
    if (!/^\s*fuzz_target!\(/mu.test(snapshot.fuzzTargets[target])) {
      reject(
        "E_FUZZ_TARGET",
        `${target} must contain a libFuzzer entry point`,
      );
    }
  }
  const sharedModule = /^[ \t]*mod[ \t]+property_coordinates;[ \t]*$/mu;
  const localCoordinateDefinition =
    /^[ \t]*(?:pub[ \t]+)?(?:struct[ \t]+FixedFinding|fn[ \t]+oracle_position)\b/mu;
  if (
    !sharedModule.test(snapshot.propertyTest) ||
    !sharedModule.test(snapshot.fuzzTargets.coordinates) ||
    localCoordinateDefinition.test(snapshot.propertyTest) ||
    localCoordinateDefinition.test(snapshot.fuzzTargets.coordinates) ||
    !/^[ \t]*pub[ \t]+struct[ \t]+FixedFinding\b/mu.test(
      snapshot.coordinateSupport,
    ) ||
    !/^[ \t]*pub[ \t]+fn[ \t]+oracle_position\b/mu.test(
      snapshot.coordinateSupport,
    )
  ) {
    reject(
      "E_COORDINATE_SUPPORT",
      "property and fuzz coordinates must share one test-support oracle",
    );
  }
  const declared = manifestTargets(snapshot.fuzzManifest);
  if (
    declared.length !== FUZZ_TARGETS.length ||
    !FUZZ_TARGETS.every((target) =>
      declared.some(
        (entry) => entry.name === target && entry.path === target,
      ),
    )
  ) {
    reject(
      "E_FUZZ_MANIFEST",
      `fuzz manifest must declare exactly: ${FUZZ_TARGETS.join(", ")}`,
    );
  }

  if (!blockingRustStep(snapshot.workflow, BOUNDED_COMMAND)) {
    reject(
      "E_PROPERTY_CI",
      `the unconditional blocking Rust job must run: ${BOUNDED_COMMAND}`,
    );
  }
  if (!blockingRustStep(snapshot.workflow, FUZZ_CHECK_COMMAND)) {
    reject(
      "E_FUZZ_CI",
      `the unconditional blocking Rust job must run: ${FUZZ_CHECK_COMMAND}`,
    );
  }
  if (!blockingRustStep(snapshot.workflow, FUZZ_FMT_COMMAND)) {
    reject(
      "E_FUZZ_FMT_CI",
      `the unconditional blocking Rust job must run: ${FUZZ_FMT_COMMAND}`,
    );
  }
  if (!blockingRustStep(snapshot.workflow, FUZZ_CLIPPY_COMMAND)) {
    reject(
      "E_FUZZ_CLIPPY_CI",
      `the unconditional blocking Rust job must run: ${FUZZ_CLIPPY_COMMAND}`,
    );
  }
  if (/\bcargo(?:\s+\+\S+)?\s+fuzz\b/u.test(snapshot.workflow)) {
    reject(
      "E_FUZZ_IN_CI",
      "time-based cargo fuzz commands must stay outside correctness CI",
    );
  }
  if (!exactLine(snapshot.releasePrep, BOUNDED_COMMAND)) {
    reject(
      "E_PROPERTY_RELEASE_GATE",
      `release preparation must run: ${BOUNDED_COMMAND}`,
    );
  }
  if (!exactLine(snapshot.releasePrep, FUZZ_CHECK_COMMAND)) {
    reject(
      "E_FUZZ_RELEASE_GATE",
      `release preparation must run: ${FUZZ_CHECK_COMMAND}`,
    );
  }
  if (!exactLine(snapshot.releasePrep, FUZZ_FMT_COMMAND)) {
    reject(
      "E_FUZZ_FMT_RELEASE_GATE",
      `release preparation must run: ${FUZZ_FMT_COMMAND}`,
    );
  }
  if (!exactLine(snapshot.releasePrep, FUZZ_CLIPPY_COMMAND)) {
    reject(
      "E_FUZZ_CLIPPY_RELEASE_GATE",
      `release preparation must run: ${FUZZ_CLIPPY_COMMAND}`,
    );
  }

  const install =
    `cargo install cargo-fuzz --version ${CARGO_FUZZ_VERSION} --locked`;
  if (!exactLine(snapshot.reference, install)) {
    reject(
      "E_FUZZ_COMMAND",
      `the fuzz reference must pin installation with: ${install}`,
    );
  }
  for (const target of FUZZ_TARGETS) {
    const command =
      `cargo +nightly fuzz run ${target} -- -max_total_time=60`;
    if (!exactLine(snapshot.reference, command)) {
      reject(
        "E_FUZZ_COMMAND",
        `the fuzz reference must include: ${command}`,
      );
    }
  }
}

function readUtf8(root, relativePath) {
  try {
    return readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    reject("E_POLICY_INPUT", `${relativePath}: cannot read policy input`);
  }
}

function readSnapshot(root) {
  const snapshot = Object.fromEntries(
    Object.entries(INPUT_PATHS).map(([key, relativePath]) => [
      key,
      readUtf8(root, relativePath),
    ]),
  );
  snapshot.fuzzTargets = Object.fromEntries(
    FUZZ_TARGETS.map((target) => [
      target,
      readUtf8(root, `fuzz/fuzz_targets/${target}.rs`),
    ]),
  );
  return snapshot;
}

function parseRoot(argv) {
  if (argv.length === 0) {
    return repositoryRoot;
  }
  if (argv.length === 2 && argv[0] === "--root") {
    return path.resolve(argv[1]);
  }
  reject(
    "E_POLICY_USAGE",
    "usage: scripts/check-property-fuzz-policy.mjs [--root PATH]",
  );
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  validatePropertyFuzzPolicy(readSnapshot(root));
  process.stdout.write(
    `check-property-fuzz-policy: ${PROPERTY_CASES} seeded cases and ${FUZZ_TARGETS.length} manual fuzz targets are pinned\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    if (error instanceof PropertyFuzzPolicyError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
