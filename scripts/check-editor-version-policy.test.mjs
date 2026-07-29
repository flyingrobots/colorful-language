import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CHECK_COMMAND,
  EXPECTED_VERSION_SOURCES,
  deriveCompatibleLspRange,
  isCompatibleLspVersion,
  loadRepositorySnapshot,
  parseReleaseProfile,
  validateEditorVersionPolicy,
  validatedNpmLockVersion,
} from "./check-editor-version-policy.mjs";

const RELEASE_VERSION = "0.4.0";
const EDITOR_INSTALL_GUIDANCE = [
  "docs/topics/editor-integrations/README.md",
  "editors/README.md",
  "editors/vscode/README.md",
  "editors/vscode/package.json",
  "editors/zed/README.md",
  "editors/zed/src/lib.rs",
];
const EDITOR_COMPATIBILITY_GUIDANCE = [
  "docs/RELEASING.md",
  "docs/design/0006-editor-adapter-versioning.md",
  "docs/topics/editor-integrations/README.md",
  "docs/topics/editor-integrations/test-plan.md",
  "editors/README.md",
  "editors/vscode/README.md",
  "editors/zed/README.md",
];

function validSnapshot() {
  return {
    policy: {
      strategy: "synchronized",
      server: "colorful-lsp",
      compatibility: "same-pre-1.0-minor",
      prerelease: "unsupported",
      versionSources: structuredClone(EXPECTED_VERSION_SOURCES),
    },
    versions: Object.fromEntries(
      EXPECTED_VERSION_SOURCES.map(({ path }) => [path, RELEASE_VERSION]),
    ),
    gateSources: {
      ci: `- run: npm ci\n- run: ${CHECK_COMMAND}\n`,
      releasePrep: `npm ci\n${CHECK_COMMAND}\n`,
      release: `- run: npm ci\n- run: ${CHECK_COMMAND}\n`,
    },
  };
}

test("the synchronized policy derives the same pre-1.0 minor range", () => {
  assert.equal(deriveCompatibleLspRange("0.4.0"), ">=0.4.0 <0.5.0");
  assert.equal(deriveCompatibleLspRange("0.4.27"), ">=0.4.0 <0.5.0");
  assert.throws(
    () => deriveCompatibleLspRange("0.4.0-rc.1"),
    /stable SemVer/u,
  );
  assert.throws(() => deriveCompatibleLspRange("1.0.0"), /pre-1\.0/u);
});

test("same-minor stable servers are compatible and breaking minors are not", () => {
  assert.equal(isCompatibleLspVersion("0.4.0", "0.4.0"), true);
  assert.equal(isCompatibleLspVersion("0.4.9", "0.4.0"), true);
  assert.equal(isCompatibleLspVersion("0.4.0", "0.4.99"), true);
  assert.equal(isCompatibleLspVersion("0.4.0", "0.3.99"), false);
  assert.equal(isCompatibleLspVersion("0.4.0", "0.5.0"), false);
  assert.equal(isCompatibleLspVersion("0.4.0", "0.4.1-rc.1"), false);
});

test("rejects disagreement between both npm lockfile version fields", () => {
  assert.equal(
    validatedNpmLockVersion({
      version: RELEASE_VERSION,
      packages: { "": { version: RELEASE_VERSION } },
    }),
    RELEASE_VERSION,
  );
  assert.throws(
    () =>
      validatedNpmLockVersion({
        version: "0.4.1",
        packages: { "": { version: RELEASE_VERSION } },
      }),
    /package-lock\.json versions disagree/u,
  );
  assert.throws(
    () =>
      validatedNpmLockVersion({
        packages: { "": { version: RELEASE_VERSION } },
      }),
    /package-lock\.json has no top-level version/u,
  );
  assert.throws(
    () => validatedNpmLockVersion({ version: RELEASE_VERSION, packages: {} }),
    /package-lock\.json has no root package version/u,
  );
});

