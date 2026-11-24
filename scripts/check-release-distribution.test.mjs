import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHECK_COMMAND,
  EXPECTED_EDITOR_POLICY,
  EXPECTED_FORMULA_RUBY,
  EXPECTED_HOMEBREW_POLICY,
  EXPECTED_OWNER,
  EXPECTED_PLATFORMS,
  EXPECTED_PROVENANCE,
  EXPECTED_PACKAGE_TOOLS,
  EXPECTED_SBOM_ARTIFACT,
  EXPECTED_SBOM_TOOL,
  HOMEBREW_SELF_TEST_COMMAND,
  PUBLICATION_SELF_TEST_COMMAND,
  loadRepositorySnapshot,
  validateReleaseDistribution,
} from "./check-release-distribution.mjs";

const ACTION_SHA = "a".repeat(40);
const ADMISSION_COMMANDS = Object.freeze([
  "bash scripts/release-profile-check.sh",
  "node scripts/check-editor-version-policy.mjs",
  CHECK_COMMAND,
  HOMEBREW_SELF_TEST_COMMAND,
  "cargo fmt --all -- --check",
  "cargo clippy --locked --all-targets --all-features -- -D warnings",
  "cargo test --all --locked",
  "cargo build --release --locked",
  "bash scripts/package-witness.sh",
]);

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
      homebrew: structuredClone(EXPECTED_HOMEBREW_POLICY),
    },
    packageTools: structuredClone(EXPECTED_PACKAGE_TOOLS),
    releaseArtifacts: [structuredClone(EXPECTED_SBOM_ARTIFACT)],
    repositoryLicense: "license\n",
    zedLicense: "license\n",
    workflow: {
      jobs: {
        "validate-release": {
          "runs-on": "ubuntu-24.04",
          permissions: { contents: "read" },
          steps: [
            {
              uses: `actions/checkout@${ACTION_SHA}`,
              with: {
                "fetch-depth": 0,
                "persist-credentials": false,
              },
            },
            {
              name: "Verify release metadata",
              run:
                'version="${GITHUB_REF_NAME#v}"\n' +
                "workspace_version=0.4.0\n" +
                'grep -F "## [$version]" CHANGELOG.md\n' +
                'test -f "docs/goalposts/${GITHUB_REF_NAME}/release.md"\n' +
                'test -f "docs/goalposts/${GITHUB_REF_NAME}/verification.md"\n',
            },
            {
              name: "Verify the tag is on main",
              run:
                "git fetch -q origin main\n" +
                'git rev-parse "${GITHUB_REF_NAME}^{commit}"\n' +
                "git merge-base --is-ancestor tag origin/main\n",
            },
            ...ADMISSION_COMMANDS.map((run) => ({ run })),
          ],
        },
        "binary-artifacts": {
          "runs-on": "${{ matrix.runner }}",
          needs: "validate-release",
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
              name: "Build native binaries",
              env: { TARGET: "${{ matrix.target }}" },
              run:
                'cargo build --release --target "$TARGET" ' +
                "-p colorful-cli -p colorful-lsp",
            },
            {
              name: "Package native binaries",
              env: {
                EXECUTABLE_SUFFIX:
                  "${{ matrix.executable_suffix }}",
                TARGET: "${{ matrix.target }}",
              },
              run:
                "cp target/$TARGET/colorful$EXECUTABLE_SUFFIX colorful-lsp README.md LICENSE NOTICE CHANGELOG.md dist/\n" +
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
                "if-no-files-found": "error",
              },
            },
          ],
        },
        release: {
          "runs-on": "ubuntu-24.04",
          needs: ["validate-release", "binary-artifacts"],
          permissions: {
            contents: "write",
            "id-token": "write",
            attestations: "write",
          },
          steps: [
            {
              name: "Set up formula syntax Ruby",
              ...structuredClone(EXPECTED_FORMULA_RUBY),
            },
            {
              name: "Download native archives",
              uses: `actions/download-artifact@${ACTION_SHA}`,
              with: {
                pattern: "release-binaries-*",
                path: "dist",
                "merge-multiple": true,
              },
            },
            {
              name: "Install SBOM tool",
              uses: `taiki-e/install-action@${ACTION_SHA}`,
              with: { tool: EXPECTED_SBOM_TOOL, fallback: "none" },
            },
            {
              name: "Generate SBOM",
              run:
                "set -euo pipefail\n" +
                "cargo cyclonedx --format json --all " +
                "--manifest-path crates/colorful-cli/Cargo.toml " +
                "--override-filename sbom\n" +
                "cargo cyclonedx --format json --all " +
                "--manifest-path crates/colorful-lsp/Cargo.toml " +
                "--override-filename sbom\n" +
                "cp crates/colorful-cli/sbom.json " +
                '"dist/colorful-language-${GITHUB_REF_NAME}' +
                '-colorful-sbom.cdx.json"\n' +
                "cp crates/colorful-lsp/sbom.json " +
                '"dist/colorful-language-${GITHUB_REF_NAME}' +
                '-colorful-lsp-sbom.cdx.json"\n',
            },
            {
              name: "Generate Homebrew formula",
              run:
                "set -euo pipefail\n" +
                'version="${GITHUB_REF_NAME#v}"\n' +
                "node scripts/generate-homebrew-formula.mjs " +
                '--version "$version" --dist-dir dist ' +
                "> dist/colorful.rb\n" +
                "ruby -c dist/colorful.rb\n",
            },
            {
              name: "Build and smoke editor packages",
              run:
                "npm --prefix editors/vscode run smoke:package\n" +
                smokeVsix +
                'cp "$vsix" dist/\n' +
                '(cd dist && sha256sum "$(basename "$vsix")" > ' +
                '"$(basename "$vsix").sha256")\n' +
                "tar -czf dist/colorful-zed-source.tar.gz " +
                "target/editor-smoke/zed-source\n",
            },
            {
              name: "Attest Homebrew and editor artifacts",
              uses: `actions/attest@${ACTION_SHA}`,
              with: {
                "subject-path":
                "dist/*.vsix\n" +
                "dist/*zed-source.tar.gz\n" +
                "dist/colorful.rb\n" +
                "dist/*sbom.cdx.json",
              },
            },
            { name: "Publish to crates.io", run: "cargo publish" },
            {
              name: "Create GitHub Release",
              run: "gh release create \"$GITHUB_REF_NAME\" dist/*",
            },
            {
              name: "Verify GitHub Release VSIX",
              run:
                smokeVsix +
                "node scripts/verify-editor-publication.mjs " +
                '--vsix "$vsix" --version "$version"',
            },
          ],
        },
      },
    },
    gates: {
      ci: {
        jobs: {
          policy: {
            steps: [
              { run: CHECK_COMMAND },
              { run: HOMEBREW_SELF_TEST_COMMAND },
            ],
          },
        },
      },
      releasePrep: `${CHECK_COMMAND}\n${HOMEBREW_SELF_TEST_COMMAND}\n`,
      release: {
        jobs: {
          policy: {
            steps: [
              { run: CHECK_COMMAND },
              { run: HOMEBREW_SELF_TEST_COMMAND },
            ],
          },
        },
      },
    },
    publicationVerificationGates: {
      ci: {
        jobs: {
          policy: {
            steps: [{ run: PUBLICATION_SELF_TEST_COMMAND }],
          },
        },
      },
      releasePrep: `${PUBLICATION_SELF_TEST_COMMAND}\n`,
    },
    documentation: {
      runbook: [
        "Publication and rollback owner: `@flyingrobots`",
        "gh release download vX.Y.Z",
        "gh release view vX.Y.Z",
        "gh attestation verify",
        "code --install-extension colorful-language-X.Y.Z.vsix --force",
        "code --uninstall-extension flyingrobots.colorful-language",
        "colorful-language-vX.Y.Z-zed-source.tar.gz",
        "Do not move the tag",
        "observational",
        "## Post-publication verification",
        "node scripts/verify-editor-publication.mjs",
        "shasum -a 256 -c ./*.sha256",
        "for artifact in colorful-language-vX.Y.Z-*.tar.gz colorful-language-X.Y.Z.vsix",
      ].join("\n"),
      topic:
        "installation-to-first-highlight is observational and not a correctness threshold",
    },
  };
}

