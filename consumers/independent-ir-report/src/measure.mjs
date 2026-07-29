#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANSI_ERROR_CODES } from "./ansi.mjs";
import { decideIrContract } from "./decision.mjs";
import { IR_ERROR_CODES } from "./ir.mjs";
import { LSP_ERROR_CODES } from "./lsp.mjs";
import { measurePortableAdmission } from "./measure-portable-admission.mjs";
import {
  SYNTAX_ADMISSION_REVIEW_CASES,
} from "../../../scripts/syntax-admission-review-cases.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = path.resolve(ROOT, "../..");
const OUTPUT = path.join(ROOT, "evidence", "integration-effort.json");
const packageJson = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
);
const runtimeDependencyCount = Object.keys(packageJson.dependencies ?? {}).length;
const portableAdmissionSource = "generated/syntax-admission-v1.mjs";
const portableAdmissionSources = [
  "consumers/generated/syntax-admission-v1.mjs",
  "consumers/independent-ir-report/generated/syntax-admission-v1.mjs",
];

function sourceLines(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8").split("\n");
}

function totalSourceLines(relativePaths, measure) {
  return relativePaths.reduce(
    (total, relativePath) => total + measure(relativePath),
    0,
  );
}

function nonblankSourceLines(relativePath) {
  return sourceLines(relativePath).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//");
  }).length;
}

function migrationSpecificLines(relativePath) {
  let inside = false;
  let count = 0;
  for (const line of sourceLines(relativePath)) {
    const trimmed = line.trim();
    if (trimmed === "// effort:migration:start") {
      if (inside) throw new Error(`nested migration marker in ${relativePath}`);
      inside = true;
    } else if (trimmed === "// effort:migration:end") {
      if (!inside) throw new Error(`unmatched migration marker in ${relativePath}`);
      inside = false;
    } else if (inside && trimmed.length > 0 && !trimmed.startsWith("//")) {
      count += 1;
    }
  }
  if (inside) throw new Error(`unterminated migration marker in ${relativePath}`);
  return count;
}

const definitions = {
  ir: {
    sources: ["src/ir.mjs"],
    stableErrorCategories: [...IR_ERROR_CODES, "E_IO"],
    verifiedIdentities: [
      "contractVersion",
      "schemaHash",
      "vocabularyHash",
      "sourceLength",
      "sourceHash",
    ],
    fixtures: [
      "fixtures/releases/v0.2.1/ir.json",
      "fixtures/releases/v0.3.0/ir.json",
      "fixtures/releases/v0.2.1/syntax.v1.graphql",
      "fixtures/releases/v0.3.0/syntax.v1.graphql",
      "fixtures/releases/v0.2.1/vocabulary.v1.json",
      "fixtures/releases/v0.3.0/vocabulary.v1.json",
    ],
    reviewedAssertions: 45,
    processSteps: ["emit IR", "decode and admit", "render spans"],
  },
  ansi: {
    sources: ["src/ansi.mjs"],
    stableErrorCategories: ANSI_ERROR_CODES,
    verifiedIdentities: ["exact source text"],
    fixtures: ["fixtures/releases/v0.3.0/ansi.txt"],
    reviewedAssertions: 5,
    processSteps: [
      "emit ANSI text",
      "parse terminal escapes",
      "reconstruct source offsets",
      "render spans",
    ],
  },
  lsp: {
    sources: [
      "src/lsp.mjs",
      "src/lsp-fixture.mjs",
      "scripts/capture-lsp.mjs",
    ],
    stableErrorCategories: LSP_ERROR_CODES,
    verifiedIdentities: ["serverVersion", "semanticTokenLegend"],
    fixtures: ["fixtures/releases/v0.3.0/lsp.json"],
    reviewedAssertions: 11,
    processSteps: [
      "initialize server",
      "open document",
      "request semantic tokens",
      "decode delta UTF-16 coordinates",
      "render spans",
    ],
  },
};

