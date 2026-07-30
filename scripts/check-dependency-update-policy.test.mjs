#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import {
  DependencyUpdatePolicyError,
  repositoryCandidate,
  validateDependencyUpdatePolicy,
} from "./check-dependency-update-policy.mjs";

const ACTION_SHA = "1111111111111111111111111111111111111111";
const UPDATED_ACTION_SHA = "2222222222222222222222222222222222222222";
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
    ignore:
      - dependency-name: dashmap
        update-types:
          - version-update:semver-major
    groups:
      cargo:
        patterns:
          - "*"
        update-types:
          - patch
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
    allow:
      - dependency-name: libfuzzer-sys
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
    groups:
      vscode:
        patterns:
          - "*"
`),
    cargoManifests: new Map([
      [
        "Cargo.toml",
        parseToml(`
[workspace.dependencies]
tower-lsp = "0.20"
dashmap = "5.5.3"
`),
      ],
      [
        "fuzz/Cargo.toml",
        parseToml(`
[dependencies]
colorful-lsp = { path = "../crates/colorful-lsp" }
libfuzzer-sys = "=0.4.13"
`),
      ],
    ]),
    workflows: new Map([
      [
        ".github/workflows/ci.yml",
        `steps:
  - uses: actions/checkout@${ACTION_SHA} # v5
  - uses: docker://alpine@sha256:${IMAGE_DIGEST} # alpine 3.22
`,
      ],
      [
        ".github/workflows/release.yml",
        `steps:
  - uses: actions/checkout@${ACTION_SHA} # v5
`,
      ],
      [
        ".github/workflows/security.yml",
        `steps:
  - uses: github/codeql-action/init@${ACTION_SHA} # v4
  - uses: github/codeql-action/analyze@${ACTION_SHA} # v4
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

function rootCargoUpdate(dependabot) {
  return dependabot.updates.find(
    (update) =>
      update["package-ecosystem"] === "cargo" && update.directory === "/",
  );
}

function replaceCheckoutPin(workflow, sha, release) {
  return workflow.replace(
    /actions\/checkout@[0-9a-f]{40} # \S+/u,
    `actions/checkout@${sha} # ${release}`,
  );
}

test("accepts the reviewed update-source and action-pin policy", () => {
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(fixture()));
});

test("accepts a coordinated action pin refresh", () => {
  const candidate = fixture();
  for (const [file, workflow] of candidate.workflows) {
    candidate.workflows.set(
      file,
      replaceCheckoutPin(workflow, UPDATED_ACTION_SHA, "v7.0.1"),
    );
  }
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(candidate));
});

test("rejects an inconsistent action pin refresh", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      replaceCheckoutPin(
        workflows.get(".github/workflows/ci.yml"),
        UPDATED_ACTION_SHA,
        "v7.0.1",
      ),
    );
  }, "E_ACTION_PIN_CONSISTENCY");
});

test("rejects inconsistent action release comments", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      replaceCheckoutPin(
        workflows.get(".github/workflows/ci.yml"),
        ACTION_SHA,
        "v5.0.0",
      ),
    );
  }, "E_ACTION_PIN_CONSISTENCY");
});

test("rejects a partial update across sibling repository actions", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/security.yml",
      workflows
        .get(".github/workflows/security.yml")
        .replace(
          `github/codeql-action/init@${ACTION_SHA} # v4`,
          `github/codeql-action/init@${UPDATED_ACTION_SHA} # v5`,
        ),
    );
  }, "E_ACTION_PIN_CONSISTENCY");
});

test("rejects inconsistent pins across repository identity casing", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      replaceCheckoutPin(
        workflows.get(".github/workflows/ci.yml"),
        UPDATED_ACTION_SHA,
        "v7.0.1",
      ).replace("actions/checkout@", "Actions/Checkout@"),
    );
  }, "E_ACTION_PIN_CONSISTENCY");
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

test("accepts the reviewed root Cargo compatibility policy", () => {
  assert.doesNotThrow(() => validateDependencyUpdatePolicy(fixture()));
});

test("rejects a root Cargo group without patch isolation", () => {
  expectCode(({ dependabot }) => {
    delete rootCargoUpdate(dependabot).groups.cargo["update-types"];
  }, "E_DEPENDABOT_GROUP");
});

