#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const FULL_SHA = /^[0-9a-f]{40}$/u;
const EXPECTED_SOURCES = new Map([
  ["github-actions\u0000/", "github-actions"],
  ["cargo\u0000/", "cargo"],
  ["npm\u0000/", "root-node"],
  ["npm\u0000/editors/vscode", "vscode"],
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
    for (const [index, line] of workflow.split(/\r?\n/u).entries()) {
      const value = line.match(
        /^\s*(?:-\s+)?uses:\s+(.+?)\s*$/u,
      )?.[1];
      if (
        value === undefined ||
        value.startsWith("./") ||
        value.startsWith("docker://")
      ) {
        continue;
      }
      const action = value.match(
        /^([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S.*))?$/u,
      );
      if (action === null || !FULL_SHA.test(action[2])) {
        reject(
          "E_ACTION_PIN",
          `${file}:${index + 1}: third-party actions must use a full commit SHA`,
        );
      }
      if (action[3] === undefined) {
        reject(
          "E_ACTION_RELEASE_COMMENT",
          `${file}:${index + 1}: action pins must retain a release comment`,
        );
      }
    }
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
    const expectedGroup = EXPECTED_SOURCES.get(key);
    if (expectedGroup === undefined || observed.has(key)) {
      reject(
        "E_DEPENDABOT_SOURCE",
        "dependabot.yml contains an unexpected or duplicate update source",
      );
    }
    observed.add(key);
    const [ecosystem, directory] = key.split("\u0000");
    validateUpdateGroup(
      update,
      expectedGroup,
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