test("accepts the complete synchronized manifest and gate inventory", () => {
  assert.deepEqual(validateEditorVersionPolicy(validSnapshot()), {
    releaseVersion: RELEASE_VERSION,
    compatibleLsp: ">=0.4.0 <0.5.0",
    versionSourceCount: EXPECTED_VERSION_SOURCES.length,
  });
});

test("derives a future synchronized minor without a policy-code edit", () => {
  const snapshot = validSnapshot();
  for (const source of EXPECTED_VERSION_SOURCES) {
    snapshot.versions[source.path] = "0.5.0";
  }
  assert.deepEqual(validateEditorVersionPolicy(snapshot), {
    releaseVersion: "0.5.0",
    compatibleLsp: ">=0.5.0 <0.6.0",
    versionSourceCount: EXPECTED_VERSION_SOURCES.length,
  });
});

test("editor install guidance separates source and publication authority", () => {
  const command = "cargo install --path crates/colorful-lsp --locked";
  const publicationIssue =
    "https://github.com/flyingrobots/colorful-language/issues/154";
  const immutablePackageReadmes = new Set([
    "editors/vscode/README.md",
    "editors/zed/README.md",
  ]);
  for (const path of EDITOR_INSTALL_GUIDANCE.filter((path) =>
    path.endsWith("README.md"),
  )) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const linkTargets = [...source.matchAll(/\]\((https:\/\/[^)\s]+)\)/gu)].map(
      (match) => match[1],
    );
    assert.ok(source.includes(command), `${path} must include ${command}`);
    if (immutablePackageReadmes.has(path)) {
      assert.ok(source.includes("matching tag"), `${path} must bind releases`);
      assert.ok(
        source.includes("that exact target and version"),
        `${path} must require an exact public asset`,
      );
      assert.ok(
        !source.includes("not yet published"),
        `${path} must remain true inside an immutable published package`,
      );
    } else {
      assert.ok(
        linkTargets.some((target) => target === publicationIssue),
        `${path} must defer current publication status to issue #154`,
      );
    }
  }

  for (const path of EDITOR_INSTALL_GUIDANCE) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.ok(
      !source.includes("cargo install colorful-lsp --version"),
      `${path} must not claim the unreleased registry version is installable`,
    );
  }

  const zedSource = readFileSync(
    new URL("../editors/zed/src/lib.rs", import.meta.url),
    "utf8",
  );
  assert.ok(
    zedSource.includes(
      "cargo install --path /path/to/colorful-language/crates/colorful-lsp --locked",
    ),
    "the Zed missing-server error must select a same-checkout source path",
  );
});

test("editor references use the executable compatibility range notation", () => {
  const range = ">=0.Y.0 <0.(Y+1).0";
  for (const path of EDITOR_COMPATIBILITY_GUIDANCE) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.ok(source.includes(range), `${path} must include ${range}`);
  }
});

test("treats the workspace manifest as the synchronized version authority", () => {
  const snapshot = validSnapshot();
  snapshot.versions["Cargo.toml"] = "0.4.1";
  assert.throws(
    () => validateEditorVersionPolicy(snapshot),
    /Cargo\.lock has 0\.4\.0; expected 0\.4\.1/u,
  );
});

for (const source of EXPECTED_VERSION_SOURCES.slice(1)) {
  test(`rejects drift in ${source.path}`, () => {
    const snapshot = validSnapshot();
    snapshot.versions[source.path] = "0.4.1";
    assert.throws(
      () => validateEditorVersionPolicy(snapshot),
      new RegExp(
        `${source.path.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")} has 0\\.4\\.1; expected 0\\.4\\.0`,
        "u",
      ),
    );
  });
}

test("rejects prerelease versions in every synchronized source", () => {
  for (const source of EXPECTED_VERSION_SOURCES) {
    const snapshot = validSnapshot();
    snapshot.versions[source.path] = "0.4.0-rc.1";
    assert.throws(
      () => validateEditorVersionPolicy(snapshot),
      new RegExp(
        `${source.path.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")} must be stable SemVer`,
        "u",
      ),
    );
  }
});

test("rejects an independent adapter strategy", () => {
  const snapshot = validSnapshot();
  snapshot.policy.strategy = "independent";
  assert.throws(
    () => validateEditorVersionPolicy(snapshot),
    /editor adapter strategy must be synchronized/u,
  );
});