function releaseStep(snapshot, name) {
  return snapshot.workflow.jobs.release.steps.find(
    (step) => step.name === name,
  );
}

test("accepts the complete native and editor distribution contract", () => {
  assert.deepEqual(validateReleaseDistribution(validSnapshot()), {
    owner: EXPECTED_OWNER,
    platformCount: 3,
    homebrewPlatformCount: 2,
    editorArtifactCount: 2,
  });
});

test("repository makes the GitHub Release VSIX the credential-free required channel", () => {
  const snapshot = loadRepositorySnapshot();
  assert.deepEqual(snapshot.policy.editors.vscode, {
    artifact: "target/editor-smoke/colorful-language-{version}.vsix",
    publication: {
      authority: "github-release-asset",
      installation: "manual-vsix",
    },
  });

  const steps = snapshot.workflow.jobs.release.steps;
  const stepNames = steps.map((step) => step.name).filter(Boolean);
  assert.equal(
    stepNames.some((name) => name.includes("Marketplace")),
    false,
  );
  assert.equal(stepNames.some((name) => name.includes("Open VSX")), false);
  assert.deepEqual(
    steps.flatMap((step) => Object.keys(step.env ?? {})).filter(
      (name) => name === "VSCE_PAT" || name === "OVSX_PAT",
    ),
    [],
  );

  const createIndex = stepNames.indexOf("Create GitHub Release");
  const verifyIndex = stepNames.indexOf("Verify GitHub Release VSIX");
  assert.notEqual(createIndex, -1);
  assert.notEqual(verifyIndex, -1);
  assert.ok(createIndex < verifyIndex);
  assert.match(
    releaseStep(snapshot, "Verify GitHub Release VSIX").run,
    /node scripts\/verify-editor-publication\.mjs/u,
  );
});

