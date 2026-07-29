import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHECK_COMMAND,
  EXPECTED_EDITOR_POLICY,
  EXPECTED_OWNER,
  EXPECTED_PLATFORMS,
  EXPECTED_PROVENANCE,
  EXPECTED_PUBLISHER_TOOLS,
  loadRepositorySnapshot,
  validateReleaseDistribution,
} from "./check-release-distribution.mjs";

const ACTION_SHA = "a".repeat(40);

function validSnapshot() {
  const smokeVsix =
    'version="${GITHUB_REF_NAME#v}"\n' +
    'vsix="target/editor-smoke/colorful-language-${version}.vsix"\n';
  return {
    policy: {
      owner: EXPECTED_OWNER,
      provenance: EXPECTED_PROVENANCE,
      binaries: structuredClone(EXPECTED_PLATFORMS),
      editors: structuredClone(EXPECTED_EDITOR_POLICY),
    },
    publisherTools: structuredClone(EXPECTED_PUBLISHER_TOOLS),
    repositoryLicense: "license\n",
    zedLicense: "license\n",
    workflow: {
      jobs: {
        "binary-artifacts": {
          permissions: {
            contents: "read",
            "id-token": "write",
            attestations: "write",
          },
          strategy: {
            matrix: { include: structuredClone(EXPECTED_PLATFORMS) },
          },
          steps: [
            {
              name: "Package native binaries",
              run:
                "cp colorful colorful-lsp README.md LICENSE NOTICE CHANGELOG.md dist/\n" +
                'tar -czf "dist/archive.tar.gz" dist\n' +
                'sha256sum "dist/archive.tar.gz" > "dist/archive.tar.gz.sha256"\n',
            },
            {
              name: "Attest native archive",
              uses: `actions/attest@${ACTION_SHA}`,
              with: { "subject-path": "dist/*.tar.gz" },
            },
            {
              name: "Upload native archive",
              uses: `actions/upload-artifact@${ACTION_SHA}`,
              with: {
                name: "release-binaries-${{ matrix.target }}",
                path: "dist/*.tar.gz\ndist/*.sha256",
              },
            },
          ],
        },
        release: {
          needs: "binary-artifacts",
          permissions: {
            contents: "write",
            "id-token": "write",
            attestations: "write",
          },
          steps: [
            {
              name: "Check release distribution policy",
              run: CHECK_COMMAND,
            },
            {
              name: "Download native archives",
              uses: `actions/download-artifact@${ACTION_SHA}`,
              with: {
                pattern: "release-binaries-*",
                "merge-multiple": true,
              },
            },
            {
              name: "Verify editor publisher credentials",
              env: {
                VSCE_PAT: "${{ secrets.VSCE_PAT }}",
                OVSX_PAT: "${{ secrets.OVSX_PAT }}",
              },
              run:
                "npm --prefix editors/vscode exec -- vsce verify-pat flyingrobots\n" +
                "npm --prefix editors/vscode exec -- ovsx verify-pat flyingrobots\n",
            },
            { name: "Publish to crates.io", run: "cargo publish" },
            {
              name: "Build and smoke editor packages",
              run:
                "npm --prefix editors/vscode run smoke:package\n" +
                "tar -czf dist/colorful-zed-source.tar.gz " +
                "target/editor-smoke/zed-source\n",
            },
            {
              name: "Attest editor artifacts",
              uses: `actions/attest@${ACTION_SHA}`,
              with: {
                "subject-path":
                  "target/editor-smoke/*.vsix\ndist/*zed-source.tar.gz",
              },
            },
            {
              name: "Publish editor extension",
              run:
                smokeVsix +
                'npm --prefix editors/vscode exec -- vsce publish --packagePath "$vsix" --skip-duplicate\n' +
                'npm --prefix editors/vscode exec -- ovsx publish --packagePath "$vsix" --skip-duplicate\n',
            },
            {
              name: "Create GitHub Release",
              run: "gh release create \"$GITHUB_REF_NAME\" dist/*",
            },
          ],
        },
      },
    },
    gates: {
      ci: `- run: ${CHECK_COMMAND}\n`,
      releasePrep: `${CHECK_COMMAND}\n`,
      release: `- run: ${CHECK_COMMAND}\n`,
    },
    documentation: {
      runbook: [
        "Publication and rollback owner: `@flyingrobots`",
        "gh attestation verify",
        "vsce show",
        "ovsx get",
        "zed-industries/extensions",
        "Do not move the tag",
        "observational",
      ].join("\n"),
      topic:
        "installation-to-first-highlight is observational and not a correctness threshold",
    },
  };
}