function measureAdapter(definition) {
  for (const fixture of definition.fixtures) {
    readFileSync(path.join(ROOT, fixture));
  }
  return {
    sources: definition.sources,
    nonblankAdapterLines: totalSourceLines(
      definition.sources,
      nonblankSourceLines,
    ),
    migrationSpecificLines: totalSourceLines(
      definition.sources,
      migrationSpecificLines,
    ),
    stableErrorCategories: [...definition.stableErrorCategories],
    verifiedIdentities: definition.verifiedIdentities,
    fixtureCount: definition.fixtures.length,
    reviewedAssertions: definition.reviewedAssertions,
    runtimeDependencies: runtimeDependencyCount,
    processSteps: definition.processSteps,
  };
}

const adapters = Object.fromEntries(
  Object.entries(definitions).map(([name, definition]) => [
    name,
    measureAdapter(definition),
  ]),
);
const canonicalPortableAdmission = readFileSync(
  path.join(ROOT, portableAdmissionSource),
);
const portableAdmissionCopies = portableAdmissionSources.map(
  (relativePath) => {
    try {
      return {
        path: relativePath,
        bytes: readFileSync(path.join(REPOSITORY_ROOT, relativePath)),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `generated admission copy ${relativePath} is missing`,
          { cause: error },
        );
      }
      throw error;
    }
  },
);
const portableAdmissionMeasurement = measurePortableAdmission(
  canonicalPortableAdmission,
  portableAdmissionCopies,
);
const portableAdmission = {
  authority:
    "contracts/colorful/syntax-compatibility.v1.json and its generation SDLs",
  sources: portableAdmissionSources,
  generatedCopies: portableAdmissionSources.length,
  ...portableAdmissionMeasurement,
  copyIdentityEvidence: "scripts/check-generated-syntax-admission-drift.sh",
  reviewedGeneratorCaseAuthority:
    "scripts/syntax-admission-review-cases.mjs",
  reviewedGeneratorCases: SYNTAX_ADMISSION_REVIEW_CASES.length,
  countedAsAuthoredAdapter: false,
  rationale:
    "generated structural admission is reported separately; only authored " +
    "adapter lines participate in the retain-or-simplify decision",
};
const correctnessAdvantage =
  adapters.ir.verifiedIdentities.length === 5 &&
  adapters.ansi.verifiedIdentities.length < 5 &&
  adapters.lsp.verifiedIdentities.length < 5;
const result = decideIrContract({
  irLines: adapters.ir.nonblankAdapterLines,
  ansiLines: adapters.ansi.nonblankAdapterLines,
  lspLines: adapters.lsp.nonblankAdapterLines,
  correctnessAdvantage,
});

const report = {
  reportVersion: "colorful.integration-effort/v1",
  targetArtifact: "deterministic Markdown highlight-span report",
  method: {
    lines:
      "nonblank non-comment lines in each adapter, including " +
      "protocol-specific acquisition; shared profile/rendering code is " +
      "reported separately",
    errors: "exported stable adapter error-code inventory",
    fixtures: "checked-in inputs read by this measurement",
    assertions: "reviewed black-box outcomes in test/consumer.test.mjs",
    migration: "nonblank lines between effort:migration markers",
    dependencies: "runtime package dependencies required by an adapter",
    processSteps: "distinct external or decoding stages for the same job",
    generated:
      "generated structural admission is reported as unique logical lines " +
      "and total committed copy lines, never as authored adapter code",
  },
  sharedNonblankLines:
    nonblankSourceLines("src/common.mjs") +
    nonblankSourceLines("src/profile.mjs"),
  adapters,
  portableAdmission,
  decisionRule: {
    retain:
      "retain stable v1 when IR uniquely verifies all five wire identities " +
      "and its adapter is no larger than twice the combined ANSI and LSP " +
      "adapters, or when IR is the smallest adapter",
    simplify:
      "otherwise preserve compatibility but simplify implementation or " +
      "optional surface before adding contract fields",
  },
  result,
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;
const [mode] = process.argv.slice(2);

if (mode === "--write") {
  writeFileSync(OUTPUT, rendered);
} else if (mode === "--check") {
  if (readFileSync(OUTPUT, "utf8") !== rendered) {
    process.stderr.write(
      "independent-ir-report: integration-effort ledger is stale; " +
        "run npm run measure -- --write\n",
    );
    process.exit(1);
  }
} else if (mode === undefined) {
  process.stdout.write(rendered);
} else {
  process.stderr.write("usage: measure.mjs [--check|--write]\n");
  process.exit(2);
}
