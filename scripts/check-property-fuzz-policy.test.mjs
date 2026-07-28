import assert from "node:assert/strict";
import test from "node:test";

import {
  PropertyFuzzPolicyError,
  validatePropertyFuzzPolicy,
} from "./check-property-fuzz-policy.mjs";

const BOUNDED_COMMAND =
  "cargo test --locked -p colorful-cli --test property_boundaries -- --test-threads=1";
const FUZZ_CHECK_COMMAND =
  "cargo check --manifest-path fuzz/Cargo.toml --locked --bins";
const FUZZ_FMT_COMMAND =
  "cargo fmt --manifest-path fuzz/Cargo.toml --all -- --check";
const FUZZ_CLIPPY_COMMAND =
  "cargo clippy --manifest-path fuzz/Cargo.toml --locked --bins -- -D warnings";
const VALID_SNAPSHOT = Object.freeze({
  rootManifest: `
[workspace.dependencies]
proptest = "=1.11.0"
`,
  rootLock: `
[[package]]
name = "proptest"
version = "1.11.0"
`,
  cliManifest: `
[dev-dependencies]
proptest = { workspace = true }

[[test]]
name = "property_boundaries"
path = "tests/property_boundaries.rs"
test = false
`,
  propertyTest: `
const PROPERTY_CASES: u32 = 256;
const PROPERTY_SEED: [u8; 32] = [
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
];
let config = Config {
    cases: PROPERTY_CASES,
};
TestRng::from_seed(RngAlgorithm::ChaCha, &PROPERTY_SEED);
runner()
`,
  fuzzManifest: `
[dependencies]
libfuzzer-sys = "=0.4.13"

[[bin]]
name = "parser"
path = "fuzz_targets/parser.rs"

[[bin]]
name = "annotator"
path = "fuzz_targets/annotator.rs"

[[bin]]
name = "ir_projection"
path = "fuzz_targets/ir_projection.rs"

[[bin]]
name = "coordinates"
path = "fuzz_targets/coordinates.rs"
`,
  fuzzLock: `
[[package]]
name = "libfuzzer-sys"
version = "0.4.13"
`,
  fuzzTargets: Object.freeze({
    parser: "#![no_main]\nfuzz_target!(|source: &str| {});\n",
    annotator: "#![no_main]\nfuzz_target!(|source: &str| {});\n",
    ir_projection: "#![no_main]\nfuzz_target!(|source: &str| {});\n",
    coordinates: "#![no_main]\nfuzz_target!(|source: &str| {});\n",
  }),
  workflow: `
jobs:
  rust:
    steps:
      - run: ${BOUNDED_COMMAND}
      - run: ${FUZZ_FMT_COMMAND}
      - run: ${FUZZ_CLIPPY_COMMAND}
      - run: ${FUZZ_CHECK_COMMAND}
`,
  releasePrep: [
    BOUNDED_COMMAND,
    FUZZ_FMT_COMMAND,
    FUZZ_CLIPPY_COMMAND,
    FUZZ_CHECK_COMMAND,
    "",
  ].join("\n"),
  reference: `
cargo install cargo-fuzz --version 0.13.2 --locked
cargo +nightly fuzz run parser -- -max_total_time=60
cargo +nightly fuzz run annotator -- -max_total_time=60
cargo +nightly fuzz run ir_projection -- -max_total_time=60
cargo +nightly fuzz run coordinates -- -max_total_time=60
`,
});

function expectPolicyError(snapshot, code) {
  assert.throws(
    () => validatePropertyFuzzPolicy(snapshot),
    (error) => {
      assert.ok(error instanceof PropertyFuzzPolicyError);
      assert.equal(error.code, code);
      return true;
    },
  );
}

test("accepts the pinned bounded corpus and manual fuzz inventory", () => {
  assert.doesNotThrow(() => validatePropertyFuzzPolicy(VALID_SNAPSHOT));
});

