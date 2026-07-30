#!/usr/bin/env node

import { globSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";
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
          updateTypes: [],
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

function dependencyPackageIdentity(name, declaration, location) {
  if (
    declaration !== null &&
    typeof declaration === "object" &&
    !Array.isArray(declaration) &&
    declaration.package !== undefined
  ) {
    if (
      typeof declaration.package !== "string" ||
      declaration.package.length === 0
    ) {
      reject(
        "E_FUZZ_DEPENDENCY_AUTHORITY",
        `${location}.package must name a Cargo package`,
      );
    }
    return declaration.package;
  }
  return name;
}

function directExternalDependencies(manifest, path) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      `${path} must be a Cargo manifest`,
    );
  }
  const external = [];
  const collect = (table, location) => {
    if (table === undefined) {
      return;
    }
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      reject(
        "E_FUZZ_DEPENDENCY_AUTHORITY",
        `${location} must be a dependency table`,
      );
    }
    for (const [name, declaration] of Object.entries(table)) {
      if (
        declaration === null ||
        typeof declaration !== "object" ||
        Array.isArray(declaration) ||
        typeof declaration.path !== "string"
      ) {
        external.push({
          dependencyName: name,
          packageName: dependencyPackageIdentity(
            name,
            declaration,
            `${location}.${name}`,
          ),
        });
      }
    }
  };
  const collectOwner = (owner, location) => {
    for (const kind of [
      "dependencies",
      "dev-dependencies",
      "build-dependencies",
    ]) {
      collect(owner?.[kind], `${location}#${kind}`);
    }
  };

  collectOwner(manifest, path);
  if (
    manifest.workspace !== undefined &&
    (manifest.workspace === null ||
      typeof manifest.workspace !== "object" ||
      Array.isArray(manifest.workspace))
  ) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      `${path}#workspace must be a table`,
    );
  }
  collect(
    manifest.workspace?.dependencies,
    `${path}#workspace.dependencies`,
  );
  if (
    manifest.target !== undefined &&
    (manifest.target === null ||
      typeof manifest.target !== "object" ||
      Array.isArray(manifest.target))
  ) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      `${path}#target must be a table`,
    );
  }
  for (const [selector, target] of Object.entries(manifest.target ?? {})) {
    if (target === null || typeof target !== "object" || Array.isArray(target)) {
      reject(
        "E_FUZZ_DEPENDENCY_AUTHORITY",
        `${path}#target.${selector} must be a table`,
      );
    }
    collectOwner(target, `${path}#target.${selector}`);
  }
  return external;
}

function validateFuzzDependencyAuthority(update, cargoManifests) {
  if (!(cargoManifests instanceof Map)) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      "dependency policy requires root and fuzz Cargo manifests",
    );
  }
  const rootDependencies = cargoManifests.get("Cargo.toml")?.workspace
    ?.dependencies;
  if (
    rootDependencies === null ||
    typeof rootDependencies !== "object" ||
    Array.isArray(rootDependencies)
  ) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      "Cargo.toml must declare workspace dependencies",
    );
  }
  const externalDependencies = directExternalDependencies(
    cargoManifests.get("fuzz/Cargo.toml"),
    "fuzz/Cargo.toml",
  );
  const allowed = [
    ...new Set(
      externalDependencies.map((dependency) => dependency.dependencyName),
    ),
  ].toSorted();
  const rootPackages = new Set(
    [...cargoManifests.entries()]
      .filter(([path]) => path !== "fuzz/Cargo.toml")
      .flatMap(([path, manifest]) =>
        directExternalDependencies(manifest, path).map(
          (dependency) => dependency.packageName,
        ),
      ),
  );
  const overlap = [
    ...new Set(
      externalDependencies
        .filter((dependency) => rootPackages.has(dependency.packageName))
        .map((dependency) =>
          dependency.dependencyName === dependency.packageName
            ? dependency.packageName
            : `${dependency.dependencyName} (${dependency.packageName})`,
        ),
    ),
  ].toSorted();
  if (overlap.length > 0) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      `fuzz/Cargo.toml duplicates root-owned dependencies: ${overlap.join(", ")}`,
    );
  }
  if (allowed.length === 0) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      "fuzz/Cargo.toml must retain a direct fuzz-runtime dependency",
    );
  }

  const observed =
    Array.isArray(update.allow) &&
    update.allow.every(
      (rule) =>
        rule !== null &&
        typeof rule === "object" &&
        !Array.isArray(rule) &&
        Object.keys(rule).length === 1 &&
        typeof rule["dependency-name"] === "string",
    )
      ? update.allow
          .map((rule) => rule["dependency-name"])
          .toSorted()
      : null;
  if (
    observed === null ||
    JSON.stringify(observed) !== JSON.stringify(allowed)
  ) {
    reject(
      "E_DEPENDABOT_ALLOW",
      `cargo at /fuzz must allow exactly: ${allowed.join(", ")}`,
    );
  }
}

function validateDependabot(dependabot, cargoManifests) {
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
    if (key === "cargo\u0000/fuzz") {
      validateFuzzDependencyAuthority(update, cargoManifests);
    } else if (update.allow !== undefined) {
      reject(
        "E_DEPENDABOT_ALLOW",
        `${ecosystem} at ${directory}: unexpected dependency allowlist`,
      );
    }
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

export function validateDependencyUpdatePolicy({
  cargoManifests,
  dependabot,
  workflows,
}) {
  if (!(workflows instanceof Map) || workflows.size === 0) {
    reject(
      "E_ACTION_PIN",
      "dependency policy requires at least one workflow to inspect",
    );
  }
  validateActionPins(workflows);
  validateDependabot(dependabot, cargoManifests);
}

function workspaceMemberManifestPaths(rootManifest, repositoryRoot) {
  const members = rootManifest?.workspace?.members;
  if (
    !Array.isArray(members) ||
    members.some((member) => typeof member !== "string" || member.length === 0)
  ) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      "Cargo.toml must declare string workspace member patterns",
    );
  }
  const excluded = rootManifest.workspace.exclude ?? [];
  if (
    !Array.isArray(excluded) ||
    excluded.some(
      (member) => typeof member !== "string" || member.length === 0,
    )
  ) {
    reject(
      "E_FUZZ_DEPENDENCY_AUTHORITY",
      "Cargo.toml workspace exclusions must be string patterns",
    );
  }
  const expand = (patterns) =>
    patterns.flatMap((pattern) =>
      globSync(`${pattern.replace(/\/$/u, "")}/Cargo.toml`, {
        cwd: repositoryRoot,
      }),
    );
  const excludedPaths = new Set(expand(excluded));
  return [
    ...new Set(expand(members).filter((path) => !excludedPaths.has(path))),
  ].toSorted();
}

export function repositoryCandidate() {
  const workflowDirectory = new URL(
    "../.github/workflows/",
    import.meta.url,
  );
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const rootManifest = parseToml(
    readFileSync(new URL("../Cargo.toml", import.meta.url), "utf8"),
  );
  const memberManifestPaths = workspaceMemberManifestPaths(
    rootManifest,
    repositoryRoot,
  );
  return {
    cargoManifests: new Map(
      [
        ["Cargo.toml", rootManifest],
        [
          "fuzz/Cargo.toml",
          parseToml(
            readFileSync(
              new URL("../fuzz/Cargo.toml", import.meta.url),
              "utf8",
            ),
          ),
        ],
        ...memberManifestPaths.map((path) => [
          path,
          parseToml(
            readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
          ),
        ]),
      ],
    ),
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