test("accepts the complete native and editor distribution contract", () => {
  assert.deepEqual(validateReleaseDistribution(validSnapshot()), {
    owner: EXPECTED_OWNER,
    platformCount: 3,
    editorRegistryCount: 3,
  });
});

test("rejects every platform inventory mutation", () => {
  for (const mutate of [
    (platforms) => platforms.pop(),
    (platforms) => platforms.push(structuredClone(platforms[0])),
    (platforms) => platforms.reverse(),
    (platforms) => {
      platforms[0].runner = "ubuntu-latest";
    },
    (platforms) => {
      platforms[1].target = "x86_64-apple-darwin";
    },
  ]) {
    const snapshot = validSnapshot();
    mutate(snapshot.policy.binaries);
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /reviewed platform list/u,
    );
  }
});

test("rejects workflow matrix drift independently of the profile", () => {
  const snapshot = validSnapshot();
  snapshot.workflow.jobs["binary-artifacts"].strategy.matrix.include[2].runner =
    "windows-latest";
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /matrix differs from the reviewed platform list/u,
  );
});

test("requires signed checksummed native archives", () => {
  for (const mutation of ["sha256sum", "Attest native archive", "*.tar.gz"]) {
    const snapshot = validSnapshot();
    const job = snapshot.workflow.jobs["binary-artifacts"];
    if (mutation === "sha256sum") {
      job.steps[0].run = job.steps[0].run.replace("sha256sum", "echo");
    } else if (mutation === "Attest native archive") {
      job.steps[1].uses = "actions/attest@v4";
    } else {
      job.steps[2].with.path = "dist/*.sha256";
    }
    assert.throws(() => validateReleaseDistribution(snapshot));
  }
});

test("requires publisher credential verification before crates", () => {
  const snapshot = validSnapshot();
  const steps = snapshot.workflow.jobs.release.steps;
  const [verify] = steps.splice(2, 1);
  steps.splice(4, 0, verify);
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /verify editor credentials before crates/u,
  );
});

test("requires one smoke-tested VSIX for both rerun-safe publishers", () => {
  for (const mutation of ["rebuild", "different-path", "no-skip"]) {
    const snapshot = validSnapshot();
    const steps = snapshot.workflow.jobs.release.steps;
    if (mutation === "rebuild") {
      steps[4].run += "\nnpm run package:vsix";
    } else if (mutation === "different-path") {
      steps[6].run = steps[6].run.replace(
        'ovsx publish --packagePath "$vsix"',
        "ovsx publish other.vsix",
      );
    } else {
      steps[6].run = steps[6].run.replaceAll(" --skip-duplicate", "");
    }
    assert.throws(() => validateReleaseDistribution(snapshot));
  }
});

test("requires exact lockfile-backed publisher tools", () => {
  const snapshot = validSnapshot();
  snapshot.publisherTools.ovsx = "^1.0.2";
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /exact and lockfile-backed/u,
  );
});

test("requires the Zed registry path to retain the repository license", () => {
  const snapshot = validSnapshot();
  snapshot.zedLicense = "";
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /editors\/zed\/LICENSE/u,
  );
});

test("requires every release gate and rollback reference", () => {
  for (const gate of ["ci", "releasePrep", "release"]) {
    const snapshot = validSnapshot();
    snapshot.gates[gate] = "";
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      new RegExp(`${gate} must run ${CHECK_COMMAND}`, "u"),
    );
  }

  const snapshot = validSnapshot();
  snapshot.documentation.runbook =
    snapshot.documentation.runbook.replace("gh attestation verify", "");
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /docs\/RELEASING\.md must include gh attestation verify/u,
  );
});

test("the checked-in repository satisfies the distribution policy", () => {
  assert.deepEqual(validateReleaseDistribution(loadRepositorySnapshot()), {
    owner: EXPECTED_OWNER,
    platformCount: 3,
    editorRegistryCount: 3,
  });
});