test("rejects a floating property-test dependency", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      rootManifest: VALID_SNAPSHOT.rootManifest.replace(
        '"=1.11.0"',
        '"1.11"',
      ),
    },
    "E_PROPERTY_VERSION",
  );
});

test("rejects a missing CLI property-test dependency", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      cliManifest: VALID_SNAPSHOT.cliManifest.replace(
        "proptest = { workspace = true }",
        "",
      ),
    },
    "E_PROPERTY_DEPENDENCY",
  );
});

test("rejects default aggregate discovery of the bounded property target", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      cliManifest: VALID_SNAPSHOT.cliManifest.replace("test = false", ""),
    },
    "E_PROPERTY_DEFAULT",
  );
});

test("rejects property lockfile drift", () => {
  expectPolicyError(
    { ...VALID_SNAPSHOT, rootLock: "" },
    "E_PROPERTY_LOCK",
  );
});

test("rejects a changed deterministic case bound", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace("256", "255"),
    },
    "E_PROPERTY_CASES",
  );
});

test("rejects a case bound that exists only in a comment", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace(
        "const PROPERTY_CASES: u32 = 256;",
        "// const PROPERTY_CASES: u32 = 256;",
      ),
    },
    "E_PROPERTY_CASES",
  );
});

test("rejects a seed that is not exactly 32 bytes", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace(
        "    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,\n];",
        "];",
      ),
    },
    "E_PROPERTY_SEED",
  );
});

test("rejects a reviewed seed declaration that exists only in comments", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace(
        /const PROPERTY_SEED:[\s\S]*?\n\];/u,
        (declaration) =>
          declaration
            .split("\n")
            .map((line) => `// ${line}`)
            .join("\n"),
      ),
    },
    "E_PROPERTY_SEED",
  );
});

test("rejects deterministic seed drift", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace("0x13", "0x14"),
    },
    "E_PROPERTY_SEED",
  );
});

test("rejects a property runner that ignores the reviewed seed", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace(
        "RngAlgorithm::ChaCha",
        "RngAlgorithm::XorShift",
      ),
    },
    "E_PROPERTY_RUNNER",
  );
});

test("rejects a reviewed runner call that exists only in a comment", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace(
        "TestRng::from_seed(RngAlgorithm::ChaCha, &PROPERTY_SEED);",
        `// TestRng::from_seed(RngAlgorithm::ChaCha, &PROPERTY_SEED);
TestRng::from_entropy();`,
      ),
    },
    "E_PROPERTY_RUNNER",
  );
});

test("rejects multiple bounded property runner invocations", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace(
        "runner()\n",
        "runner()\nrunner()\n",
      ),
    },
    "E_PROPERTY_RUNNER",
  );
});

test("rejects a floating fuzz runtime dependency", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      fuzzManifest: VALID_SNAPSHOT.fuzzManifest.replace(
        '"=0.4.13"',
        '"0.4"',
      ),
    },
    "E_FUZZ_VERSION",
  );
});

test("rejects fuzz-runtime lockfile drift", () => {
  expectPolicyError(
    { ...VALID_SNAPSHOT, fuzzLock: "" },
    "E_FUZZ_LOCK",
  );
});

test("rejects a missing fuzz target", () => {
  const { coordinates: _coordinates, ...fuzzTargets } =
    VALID_SNAPSHOT.fuzzTargets;
  expectPolicyError(
    { ...VALID_SNAPSHOT, fuzzTargets },
    "E_FUZZ_TARGET",
  );
});

test("rejects a fuzz target missing from its manifest", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      fuzzManifest: VALID_SNAPSHOT.fuzzManifest.replace(
        `
[[bin]]
name = "coordinates"
path = "fuzz_targets/coordinates.rs"
`,
        "",
      ),
    },
    "E_FUZZ_MANIFEST",
  );
});