test("pins the Homebrew syntax parser to the reviewed Ruby release", () => {
  const setup = releaseStep(
    loadRepositorySnapshot(),
    "Set up formula syntax Ruby",
  );

  assert.deepEqual(
    {
      uses: setup?.uses,
      version: setup?.with?.["ruby-version"],
    },
    {
      uses:
        "ruby/setup-ruby@95ef2b042f9d7a56d8268cba8559e2842e2ad01b",
      version: "3.4.10",
    },
  );
});

test("rejects Homebrew syntax parser runtime drift", () => {
  for (const mutate of [
    (setup) => {
      setup.uses = "ruby/setup-ruby@v1";
    },
    (setup) => {
      setup.uses =
        "ruby/setup-ruby@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    },
    (setup) => {
      setup.with["ruby-version"] = "3.3.10";
    },
    (setup) => {
      setup.with["bundler-cache"] = true;
    },
  ]) {
    const snapshot = validSnapshot();
    mutate(releaseStep(snapshot, "Set up formula syntax Ruby"));
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /must use the reviewed formula syntax Ruby setup/u,
    );
  }
});

test("rejects marketplace credentials and publisher commands", () => {
  for (const mutate of [
    (step) => {
      step.env = { VSCE_PAT: "${{ secrets.VSCE_PAT }}" };
    },
    (step) => {
      step.env = { OVSX_PAT: "${{ secrets.OVSX_PAT }}" };
    },
    (step) => {
      step.run += "\nvsce publish --packagePath extension.vsix";
    },
    (step) => {
      step.run += "\novsx verify-pat flyingrobots";
    },
  ]) {
    const snapshot = validSnapshot();
    mutate(releaseStep(snapshot, "Publish to crates.io"));
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /must not require marketplace credentials or publisher commands/u,
    );
  }
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

test("rejects every Homebrew policy mutation", () => {
  for (const mutate of [
    (policy) => {
      policy.formula = "dist/other.rb";
    },
    (policy) => policy.binaries.reverse(),
    (policy) => {
      policy.platforms[0].target = "aarch64-unknown-linux-gnu";
    },
    (policy) => {
      policy.publication.authority = "external-tap";
    },
    (policy) => {
      policy.publication.tracking_issue = 251;
    },
  ]) {
    const snapshot = validSnapshot();
    mutate(snapshot.policy.homebrew);
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /Homebrew distribution policy has drifted/u,
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

test("requires a pinned publication runner", () => {
  const snapshot = validSnapshot();
  snapshot.workflow.jobs.release["runs-on"] = "ubuntu-latest";
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /must pin its publication runner/u,
  );
});

test("requires tag admission before provenance-producing jobs", () => {
  const missingDependency = validSnapshot();
  missingDependency.workflow.jobs["binary-artifacts"].needs = undefined;
  assert.throws(
    () => validateReleaseDistribution(missingDependency),
    /must wait for validate-release/u,
  );

  const missingAncestry = validSnapshot();
  const ancestry =
    missingAncestry.workflow.jobs["validate-release"].steps[2];
  ancestry.run = ancestry.run.replace("git merge-base --is-ancestor", "true");
  assert.throws(
    () => validateReleaseDistribution(missingAncestry),
    /ancestry admission must include git merge-base --is-ancestor/u,
  );
});

test("requires final validation before native provenance", () => {
  for (const omitted of ADMISSION_COMMANDS) {
    const snapshot = validSnapshot();
    snapshot.workflow.jobs["validate-release"].steps =
      snapshot.workflow.jobs["validate-release"].steps.filter(
        (step) => step.run !== omitted,
      );
    snapshot.workflow.jobs.release.steps.push(
      { run: omitted },
    );
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /admission must complete all final validation/u,
      `${omitted} may not run only after native artifacts`,
    );
  }
});

test("requires matrix values to enter shell through step-scoped env", () => {
  const buildInjection = validSnapshot();
  const build = buildInjection.workflow.jobs["binary-artifacts"].steps.find(
    (step) => step.name === "Build native binaries",
  );
  build.run = 'cargo build --target "${{ matrix.target }}"';
  assert.throws(
    () => validateReleaseDistribution(buildInjection),
    /build must isolate the reviewed target in env/u,
  );

  const packageInjection = validSnapshot();
  const packageStep =
    packageInjection.workflow.jobs["binary-artifacts"].steps.find(
      (step) => step.name === "Package native binaries",
    );
  packageStep.run += '\necho "${{ matrix.executable_suffix }}"';
  assert.throws(
    () => validateReleaseDistribution(packageInjection),
    /package must isolate reviewed matrix values in env/u,
  );
});

test("binds native dispatch and release side effects to the reviewed topology", () => {
  const wrongRunner = validSnapshot();
  wrongRunner.workflow.jobs["binary-artifacts"]["runs-on"] = "ubuntu-24.04";
  assert.throws(
    () => validateReleaseDistribution(wrongRunner),
    /native job must dispatch through matrix\.runner/u,
  );

  const reviewedOrder = [
    "Set up formula syntax Ruby",
    "Download native archives",
    "Install SBOM tool",
    "Generate SBOM",
    "Generate Homebrew formula",
    "Build and smoke editor packages",
    "Attest Homebrew and editor artifacts",
    "Publish to crates.io",
    "Create GitHub Release",
    "Verify GitHub Release VSIX",
  ];
  for (let index = 0; index < reviewedOrder.length - 1; index += 1) {
    const snapshot = validSnapshot();
    const steps = snapshot.workflow.jobs.release.steps;
    const earlierIndex = steps.findIndex(
      (step) => step.name === reviewedOrder[index],
    );
    assert.notEqual(
      earlierIndex,
      -1,
      `${reviewedOrder[index]} must exist in the release job`,
    );
    const [earlier] = steps.splice(earlierIndex, 1);
    const laterIndex = steps.findIndex(
      (step) => step.name === reviewedOrder[index + 1],
    );
    assert.notEqual(
      laterIndex,
      -1,
      `${reviewedOrder[index + 1]} must exist in the release job`,
    );
    steps.splice(laterIndex + 1, 0, earlier);
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /must preserve the reviewed release step order/u,
      `${reviewedOrder[index]} may not follow ${reviewedOrder[index + 1]}`,
    );
  }
});

test("requires signed checksummed native archives", () => {
  for (const [mutation, expected] of [
    ["sha256sum", /package step must include sha256sum/u],
    ["Attest native archive", /must pin actions\/attest/u],
    ["*.tar.gz", /must upload each archive and checksum/u],
  ]) {
    const snapshot = validSnapshot();
    const job = snapshot.workflow.jobs["binary-artifacts"];
    if (mutation === "sha256sum") {
      const packageStep = job.steps.find(
        (step) => step.name === "Package native binaries",
      );
      packageStep.run = packageStep.run.replace("sha256sum", "echo");
    } else if (mutation === "Attest native archive") {
      const attest = job.steps.find(
        (step) => step.name === "Attest native archive",
      );
      attest.uses = "actions/attest@v4";
    } else {
      const upload = job.steps.find(
        (step) => step.name === "Upload native archive",
      );
      upload.with.path = "dist/*.sha256";
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      expected,
      `${mutation} mutation must reach its specific invariant`,
    );
  }
});

test("rejects native artifact paths that can omit release assets", () => {
  const permissiveUpload = validSnapshot();
  const upload = permissiveUpload.workflow.jobs[
    "binary-artifacts"
  ].steps.find((step) => step.name === "Upload native archive");
  delete upload.with["if-no-files-found"];
  assert.throws(
    () => validateReleaseDistribution(permissiveUpload),
    /fail when native archive files are absent/u,
  );

  const redirectedDownload = validSnapshot();
  releaseStep(
    redirectedDownload,
    "Download native archives",
  ).with.path = "elsewhere";
  assert.throws(
    () => validateReleaseDistribution(redirectedDownload),
    /download native archives into dist/u,
  );
});

test("derives and attests Homebrew formulae from downloaded native assets", () => {
  for (const [mutation, expected] of [
    ["missing-step", /exactly one 'Generate Homebrew formula' step/u],
    ["wrong-dist", /exact reviewed command sequence/u],
    ["rebuild", /exact reviewed command sequence/u],
    ["before-download", /must preserve the reviewed release step order/u],
    [
      "unattested",
      /must attest the formula, VSIX, Zed source archive, and SBOM/u,
    ],
  ]) {
    const snapshot = validSnapshot();
    const steps = snapshot.workflow.jobs.release.steps;
    const formulaIndex = steps.findIndex(
      (step) => step.name === "Generate Homebrew formula",
    );
    if (mutation === "missing-step") {
      steps.splice(formulaIndex, 1);
    } else if (mutation === "wrong-dist") {
      steps[formulaIndex].run = steps[formulaIndex].run.replace(
        "--dist-dir dist",
        "--dist-dir elsewhere",
      );
    } else if (mutation === "rebuild") {
      steps[formulaIndex].run += "\ncargo build --release";
    } else if (mutation === "before-download") {
      const [formula] = steps.splice(formulaIndex, 1);
      const downloadIndex = steps.findIndex(
        (step) => step.name === "Download native archives",
      );
      steps.splice(downloadIndex, 0, formula);
    } else {
      const attest = releaseStep(
        snapshot,
        "Attest Homebrew and editor artifacts",
      );
      attest.with["subject-path"] = attest.with["subject-path"].replace(
        "\ndist/colorful.rb",
        "",
      );
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      expected,
      `${mutation} mutation must reach its specific invariant`,
    );
  }
});

test("rejects Homebrew command and attestation prefix bypasses", () => {
  for (const [mutation, expected] of [
    ["dist-prefix", /exact reviewed command sequence/u],
    ["output-suffix", /exact reviewed command sequence/u],
    ["duplicate-command", /exact reviewed command sequence/u],
    [
      "attestation-suffix",
      /must attest the formula, VSIX, Zed source archive, and SBOM/u,
    ],
  ]) {
    const snapshot = validSnapshot();
    const formula = releaseStep(snapshot, "Generate Homebrew formula");
    if (mutation === "dist-prefix") {
      formula.run = formula.run.replace(
        "--dist-dir dist",
        "--dist-dir dist-evil",
      );
    } else if (mutation === "output-suffix") {
      formula.run = formula.run.replace(
        "> dist/colorful.rb",
        "> dist/colorful.rb.evil",
      );
    } else if (mutation === "duplicate-command") {
      formula.run +=
        "\nnode scripts/generate-homebrew-formula.mjs " +
        '--version "$version" --dist-dir dist > dist/colorful.rb\n';
    } else {
      const attest = releaseStep(
        snapshot,
        "Attest Homebrew and editor artifacts",
      );
      attest.with["subject-path"] = attest.with["subject-path"].replace(
        "dist/colorful.rb",
        "dist/colorful.rb.evil",
      );
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      expected,
      `${mutation} must not satisfy the exact release policy`,
    );
  }
});

test("rejects non-Cargo replacement of Homebrew formula inputs", () => {
  for (const [mutation, command] of [
    [
      "archive-replacement",
      "printf tampered > " +
        "dist/colorful-language-v0.4.0-x86_64-unknown-linux-gnu.tar.gz",
    ],
    [
      "sidecar-replacement",
      "printf tampered > " +
        "dist/colorful-language-v0.4.0-x86_64-unknown-linux-gnu.tar.gz.sha256",
    ],
  ]) {
    const snapshot = validSnapshot();
    const formula = releaseStep(snapshot, "Generate Homebrew formula");
    formula.run += `\n${command}`;
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /exact reviewed command sequence/u,
      `${mutation} must not alter downloaded Homebrew inputs`,
    );
  }
});