test("rejects compatibility and prerelease policy drift", () => {
  const compatibility = validSnapshot();
  compatibility.policy.compatibility = "any-newer";
  assert.throws(
    () => validateEditorVersionPolicy(compatibility),
    /LSP compatibility must be same-pre-1\.0-minor/u,
  );

  const prerelease = validSnapshot();
  prerelease.policy.prerelease = "rc";
  assert.throws(
    () => validateEditorVersionPolicy(prerelease),
    /editor prerelease policy must be unsupported/u,
  );
});

test("rejects missing, duplicated, unexpected, or reordered version sources", () => {
  const missing = validSnapshot();
  missing.policy.versionSources.pop();
  assert.throws(
    () => validateEditorVersionPolicy(missing),
    /version sources differ from the reviewed synchronized inventory/u,
  );

  const duplicated = validSnapshot();
  duplicated.policy.versionSources.push(
    structuredClone(EXPECTED_VERSION_SOURCES[0]),
  );
  assert.throws(
    () => validateEditorVersionPolicy(duplicated),
    /version sources differ from the reviewed synchronized inventory/u,
  );

  const unexpected = validSnapshot();
  unexpected.policy.versionSources[0].path = "editors/other/package.json";
  assert.throws(
    () => validateEditorVersionPolicy(unexpected),
    /version sources differ from the reviewed synchronized inventory/u,
  );

  const reordered = validSnapshot();
  reordered.policy.versionSources.reverse();
  assert.throws(
    () => validateEditorVersionPolicy(reordered),
    /version sources differ from the reviewed synchronized inventory/u,
  );
});

test("accepts version-source mappings with reordered fields", () => {
  const snapshot = validSnapshot();
  snapshot.policy.versionSources = snapshot.policy.versionSources.map(
    ({ path, type, field, required }) => ({ required, field, type, path }),
  );

  assert.doesNotThrow(() => validateEditorVersionPolicy(snapshot));
});

test("parses release policy independently of YAML layout", () => {
  const policy = parseReleaseProfile(`
version_sources:
    - required: true
      field: workspace.package.version
      type: cargo-workspace
      path: Cargo.toml
versioning:
  editor_adapters:
      prerelease: unsupported
      compatibility: same-pre-1.0-minor
      server: colorful-lsp
      strategy: synchronized
`);

  assert.deepEqual(policy, {
    strategy: "synchronized",
    server: "colorful-lsp",
    compatibility: "same-pre-1.0-minor",
    prerelease: "unsupported",
    versionSources: [
      {
        required: true,
        field: "workspace.package.version",
        type: "cargo-workspace",
        path: "Cargo.toml",
      },
    ],
  });
});

test("rejects missing policy wiring in every release gate", () => {
  for (const gate of ["ci", "releasePrep", "release"]) {
    const snapshot = validSnapshot();
    snapshot.gateSources[gate] = "";
    assert.throws(
      () => validateEditorVersionPolicy(snapshot),
      new RegExp(`${gate} must run ${CHECK_COMMAND}`, "u"),
    );
  }
});

test("requires policy dependencies before the checker in every release gate", () => {
  for (const gate of ["ci", "releasePrep", "release"]) {
    const snapshot = validSnapshot();
    snapshot.gateSources[gate] = `${CHECK_COMMAND}\nnpm ci\n`;
    assert.throws(
      () => validateEditorVersionPolicy(snapshot),
      new RegExp(`${gate} must run npm ci before ${CHECK_COMMAND}`, "u"),
    );
  }
});

test("the checked-in repository satisfies the policy", () => {
  const snapshot = loadRepositorySnapshot();
  const releaseVersion = snapshot.versions["Cargo.toml"];
  assert.deepEqual(
    validateEditorVersionPolicy(snapshot),
    {
      releaseVersion,
      compatibleLsp: deriveCompatibleLspRange(releaseVersion),
      versionSourceCount: EXPECTED_VERSION_SOURCES.length,
    },
  );
});
