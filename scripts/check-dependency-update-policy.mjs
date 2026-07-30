#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  isScalar,
  parse as parseYaml,
  parseDocument,
  visit,
} from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const FULL_SHA = /^[0-9a-f]{40}$/u;
const DOCKER_SHA256 = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u;
const EXPECTED_SOURCES = new Map([
  [
    "github-actions\u0000/",
    { group: "github-actions", manualRules: [] },
  ],
  ["cargo\u0000/", { group: "cargo", manualRules: [] }],
  [
    "cargo\u0000/editors/zed",
    { group: "zed-cargo", manualRules: [] },
  ],
  [
    "cargo\u0000/fuzz",
    { group: "fuzz-cargo", manualRules: [] },
  ],
  [
    "npm\u0000/",
    {
      group: "root-node",
      manualRules: [{ dependencyName: "typescript", updateTypes: [] }],
    },
  ],
  [
    "npm\u0000/editors/vscode",
    {
      group: "vscode",
      manualRules: [
        {
          dependencyName: "@types/node",
          updateTypes: ["version-update:semver-major"],
        },
        { dependencyName: "typescript", updateTypes: [] },
      ],
    },
  ],
]);

export class DependencyUpdatePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DependencyUpdatePolicyError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new DependencyUpdatePolicyError(code, message);
}

function sourceKey(update) {
  return `${String(update?.["package-ecosystem"])}\u0000${String(
    update?.directory,
  )}`;
}

function validateActionPins(workflows) {
  for (const [file, workflow] of workflows) {
    const document = parseDocument(workflow);
    if (document.errors.length > 0) {
      reject("E_WORKFLOW_YAML", `${file}: ${document.errors[0].message}`);
    }
    visit(document, {
      Pair(_, pair) {
        if (!isScalar(pair.key) || pair.key.value !== "uses") {
          return;
        }
        if (
          !isScalar(pair.value) ||
          typeof pair.value.value !== "string" ||
          pair.value.range === undefined
        ) {
          reject(
            "E_ACTION_PIN",
            `${file}: action references must be scalar strings`,
          );
        }
        const value = pair.value.value;
        if (value.startsWith("./")) {
          return;
        }
        const line =
          workflow.slice(0, pair.value.range[0]).split(/\r?\n/u).length;
        if (value.startsWith("docker://")) {
          if (!DOCKER_SHA256.test(value)) {
            reject(
              "E_DOCKER_ACTION_DIGEST",
              `${file}:${line}: Docker actions must use a sha256 image digest`,
            );
          }
        } else {
          const action = value.match(/^([^@\s]+)@([^\s]+)$/u);
          if (action === null || !FULL_SHA.test(action[2])) {
            reject(
              "E_ACTION_PIN",
              `${file}:${line}: third-party actions must use a full commit SHA`,
            );
          }
        }
        const trailingSource = workflow.slice(
          pair.value.range[1],
          pair.value.range[2],
        );
        if (!/^[\t ]+#[\t ]*\S/u.test(trailingSource)) {
          reject(
            "E_ACTION_RELEASE_COMMENT",
            `${file}:${line}: action pins must retain a release comment`,
          );
        }
      },
    });
  }
}

function validateUpdateGroup(update, expectedGroup, description) {
  if (update?.schedule?.interval !== "weekly") {
    reject(
      "E_DEPENDABOT_SCHEDULE",
      `${description}: update cadence must be weekly`,
    );
  }
  const groups =
    update?.groups !== null && typeof update?.groups === "object"
      ? Object.entries(update.groups)
      : [];
  if (
    groups.length !== 1 ||
    groups[0][0] !== expectedGroup ||
    Object.keys(groups[0][1] ?? {}).length !== 1 ||
    !Array.isArray(groups[0][1]?.patterns) ||
    groups[0][1].patterns.length !== 1 ||
    groups[0][1].patterns[0] !== "*"
  ) {
    reject(
      "E_DEPENDABOT_GROUP",
      `${description}: expected only the ${expectedGroup} wildcard group`,
    );
  }
}