test("requires one smoke-tested VSIX in the GitHub Release assets", () => {
  for (const mutation of [
    "rebuild",
    "different-path",
    "missing-copy",
    "missing-checksum",
  ]) {
    const snapshot = validSnapshot();
    const packageStep = releaseStep(
      snapshot,
      "Build and smoke editor packages",
    );
    if (mutation === "rebuild") {
      packageStep.run += "\nnpm run package:vsix";
    } else if (mutation === "different-path") {
      packageStep.run = packageStep.run.replace(
        'vsix="target/editor-smoke/colorful-language-${version}.vsix"',
        'vsix="target/editor-smoke/other.vsix"',
      );
    } else if (mutation === "missing-copy") {
      packageStep.run = packageStep.run.replace(
        'cp "$vsix" dist/',
        "cp other.vsix dist/",
      );
    } else {
      packageStep.run = packageStep.run.replace(
        'sha256sum "$(basename "$vsix")" > ' +
          '"$(basename "$vsix").sha256"',
        "sha256sum other.vsix > other.vsix.sha256",
      );
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /must promote one clean-install-smoked VSIX and checksum/u,
      `${mutation} mutation must reach its specific invariant`,
    );
  }
});

test("requires public GitHub Release bytes to match the smoke-tested VSIX", () => {
  for (const mutation of ["missing", "before-release", "wrong-input"]) {
    const snapshot = validSnapshot();
    const steps = snapshot.workflow.jobs.release.steps;
    const verificationIndex = steps.findIndex(
      (step) => step.name === "Verify GitHub Release VSIX",
    );
    const [verification] = steps.splice(verificationIndex, 1);
    if (mutation === "before-release") {
      const releaseIndex = steps.findIndex(
        (step) => step.name === "Create GitHub Release",
      );
      steps.splice(releaseIndex, 0, verification);
    } else if (mutation === "wrong-input") {
      verification.run = verification.run.replace(
        '--vsix "$vsix"',
        "--vsix other.vsix",
      );
      steps.push(verification);
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      mutation === "missing"
        ? /exactly one 'Verify GitHub Release VSIX' step/u
        : mutation === "before-release"
          ? /must preserve the reviewed release step order/u
          : /must verify the public GitHub Release VSIX/u,
    );
  }
});

