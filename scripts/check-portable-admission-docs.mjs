#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_PATH =
  "consumers/independent-ir-report/evidence/integration-effort.json";

export const PORTABLE_ADMISSION_DOCS = Object.freeze([
  "CHANGELOG.md",
  "ROADMAP.md",
  "consumers/independent-ir-report/README.md",
  "docs/topics/downstream-consumers/README.md",
  "docs/topics/downstream-consumers/test-plan.md",
  "docs/topics/ir/README.md",
  "docs/topics/ir/architecture.md",
  "docs/topics/ir/test-plan.md",
]);

function fail(message) {
  throw new Error(`portable admission documentation drift: ${message}`);
}

function natural(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`ledger ${label} must be a nonnegative safe integer`);
  }
  return value;
}

function commaSeparated(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function evidenceFacts(ledger) {
  const adapter = ledger?.adapters?.ir;
  const portable = ledger?.portableAdmission;
  return {
    authored: natural(adapter?.nonblankAdapterLines, "authored IR lines"),
    migration: natural(
      adapter?.migrationSpecificLines,
      "IR migration lines",
    ),
    failures: natural(
      adapter?.stableErrorCategories?.length,
      "IR stable failures",
    ),
    identities: natural(
      adapter?.verifiedIdentities?.length,
      "IR verified identities",
    ),
    shared: natural(ledger?.sharedNonblankLines, "shared lines"),
    alternatives: natural(
      ledger?.result?.alternativesNonblankAdapterLines,
      "alternative adapter lines",
    ),
    uniqueGenerated: natural(
      portable?.uniqueGeneratedNonblankLines,
      "unique generated lines",
    ),
    committedGenerated: natural(
      portable?.committedGeneratedNonblankLines,
      "committed generated lines",
    ),
  };
}

function expectedFragments(facts) {
  const unique = commaSeparated(facts.uniqueGenerated);
  const committed = commaSeparated(facts.committedGenerated);
  return new Map([
    [
      "CHANGELOG.md",
      [
        `${facts.authored} authored IR adapter`,
        `${unique} unique / ${committed} committed`,
      ],
    ],
    [
      "ROADMAP.md",
      [
        `${facts.authored} authored IR lines`,
        `${facts.alternatives} lines`,
        `${unique} unique generated admission lines`,
      ],
    ],
    [
      "consumers/independent-ir-report/README.md",
      [
        `| IR | ${facts.authored} | ${facts.failures} | ${facts.identities} |`,
        `${unique} unique nonblank lines`,
        `${committed} lines across the two`,
      ],
    ],
    [
      "docs/topics/downstream-consumers/README.md",
      [
        `${facts.authored} authored nonblank IR adapter lines`,
        `${unique} unique nonblank lines`,
        `${committed} lines across two`,
      ],
    ],
    [
      "docs/topics/downstream-consumers/test-plan.md",
      [
        `${facts.authored} authored lines`,
        `${unique} unique generated admission`,
      ],
    ],
    [
      "docs/topics/ir/README.md",
      [
        `${facts.authored} authored nonblank IR adapter lines`,
        `${facts.migration} migration-specific lines`,
        `${unique} unique nonblank lines`,
        `${committed} lines`,
      ],
    ],
    [
      "docs/topics/ir/architecture.md",
      [
        `| IR | ${facts.authored} | ${facts.migration} | ${facts.failures} | ${facts.identities} |`,
        `another ${facts.shared} nonblank lines`,
        `${unique} unique nonblank lines`,
        `${committed} lines`,
      ],
    ],
    [
      "docs/topics/ir/test-plan.md",
      [
        `${facts.authored} authored IR adapter lines`,
        `${unique} unique / ${committed}`,
      ],
    ],
  ]);
}

export function checkPortableAdmissionDocs({ ledger, documents }) {
  if (!(documents instanceof Map)) {
    fail("documents must be a Map keyed by repository-relative path");
  }
  const fragmentsByPath = expectedFragments(evidenceFacts(ledger));
  for (const relativePath of PORTABLE_ADMISSION_DOCS) {
    const source = documents.get(relativePath);
    if (typeof source !== "string") {
      fail(`${relativePath} is missing from the documentation input`);
    }
    for (const fragment of fragmentsByPath.get(relativePath)) {
      if (!source.includes(fragment)) {
        fail(`${relativePath} is missing ${JSON.stringify(fragment)}`);
      }
    }
  }
}

function checkWorkspace() {
  const ledger = JSON.parse(
    readFileSync(path.join(ROOT, LEDGER_PATH), "utf8"),
  );
  const documents = new Map(
    PORTABLE_ADMISSION_DOCS.map((relativePath) => [
      relativePath,
      readFileSync(path.join(ROOT, relativePath), "utf8"),
    ]),
  );
  checkPortableAdmissionDocs({ ledger, documents });
  process.stdout.write(
    `check-portable-admission-docs: ${documents.size} current references agree\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkWorkspace();
}