function normalizeManualRule(rule, description) {
  if (
    rule === null ||
    typeof rule !== "object" ||
    typeof rule["dependency-name"] !== "string"
  ) {
    reject(
      "E_DEPENDABOT_MANUAL_DEPENDENCY",
      `${description}: manual dependency exclusions must name one dependency`,
    );
  }
  const updateTypes = rule["update-types"];
  const expectedKeys =
    updateTypes === undefined
      ? ["dependency-name"]
      : ["dependency-name", "update-types"];
  if (
    Object.keys(rule)
      .toSorted()
      .some((key, index) => key !== expectedKeys[index]) ||
    Object.keys(rule).length !== expectedKeys.length ||
    (updateTypes !== undefined &&
      (!Array.isArray(updateTypes) ||
        updateTypes.length === 0 ||
        updateTypes.some((updateType) => typeof updateType !== "string")))
  ) {
    reject(
      "E_DEPENDABOT_MANUAL_DEPENDENCY",
      `${description}: manual dependency exclusions must match the reviewed shape`,
    );
  }
  return {
    dependencyName: rule["dependency-name"],
    updateTypes: updateTypes?.toSorted() ?? [],
  };
}

function validateManualDependencies(update, expectedRules, description) {
  if (expectedRules.length === 0) {
    if (update.ignore !== undefined) {
      reject(
        "E_DEPENDABOT_MANUAL_DEPENDENCY",
        `${description}: unexpected manual dependency exclusions`,
      );
    }
    return;
  }
  if (
    !Array.isArray(update.ignore) ||
    update.ignore.length !== expectedRules.length
  ) {
    reject(
      "E_DEPENDABOT_MANUAL_DEPENDENCY",
      `${description}: reviewed manual dependency rules must remain exact`,
    );
  }
  const observed = update.ignore
    .map((rule) => normalizeManualRule(rule, description))
    .toSorted((left, right) =>
      left.dependencyName < right.dependencyName
        ? -1
        : Number(left.dependencyName > right.dependencyName),
    );
  if (JSON.stringify(observed) !== JSON.stringify(expectedRules)) {
    reject(
      "E_DEPENDABOT_MANUAL_DEPENDENCY",
      `${description}: reviewed manual dependency rules must remain exact`,
    );
  }
}

function validateDependabot(dependabot) {
  if (dependabot?.version !== 2) {
    reject(
      "E_DEPENDABOT_VERSION",
      "dependabot.yml must use schema version 2",
    );
  }
  if (!Array.isArray(dependabot.updates)) {
    reject(
      "E_DEPENDABOT_SOURCE",
      "dependabot.yml must declare the reviewed update sources",
    );
  }

  const observed = new Set();
  for (const update of dependabot.updates) {
    const key = sourceKey(update);
    const expected = EXPECTED_SOURCES.get(key);
    if (expected === undefined || observed.has(key)) {
      reject(
        "E_DEPENDABOT_SOURCE",
        "dependabot.yml contains an unexpected or duplicate update source",
      );
    }
    observed.add(key);
    const [ecosystem, directory] = key.split("\u0000");
    validateUpdateGroup(
      update,
      expected.group,
      `${ecosystem} at ${directory}`,
    );
    validateManualDependencies(
      update,
      expected.manualRules,
      `${ecosystem} at ${directory}`,
    );
  }

  if (
    observed.size !== EXPECTED_SOURCES.size ||
    [...EXPECTED_SOURCES.keys()].some((key) => !observed.has(key))
  ) {
    reject(
      "E_DEPENDABOT_SOURCE",
      "dependabot.yml is missing a reviewed update source",
    );
  }
}

export function validateDependencyUpdatePolicy({ dependabot, workflows }) {
  if (!(workflows instanceof Map) || workflows.size === 0) {
    reject(
      "E_ACTION_PIN",
      "dependency policy requires at least one workflow to inspect",
    );
  }
  validateActionPins(workflows);
  validateDependabot(dependabot);
}

function repositoryCandidate() {
  const workflowDirectory = new URL(
    "../.github/workflows/",
    import.meta.url,
  );
  return {
    dependabot: parseYaml(
      readFileSync(
        new URL("../.github/dependabot.yml", import.meta.url),
        "utf8",
      ),
    ),
    workflows: new Map(
      readdirSync(workflowDirectory)
        .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
        .map((entry) => [
          `.github/workflows/${entry}`,
          readFileSync(new URL(entry, workflowDirectory), "utf8"),
        ]),
    ),
  };
}

function main() {
  validateDependencyUpdatePolicy(repositoryCandidate());
  process.stdout.write("check-dependency-update-policy: policy satisfied\n");
}

if (process.argv[1] === scriptPath) {
  try {
    main();
  } catch (error) {
    if (error instanceof DependencyUpdatePolicyError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`E_DEPENDENCY_POLICY_IO: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