test("requires the GitHub Release to attach every reviewed asset", () => {
  const snapshot = validSnapshot();
  const release = releaseStep(snapshot, "Create GitHub Release");
  release.run = release.run.replace("dist/*", "dist/*.tar.gz");
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /must attach every reviewed distribution asset/u,
  );
});

test("requires deterministic publication verification in local and hosted gates", () => {
  for (const gate of ["ci", "releasePrep"]) {
    const snapshot = validSnapshot();
    snapshot.publicationVerificationGates[gate] = "";
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      new RegExp(`${gate} must run ${PUBLICATION_SELF_TEST_COMMAND}`, "u"),
    );
  }
});

test("requires Homebrew generator evidence in every release gate", () => {
  for (const gate of ["ci", "release", "releasePrep"]) {
    const snapshot = validSnapshot();
    if (gate === "releasePrep") {
      snapshot.gates[gate] = CHECK_COMMAND;
    } else {
      snapshot.gates[gate] = {
        jobs: {
          policy: { steps: [{ run: CHECK_COMMAND }] },
        },
      };
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      new RegExp(`${gate} must run ${HOMEBREW_SELF_TEST_COMMAND}`, "u"),
    );
  }
});

test("finds hosted gates through parsed workflow steps", () => {
  const snapshot = validSnapshot();
  snapshot.gates.ci = {
    jobs: {
      policy: {
        steps: [
          {
            name: "Check release distribution policy",
            run: `${CHECK_COMMAND} # required policy gate\n`,
          },
          {
            name: "Self-test Homebrew formula generation",
            run:
              `${HOMEBREW_SELF_TEST_COMMAND} ` +
              "# deterministic self-test\n",
          },
        ],
      },
    },
  };
  snapshot.gates.release = snapshot.workflow;
  snapshot.publicationVerificationGates.ci = {
    jobs: {
      policy: {
        steps: [
          {
            name: "Test editor publication verification",
            run: `${PUBLICATION_SELF_TEST_COMMAND} # deterministic self-test\n`,
          },
        ],
      },
    },
  };
  assert.doesNotThrow(() => validateReleaseDistribution(snapshot));
});