test("rejects a broadened root Cargo update group", () => {
  expectCode(({ dependabot }) => {
    rootCargoUpdate(dependabot).groups.cargo["update-types"].push("minor");
  }, "E_DEPENDABOT_GROUP");
});

test("rejects scalar root Cargo group update types", () => {
  expectCode(({ dependabot }) => {
    rootCargoUpdate(dependabot).groups.cargo["update-types"] = "patch";
  }, "E_DEPENDABOT_GROUP");
});

test("rejects removal of the DashMap major exclusion", () => {
  expectCode(({ dependabot }) => {
    delete rootCargoUpdate(dependabot).ignore;
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects a broadened DashMap exclusion", () => {
  expectCode(({ dependabot }) => {
    delete rootCargoUpdate(dependabot).ignore[0]["update-types"];
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects a substituted root Cargo compatibility exclusion", () => {
  expectCode(({ dependabot }) => {
    rootCargoUpdate(dependabot).ignore[0]["dependency-name"] = "tower-lsp";
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects scalar DashMap compatibility update types", () => {
  expectCode(({ dependabot }) => {
    rootCargoUpdate(dependabot).ignore[0]["update-types"] =
      "version-update:semver-major";
  }, "E_DEPENDABOT_MANUAL_DEPENDENCY");
});

test("rejects a stale tower-lsp compatibility policy", () => {
  expectCode(({ cargoManifests }) => {
    cargoManifests.get("Cargo.toml").workspace.dependencies["tower-lsp"] =
      "0.21";
  }, "E_ROOT_CARGO_COMPATIBILITY");
});

test("rejects a stale DashMap compatibility policy", () => {
  expectCode(({ cargoManifests }) => {
    cargoManifests.get("Cargo.toml").workspace.dependencies.dashmap = "6.2.1";
  }, "E_ROOT_CARGO_COMPATIBILITY");
});

test("rejects a fuzz source without its direct-runtime allowlist", () => {
  expectCode(({ dependabot }) => {
    delete dependabot.updates.find(
      (update) =>
        update["package-ecosystem"] === "cargo" &&
        update.directory === "/fuzz",
    ).allow;
  }, "E_DEPENDABOT_ALLOW");
});

test("rejects a broadened fuzz dependency allowlist", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates
      .find(
        (update) =>
          update["package-ecosystem"] === "cargo" &&
          update.directory === "/fuzz",
      )
      .allow.push({ "dependency-name": "*" });
  }, "E_DEPENDABOT_ALLOW");
});

test("rejects a substituted fuzz dependency allowlist", () => {
  expectCode(({ dependabot }) => {
    dependabot.updates.find(
      (update) =>
        update["package-ecosystem"] === "cargo" &&
        update.directory === "/fuzz",
    ).allow[0]["dependency-name"] = "tower-lsp";
  }, "E_DEPENDABOT_ALLOW");
});

test("rejects an allowlist on the root Cargo update source", () => {
  expectCode(({ dependabot }) => {
    rootCargoUpdate(dependabot).allow = [{ "dependency-name": "tower-lsp" }];
  }, "E_DEPENDABOT_ALLOW");
});

test("rejects a fuzz manifest without a direct runtime dependency", () => {
  expectCode(({ cargoManifests }) => {
    delete cargoManifests.get("fuzz/Cargo.toml").dependencies[
      "libfuzzer-sys"
    ];
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
});

test("rejects a root-owned dependency in the standalone fuzz manifest", () => {
  expectCode(({ cargoManifests }) => {
    cargoManifests.get("fuzz/Cargo.toml").dependencies["tower-lsp"] = "0.20";
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
});

test("rejects a root-member dependency in the fuzz manifest", () => {
  expectCode(({ cargoManifests, dependabot }) => {
    cargoManifests.set(
      "crates/member/Cargo.toml",
      parseToml(`
[dependencies]
member-only = "1"
`),
    );
    cargoManifests.get("fuzz/Cargo.toml").dependencies["member-only"] = "1";
    dependabot.updates
      .find(
        (update) =>
          update["package-ecosystem"] === "cargo" &&
          update.directory === "/fuzz",
      )
      .allow.push({ "dependency-name": "member-only" });
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
});

test("rejects a renamed root-owned dependency in the fuzz manifest", () => {
  expectCode(({ cargoManifests, dependabot }) => {
    cargoManifests.get("fuzz/Cargo.toml").dependencies["lsp-alias"] = {
      package: "tower-lsp",
      version: "0.20",
    };
    dependabot.updates
      .find(
        (update) =>
          update["package-ecosystem"] === "cargo" &&
          update.directory === "/fuzz",
      )
      .allow.push({ "dependency-name": "lsp-alias" });
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
});

test("rejects a root-owned standalone fuzz dev dependency", () => {
  expectCode(({ cargoManifests }) => {
    cargoManifests.get("fuzz/Cargo.toml")["dev-dependencies"] = {
      "tower-lsp": "0.20",
    };
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
});

test("rejects a root-owned fuzz workspace dependency", () => {
  expectCode(({ cargoManifests }) => {
    cargoManifests.get("fuzz/Cargo.toml").workspace = {
      dependencies: {
        "tower-lsp": "0.20",
      },
    };
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
});

test("rejects a root-owned target-specific fuzz dependency", () => {
  expectCode(({ cargoManifests }) => {
    cargoManifests.get("fuzz/Cargo.toml").target = {
      'cfg(target_family = "unix")': {
        dependencies: {
          "tower-lsp": "0.20",
        },
      },
    };
  }, "E_FUZZ_DEPENDENCY_AUTHORITY");
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

test("rejects empty action path segments", () => {
  expectCode(({ workflows }) => {
    workflows.set(
      ".github/workflows/ci.yml",
      `steps:\n  - uses: actions/checkout//setup@${ACTION_SHA} # v5\n`,
    );
  }, "E_ACTION_PIN");
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

test("rejects automatic VS Code Node declaration updates", () => {
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

test("rejects a partial VS Code Node declaration exclusion", () => {
  expectCode(({ dependabot }) => {
    const update = dependabot.updates.find(
      (candidate) =>
        candidate["package-ecosystem"] === "npm" &&
        candidate.directory === "/editors/vscode",
    );
    update.ignore.find(
      (rule) => rule["dependency-name"] === "@types/node",
    )["update-types"] = ["version-update:semver-major"];
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

test("the current dependency update table documents every group", () => {
  const documentation = readFileSync(
    "docs/workflows/evidence-toolchains/README.md",
    "utf8",
  );
  for (const group of [
    "github-actions",
    "cargo",
    "zed-cargo",
    "fuzz-cargo",
    "root-node",
    "vscode",
  ]) {
    assert.match(
      documentation,
      new RegExp(`^\\| \`${group}\` \\|`, "mu"),
      `dependency update table must document ${group}`,
    );
  }
});

test("current pin references distinguish action commits from Docker digests", () => {
  for (const file of [
    "docs/workflows/evidence-toolchains/README.md",
    "docs/workflows/repository-maintenance/README.md",
  ]) {
    const documentation = readFileSync(file, "utf8");
    assert.match(
      documentation,
      /Non-Docker third-party actions use full 40-character commit SHA references/u,
      `${file} must state the GitHub Action commit-pin rule`,
    );
    assert.match(
      documentation,
      /`docker:\/\/` actions use full `sha256` image digest references/u,
      `${file} must state the Docker digest-pin rule`,
    );
  }
});

test("the action update reference runs the complete release gate", () => {
  const documentation = readFileSync(
    "docs/workflows/evidence-toolchains/README.md",
    "utf8",
  );
  const start = documentation.indexOf(
    "Run the pin and semantic policy together before accepting an action update:",
  );
  const end = documentation.indexOf("The root `cargo` group", start);
  assert.notEqual(start, -1, "action-update gate introduction must exist");
  assert.notEqual(end, -1, "action-update gate boundary must exist");
  assert.match(
    documentation.slice(start, end),
    /```bash\nbash scripts\/release-prep\.sh\n```/u,
    "action updates must run the complete release-preparation gate",
  );
});
