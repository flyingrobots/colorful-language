#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import {
  DependencyUpdatePolicyError,
  validateDependencyUpdatePolicy,
} from "./check-dependency-update-policy.mjs";

const ACTION_SHA = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const IMAGE_DIGEST =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function fixture() {
  return {
    dependabot: parseYaml(`
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      github-actions:
        patterns:
          - "*"
  - package-ecosystem: cargo
    directory: /
    schedule:
      interval: weekly
    groups:
      cargo:
        patterns:
          - "*"
  - package-ecosystem: cargo
    directory: /editors/zed
    schedule:
      interval: weekly
    groups:
      zed-cargo:
        patterns:
          - "*"
  - package-ecosystem: cargo
    directory: /fuzz
    schedule:
      interval: weekly
    groups:
      fuzz-cargo:
        patterns:
          - "*"
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    ignore:
      - dependency-name: typescript
    groups:
      root-node:
        patterns:
          - "*"
  - package-ecosystem: npm
    directory: /editors/vscode
    schedule:
      interval: weekly
    ignore:
      - dependency-name: typescript
      - dependency-name: "@types/node"
        update-types:
          - version-update:semver-major
    groups:
      vscode:
        patterns:
          - "*"
`),
    workflows: new Map([
      [
        ".github/workflows/ci.yml",
        `steps:
  - uses: actions/checkout@${ACTION_SHA} # v5
  - uses: docker://alpine@sha256:${IMAGE_DIGEST} # alpine 3.22
`,
      ],
    ]),
  };
}

function expectCode(mutate, code) {
  const candidate = fixture();
  mutate(candidate);
  assert.throws(
    () => validateDependencyUpdatePolicy(candidate),
    (error) =>
      error instanceof DependencyUpdatePolicyError && error.code === code,
  );
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
        .filter((entry) => entry.endsWith(".yml"))
        .map((entry) => [
          `.github/workflows/${entry}`,
          readFileSync(new URL(entry, workflowDirectory), "utf8"),
        ]),
    ),
  };
}

test("accepts the reviewed update-source and action-pin policy", () => {
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(fixture()));
});

test("accepts update sources in any order", () => {
  const candidate = fixture();
  candidate.dependabot.updates.reverse();
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(candidate));
});

test("accepts reviewed manual dependency rules in any order", () => {
  const candidate = fixture();
  candidate.dependabot.updates
    .find(
      (update) =>
        update["package-ecosystem"] === "npm" &&
        update.directory === "/editors/vscode",
    )
    .ignore.reverse();
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(candidate));
});

test("accepts a reviewed standalone fuzz Cargo update source", () => {
  const candidate = fixture();
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(candidate));
});

test("rejects a floating third-party action reference", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      "steps:\n  - uses: actions/checkout@v5 # v5\n",
    );
  }, "E_ACTION_PIN");
});

test("rejects an action pin without its release comment", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      `steps:\n  - uses: actions/checkout@${ACTION_SHA}\n`,
    );
  }, "E_ACTION_RELEASE_COMMENT");
});

test("rejects a floating action behind a spaced YAML key", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      "steps:\n  - uses : actions/checkout@v5 # v5\n",
    );
  }, "E_ACTION_PIN");
});

test("rejects a missing comment behind a quoted YAML key", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      `steps:\n  - "uses": actions/checkout@${ACTION_SHA}\n`,
    );
  }, "E_ACTION_RELEASE_COMMENT");
});

test("rejects a mutable Docker action tag", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      "steps:\n  - uses: docker://alpine:latest # alpine latest\n",
    );
  }, "E_DOCKER_ACTION_DIGEST");
});

test("rejects a Docker action digest without its version comment", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      `steps:\n  - uses: docker://alpine@sha256:${IMAGE_DIGEST}\n`,
    );
  }, "E_ACTION_RELEASE_COMMENT");
});

test("rejects an unsupported Dependabot schema version", () => {
  expectCode(({ dependabot }) => {
    dependabot.version = 3;
  }, "E_DEPENDABOT_VERSION");
});

test("rejects a missing update source", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates.pop();
  }, "E_DEPENDABOT_SOURCE");
});

test("rejects omission of the standalone Zed Cargo workspace", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates = dependabot.updates.filter(
      (update) =>
        !(
          update["package-ecosystem"] === "cargo" &&
          update.directory === "/editors/zed"
        ),
    );
  }, "E_DEPENDABOT_SOURCE");
});

test("rejects omission of the standalone fuzz Cargo workspace", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates = dependabot.updates.filter(
      (update) =>
        !(
          update["package-ecosystem"] === "cargo" &&
          update.directory === "/fuzz"
        ),
    );
  }, "E_DEPENDABOT_SOURCE");
});

test("rejects an unexpected update source", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates.push({
      "package-ecosystem": "pip",
      directory: "/",
      schedule: { interval: "weekly" },
      groups: { python: { patterns: ["*"] } },
    });
  }, "E_DEPENDABOT_SOURCE");
});

test("rejects a duplicate update source", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates.push(structuredClone(dependabot.updates[0]));
  }, "E_DEPENDABOT_SOURCE");
});

test("rejects a non-weekly update cadence", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates[0].schedule.interval = "daily";
  }, "E_DEPENDABOT_SCHEDULE");
});

test("rejects a renamed dependency group", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates[0].groups = {
      actions: dependabot.updates[0].groups["github-actions"],
    };
  }, "E_DEPENDABOT_GROUP");
});

test("rejects more than one group for an update source", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates[0].groups.extra = { patterns: ["*"] };
  }, "E_DEPENDABOT_GROUP");
});

test("rejects a partial dependency group pattern", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates[0].groups["github-actions"].patterns = ["actions/*"];
  }, "E_DEPENDABOT_GROUP");
});

test("rejects automatic root TypeScript updates", () => {
  expectCode(({ dependabot }) => {
    delete dependabot.updates.find(
      (update) =>
        update["package-ecosystem"] === "npm" && update.directory === "/",
    ).ignore;
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects automatic VS Code TypeScript updates", () => {
  expectCode(({ dependabot }) => {
    delete dependabot.updates.find(
      (update) =>
        update["package-ecosystem"] === "npm" &&
        update.directory === "/editors/vscode",
    ).ignore;
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects automatic VS Code Node declaration major updates", () => {
  expectCode(({ dependabot }) => {
    const update = dependabot.updates.find(
      (candidate) =>
        candidate["package-ecosystem"] === "npm" &&
        candidate.directory === "/editors/vscode",
    );
    update.ignore = update.ignore.filter(
      (rule) => rule["dependency-name"] !== "@types/node",
    );
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects an overbroad VS Code Node declaration exclusion", () => {
  expectCode(({ dependabot }) => {
    const update = dependabot.updates.find(
      (candidate) =>
        candidate["package-ecosystem"] === "npm" &&
        candidate.directory === "/editors/vscode",
    );
    delete update.ignore.find(
      (rule) => rule["dependency-name"] === "@types/node",
    )["update-types"];
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects a scalar VS Code Node update-type policy", () => {
  expectCode(({ dependabot }) => {
    const update = dependabot.updates.find(
      (candidate) =>
        candidate["package-ecosystem"] === "npm" &&
        candidate.directory === "/editors/vscode",
    );
    update.ignore.find(
      (rule) => rule["dependency-name"] === "@types/node",
    )["update-types"] = "version-update:semver-major";
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("the checked-in update and workflow policy passes", () => {
  assert.doesNotThrow(() =>
    validateDependencyUpdatePolicy(repositoryCandidate()),
  );
});
