import assert from "node:assert/strict";

import {
  extractProfileOrder,
  extractWorkflowOrder,
  validateMatchingOrders,
  validatePublishOrder,
} from "./check-release-publish-order.mjs";

const packages = [
  { name: "colorful-core", dependencies: [] },
  {
    name: "colorful-lexicon",
    dependencies: [{ name: "colorful-core", kind: null, path: "/core" }],
  },
  {
    name: "colorful-parse",
    dependencies: [
      { name: "colorful-core", kind: null, path: "/core" },
      {
        name: "colorful-lexicon",
        kind: "dev",
        path: "/lexicon",
      },
    ],
  },
];
const validOrder = ["colorful-core", "colorful-lexicon", "colorful-parse"];

assert.deepEqual(validatePublishOrder(validOrder, packages), []);
assert.deepEqual(
  validatePublishOrder(
    ["colorful-core", "colorful-parse", "colorful-lexicon"],
    packages,
  ),
  [
    "colorful-parse depends on colorful-lexicon (dev), but colorful-lexicon does not precede colorful-parse",
  ],
);
assert.deepEqual(validatePublishOrder(["colorful-core", "colorful-parse"], packages), [
  "publish order is missing publishable workspace package colorful-lexicon",
]);
assert.deepEqual(
  validatePublishOrder(
    ["colorful-core", "colorful-lexicon", "colorful-parse", "colorful-parse"],
    packages,
  ),
  ["publish order repeats colorful-parse"],
);
assert.deepEqual(
  validatePublishOrder(validOrder, [
    ...packages,
    { name: "repository-tool", publish: [], dependencies: [] },
  ]),
  [],
);

const profile = `
publish:
  registries:
    - name: crates.io
      packages:
        - colorful-core
        - colorful-lexicon
        - colorful-parse
      verify: cargo info {crate}@{version}
`;
assert.deepEqual(extractProfileOrder(profile), validOrder);

const workflow = `
for crate in colorful-core colorful-lexicon colorful-parse; do
  cargo publish -p "$crate"
done
`;
assert.deepEqual(extractWorkflowOrder(workflow), validOrder);
assert.deepEqual(validateMatchingOrders(validOrder, validOrder), []);
assert.deepEqual(
  validateMatchingOrders(validOrder, [
    "colorful-core",
    "colorful-parse",
    "colorful-lexicon",
  ]),
  [
    "release profile and workflow publish orders differ: profile=colorful-core,colorful-lexicon,colorful-parse workflow=colorful-core,colorful-parse,colorful-lexicon",
  ],
);

console.log("check-release-publish-order tests passed");