test("requires exact lockfile-backed editor package tools", () => {
  const snapshot = validSnapshot();
  snapshot.packageTools["@vscode/vsce"] = "^3.9.2";
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

  const reflowed = validSnapshot();
  reflowed.documentation.runbook =
    reflowed.documentation.runbook.replace(
      "Publication and rollback",
      "Publication and\nrollback",
    );
  reflowed.documentation.topic =
    reflowed.documentation.topic.replace(
      "not a correctness threshold",
      "not a correctness\nthreshold",
    );
  assert.doesNotThrow(() => validateReleaseDistribution(reflowed));
});

test("keeps public byte verification after publication", () => {
  const snapshot = validSnapshot();
  snapshot.documentation.runbook =
    snapshot.documentation.runbook.replace(
      "## Post-publication verification\n" +
        "node scripts/verify-editor-publication.mjs",
      "node scripts/verify-editor-publication.mjs\n" +
        "## Post-publication verification",
    );
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /public byte verification must follow publication/u,
  );
});

test("downloads every release asset before integrity verification", () => {
  const snapshot = validSnapshot();
  snapshot.documentation.runbook =
    snapshot.documentation.runbook.replace(
      "gh release download vX.Y.Z",
      'gh release download vX.Y.Z --pattern "*.vsix"',
    );
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /download every release asset before attestation/u,
  );
});

