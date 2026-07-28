import assert from "node:assert/strict";
import test from "node:test";

import {
  PropertyFuzzPolicyError,
  validatePropertyFuzzPolicy,
} from "./check-property-fuzz-policy.mjs";

const BOUNDED_COMMAND =
  "cargo test --locked -p colorful-cli --test property_boundaries -- --test-threads=1";
const VALID_SNAPSHOT = Object.freeze({
  rootManifest: `
[workspace.dependencies]
proptest = "=1.11.0"
`,
  cliManifest: `
[dev-dependencies]
proptest = { workspace = true }
`,
  propertyTest: `
const PROPERTY_CASES: u32 = 256;
const PROPERTY_SEED: [u8; 32] = [
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
    0x13, 0x04, 0x13, 0x04, 0x13, 0x04, 0x13, 0x04,
];
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
  fuzzTargets: Object.freeze({
    parser: "#![no_main]\n",
    annotator: "#![no_main]\n",
    ir_projection: "#![no_main]\n",
    coordinates: "#![no_main]\n",
  }),
  workflow: `
jobs:
  rust:
    steps:
      - run: ${BOUNDED_COMMAND}
`,
  releasePrep: `${BOUNDED_COMMAND}\n`,
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

test("rejects a changed deterministic case bound", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      propertyTest: VALID_SNAPSHOT.propertyTest.replace("256", "255"),
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

test("rejects a missing blocking correctness-CI command", () => {
  expectPolicyError(
    {
      ...VALID_SNAPSHOT,
      workflow: VALID_SNAPSHOT.workflow.replace(BOUNDED_COMMAND, ""),
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

test("rejects a missing release-preparation command", () => {
  expectPolicyError(
    { ...VALID_SNAPSHOT, releasePrep: "" },
    "E_PROPERTY_RELEASE_GATE",
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