test("rejects a manifest target declared only in a comment", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      fuzzManifest: VALID_SNAPSHOT.fuzzManifest.replace(
        `
[[bin]]
name = "coordinates"
path = "fuzz_targets/coordinates.rs"
`,
        `
# [[bin]] name = "coordinates" path = "fuzz_targets/coordinates.rs"
`,
      ),
    },
    "E_FUZZ_MANIFEST",
  );
});

test("rejects a fuzz target without a libFuzzer entry point", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      fuzzTargets: {
        ...VALID_SNAPSHOT.fuzzTargets,
        parser: "#![no_main]\n",
      },
    },
    "E_FUZZ_TARGET",
  );
});

test("rejects a fuzz entry point that exists only in a comment", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      fuzzTargets: {
        ...VALID_SNAPSHOT.fuzzTargets,
        parser: "#![no_main]\n// fuzz_target!(|source: &str| {});\n",
      },
    },
    "E_FUZZ_TARGET",
  );
});

test("rejects a missing blocking correctness-CI command", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(BOUNDED_COMMAND, ""),
    },
    "E_PROPERTY_CI",
  );
});

test("rejects the bounded command outside the Rust job", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace("rust:", "docs:"),
    },
    "E_PROPERTY_CI",
  );
});

test("rejects a guarded bounded-corpus step", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(
        `      - run: ${BOUNDED_COMMAND}`,
        `      - run: ${BOUNDED_COMMAND}\n        if: false`,
      ),
    },
    "E_PROPERTY_CI",
  );
});

test("rejects a non-blocking Rust job", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(
        "  rust:\n",
        "  rust:\n    continue-on-error: true\n",
      ),
    },
    "E_PROPERTY_CI",
  );
});

test("rejects time-based fuzzing in correctness CI", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: `${VALID_SNAPSHOT.workflow}\n      - run: cargo +nightly fuzz run parser\n`,
    },
    "E_FUZZ_IN_CI",
  );
});

test("rejects a missing blocking fuzz-target compilation", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(FUZZ_CHECK_COMMAND, ""),
    },
    "E_FUZZ_CI",
  );
});

test("rejects missing blocking fuzz-workspace formatting", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(FUZZ_FMT_COMMAND, ""),
    },
    "E_FUZZ_FMT_CI",
  );
});

test("rejects missing blocking fuzz-workspace Clippy", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(FUZZ_CLIPPY_COMMAND, ""),
    },
    "E_FUZZ_CLIPPY_CI",
  );
});

test("rejects a missing release-preparation command", () => {
  expectPolicyError(
    { ...VALID_SNAPSHOT, releasePrep: "" },
    "E_PROPERTY_RELEASE_GATE",
  );
});

test("rejects missing release-preparation fuzz-target compilation", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      releasePrep: VALID_SNAPSHOT.releasePrep.replace(
        FUZZ_CHECK_COMMAND,
        "",
      ),
    },
    "E_FUZZ_RELEASE_GATE",
  );
});

test("rejects missing release-preparation fuzz formatting", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      releasePrep: VALID_SNAPSHOT.releasePrep.replace(FUZZ_FMT_COMMAND, ""),
    },
    "E_FUZZ_FMT_RELEASE_GATE",
  );
});

test("rejects missing release-preparation fuzz Clippy", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      releasePrep: VALID_SNAPSHOT.releasePrep.replace(
        FUZZ_CLIPPY_COMMAND,
        "",
      ),
    },
    "E_FUZZ_CLIPPY_RELEASE_GATE",
  );
});

test("rejects an unpinned cargo-fuzz installation command", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      reference: VALID_SNAPSHOT.reference.replace(
        " --version 0.13.2 --locked",
        "",
      ),
    },
    "E_FUZZ_COMMAND",
  );
});

test("rejects a missing manual fuzz-target command", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      reference: VALID_SNAPSHOT.reference.replace(
        "cargo +nightly fuzz run coordinates -- -max_total_time=60",
        "",
      ),
    },
    "E_FUZZ_COMMAND",
  );
});