test("verifies checksums and provenance for the complete release matrix", () => {
  for (const omitted of [
    "shasum -a 256 -c ./*.sha256",
    "colorful-language-vX.Y.Z-*.tar.gz",
  ]) {
    const snapshot = validSnapshot();
    snapshot.documentation.runbook =
      snapshot.documentation.runbook.replace(omitted, "");
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /verify checksums and provenance for every release artifact/u,
    );
  }
});

test("requires a generated SBOM covering the shipped dependency graph", () => {
  for (const [mutation, expected] of [
    ["missing-step", /must contain exactly one 'Generate SBOM' step/u],
    ["unpinned-tool", /exact reviewed command sequence/u],
    ["wrong-dist", /exact reviewed command sequence/u],
    ["before-download", /must preserve the reviewed release step order/u],
  ]) {
    const snapshot = validSnapshot();
    const steps = snapshot.workflow.jobs.release.steps;
    const index = steps.findIndex((step) => step.name === "Generate SBOM");
    assert.notEqual(
      index,
      -1,
      "the valid snapshot must contain a Generate SBOM step",
    );
    if (mutation === "missing-step") {
      steps.splice(index, 1);
    } else if (mutation === "unpinned-tool") {
      const install = releaseStep(snapshot, "Install SBOM tool");
      install.with.tool = "cargo-cyclonedx";
    } else if (mutation === "wrong-dist") {
      steps[index].run = steps[index].run.replace("dist/", "elsewhere/");
    } else if (mutation === "before-download") {
      const [sbom] = steps.splice(index, 1);
      steps.unshift(sbom);
    }
    assert.throws(() => validateReleaseDistribution(snapshot), expected);
  }
});

test("enforces the SBOM entries in the release artifact inventory", () => {
  for (const mutation of [
    "missing-entry",
    "drop-cli-sbom",
    "drop-lsp-sbom",
    "rename-asset",
    "empty-contents",
  ]) {
    const snapshot = validSnapshot();
    const artifacts = snapshot.releaseArtifacts;
    const index = artifacts.findIndex(
      (entry) => entry.name === "software-bill-of-materials",
    );
    assert.notEqual(index, -1, "fixture must register the SBOM inventory");
    if (mutation === "missing-entry") {
      artifacts.splice(index, 1);
    } else if (mutation === "drop-cli-sbom") {
      artifacts[index].contents = artifacts[index].contents.filter(
        (path) => !path.includes("-colorful-sbom"),
      );
    } else if (mutation === "drop-lsp-sbom") {
      artifacts[index].contents = artifacts[index].contents.filter(
        (path) => !path.includes("-colorful-lsp-sbom"),
      );
    } else if (mutation === "rename-asset") {
      artifacts[index].contents = artifacts[index].contents.map((path) =>
        path.replace("dist/", "elsewhere/"),
      );
    } else if (mutation === "empty-contents") {
      artifacts[index].contents = [];
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /release artifact inventory/u,
    );
  }
});

test("rejects SBOM installer fallback drift", () => {
  for (const fallback of ["cargo-binstall", "build", undefined]) {
    const snapshot = validSnapshot();
    const install = releaseStep(snapshot, "Install SBOM tool");
    if (fallback === undefined) {
      delete install.with.fallback;
    } else {
      install.with.fallback = fallback;
    }
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /exact reviewed command sequence/u,
    );
  }
});

test("rejects inert or misdirected SBOM generation commands", () => {
  for (const run of [
    // an inert stand-in that merely mentions the tool and touches a file
    "set -euo pipefail\n" +
      "echo 'cargo cyclonedx --locked --format json'\n" +
      'touch "dist/colorful-language-${GITHUB_REF_NAME}-sbom.cdx.json"\n',
    // real invocation, but the format is unbound
    "set -euo pipefail\n" +
      "cargo cyclonedx --locked --override-filename sbom\n" +
      "cp sbom.cdx.json " +
      '"dist/colorful-language-${GITHUB_REF_NAME}-sbom.cdx.json"\n',
    // real invocation, but the asset is written outside dist/
    "set -euo pipefail\n" +
      "cargo cyclonedx --locked --format json --override-filename sbom\n" +
      'cp sbom.cdx.json "elsewhere/sbom.cdx.json"\n',
    // an extra command smuggled in after the reviewed sequence
    "set -euo pipefail\n" +
      "cargo cyclonedx --locked --format json --override-filename sbom\n" +
      "cp sbom.cdx.json " +
      '"dist/colorful-language-${GITHUB_REF_NAME}-sbom.cdx.json"\n' +
      'echo overwritten > "dist/colorful-language-x-sbom.cdx.json"\n',
  ]) {
    const snapshot = validSnapshot();
    releaseStep(snapshot, "Generate SBOM").run = run;
    assert.throws(
      () => validateReleaseDistribution(snapshot),
      /exact reviewed command sequence/u,
    );
  }
});

test("attests the SBOM alongside the formula and editor artifacts", () => {
  const snapshot = validSnapshot();
  const attest = releaseStep(snapshot, "Attest Homebrew and editor artifacts");
  attest.with["subject-path"] = attest.with["subject-path"]
    .split(/\r?\n/u)
    .filter((line) => !line.includes("sbom"))
    .join("\n");
  assert.throws(
    () => validateReleaseDistribution(snapshot),
    /must attest the formula, VSIX, Zed source archive, and SBOM/u,
  );
});

test("the checked-in repository satisfies the distribution policy", () => {
  assert.deepEqual(validateReleaseDistribution(loadRepositorySnapshot()), {
    owner: EXPECTED_OWNER,
    platformCount: 3,
    homebrewPlatformCount: 2,
    editorArtifactCount: 2,
  });
});
