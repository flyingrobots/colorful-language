#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RepositoryMaintenanceError,
  repositoryCandidate,
  validateRepositoryMaintenance,
} from "./check-repository-maintenance.mjs";

const CHECKOUT_ACTION =
  "actions/checkout@1111111111111111111111111111111111111111";
const RUST_TOOLCHAIN_ACTION =
  "dtolnay/rust-toolchain@2222222222222222222222222222222222222222";
const INSTALL_ACTION =
  "taiki-e/install-action@3333333333333333333333333333333333333333";
const SETUP_NODE_ACTION =
  "actions/setup-node@4444444444444444444444444444444444444444";
const DEPENDENCY_ACTION =
  "actions/dependency-review-action@5555555555555555555555555555555555555555";
const CODEQL_INIT =
  "github/codeql-action/init@6666666666666666666666666666666666666666";
const CODEQL_ANALYZE =
  "github/codeql-action/analyze@6666666666666666666666666666666666666666";
const UPDATED_ACTIONS = new Map([
  [
    "actions/checkout",
    "actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ],
  [
    "actions/setup-node",
    "actions/setup-node@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ],
  [
    "taiki-e/install-action",
    "taiki-e/install-action@cccccccccccccccccccccccccccccccccccccccc",
  ],
]);
const DELIVERY_REFERENCE = [
  "GitHub milestones are goalposts.",
  "Release trains use one versioned tracking issue; slice issues keep their goalpost milestone.",
].join("\n");
const RELEASE_TRACKING_COMMANDS = [
  "```bash",
  "gh issue create \\",
  "  --repo flyingrobots/colorful-language \\",
  '  --title "[release] v0.4.0" \\',
  '  --milestone "Product Maturity — Evidence before expansion" \\',
  "  --label documentation \\",
  "  --label slice \\",
  "  --label area:core \\",
  "  --body-file docs/goalposts/v0.4.0/release.md",
  "```",
  "complete and review the packet's release thesis",
  "git switch -c release/v0.4.0",
  "bash scripts/release-prep.sh",
];
const EDITOR_TOOL_LICENSES = [
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-3.0",
  "CC0-1.0",
  "Python-2.0",
];
const EDITOR_TOOL_LICENSE_EXCEPTIONS = [
  "pkg:npm/@azu/style-format@1.0.1",
  "pkg:npm/@vscode/vsce-sign@2.0.9",
  "pkg:npm/@vscode/vsce-sign-alpine-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-alpine-x64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-darwin-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-darwin-x64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-linux-arm@2.0.6",
  "pkg:npm/@vscode/vsce-sign-linux-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-linux-x64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-win32-arm64@2.0.6",
  "pkg:npm/@vscode/vsce-sign-win32-x64@2.0.6",
  "pkg:npm/ovsx@1.0.2",
  "pkg:npm/typed-rest-client@1.8.11",
  "pkg:npm/xmlbuilder@11.0.1",
];

function requiredField(id) {
  return {
    type: "textarea",
    id,
    attributes: { label: id },
    validations: { required: true },
  };
}

function fixture() {
  const releaseWorkflow = {
    jobs: {
      release: {
        steps: [
          {
            name: "Verify and publish VS Marketplace extension",
            env: {
              VSCE_PAT: "${{ secrets.VSCE_PAT }}",
            },
          },
          {
            name: "Verify and publish Open VSX extension",
            env: {
              OVSX_PAT: "${{ secrets.OVSX_PAT }}",
            },
          },
          {
            name: "Publish to crates.io",
            env: {
              CARGO_REGISTRY_TOKEN:
                "${{ secrets.CARGO_REGISTRY_TOKEN }}",
            },
          },
        ],
      },
    },
  };
  return {
    repositoryProfile: {
      version: 2,
      homepage:
        "https://github.com/flyingrobots/colorful-language#readme",
      delivery_tracker: {
        issue_roles: ["release-trains", "slices"],
        milestone_role: "goalposts",
        release_issue_format: "[release] v{version}",
      },
      discussions: {
        supported_intake: false,
        owner: null,
        promoted_categories: [],
      },
      deployment: {
        environment: null,
        owner: "@flyingrobots",
        credential_owner: "@flyingrobots",
        rollback_owner: "@flyingrobots",
        credential_secrets: [
          "CARGO_REGISTRY_TOKEN",
          "OVSX_PAT",
          "VSCE_PAT",
        ],
        evidence: [
          "bash scripts/release-prep.sh",
          "node scripts/verify-editor-publication.mjs",
          "npm --prefix editors/vscode run smoke:package",
        ],
        create_environment_when:
          "a real release is scheduled and all credentials can move atomically",
      },
    },
    releaseProfile: {
      versioning: {
        release_tracking_issue_format: "[release] v{version}",
      },
    },
    deliveryReferences: {
      agents: DELIVERY_REFERENCE,
      contributing: DELIVERY_REFERENCE,
      maintenance: DELIVERY_REFERENCE,
      releasing: [
        DELIVERY_REFERENCE,
        ...RELEASE_TRACKING_COMMANDS,
      ].join("\n"),
      releaseProcess: DELIVERY_REFERENCE,
      roadmap: DELIVERY_REFERENCE,
    },
    bugForm: {
      name: "Bug report",
      description: "Report a reproducible defect",
      title: "[bug] ",
      labels: ["bug"],
      body: [
        requiredField("reproduction"),
        requiredField("expected"),
        requiredField("actual"),
        requiredField("version"),
        requiredField("environment"),
      ],
    },
    featureForm: {
      name: "Feature proposal",
      description: "Propose an actionable product change",
      title: "[feature] ",
      labels: ["enhancement"],
      body: [
        requiredField("problem"),
        requiredField("outcome"),
        requiredField("alternatives"),
      ],
    },
    issueConfig: {
      blank_issues_enabled: false,
      contact_links: [],
    },
    rustPolicy: `
[advisories]
ignore = []

[licenses]
allow = [
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "MIT",
  "NCSA",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
]
unused-allowed-license = "allow"
include-dev = true
exceptions = []

[sources]
unknown-registry = "deny"
unknown-git = "deny"
allow-registry = ["https://github.com/rust-lang/crates.io-index"]
allow-git = []
`,
    advisoryExceptions: {
      version: 1,
      exceptions: [],
    },
    workflowSecurityPolicy: {
      version: 1,
      analyzer: {
        name: "zizmor",
        version: "1.28.0",
      },
      invocation: {
        persona: "auditor",
        min_severity: "low",
        min_confidence: "low",
        offline: true,
        collect: "workflows",
        strict_collection: true,
      },
      exceptions: [
        {
          rule: "secrets-outside-env",
          path: ".github/workflows/release.yml:jobs.release.steps[Publish to crates.io].env.CARGO_REGISTRY_TOKEN",
          selector: "CARGO_REGISTRY_TOKEN",
          owner: "@flyingrobots",
          reason: "The release environment is not configured yet.",
          remove_when: "A protected release environment is configured.",
        },
        {
          rule: "secrets-outside-env",
          path: ".github/workflows/release.yml:jobs.release.steps[Verify and publish VS Marketplace extension].env.VSCE_PAT",
          selector: "VSCE_PAT",
          owner: "@flyingrobots",
          reason: "The release environment is not configured yet.",
          remove_when: "A protected release environment is configured.",
        },
        {
          rule: "secrets-outside-env",
          path: ".github/workflows/release.yml:jobs.release.steps[Verify and publish Open VSX extension].env.OVSX_PAT",
          selector: "OVSX_PAT",
          owner: "@flyingrobots",
          reason: "The release environment is not configured yet.",
          remove_when: "A protected release environment is configured.",
        },
      ],
    },
    maintenanceReference: [
      "Issues and milestones are the delivery authority",
      "Discussions are not a supported intake channel",
      "https://github.com/flyingrobots/colorful-language#readme",
      "No GitHub deployment environment exists",
      "@flyingrobots owns release execution",
      "rollback decisions",
      "CARGO_REGISTRY_TOKEN",
      "OVSX_PAT",
      "VSCE_PAT",
      "bash scripts/release-prep.sh",
      "node scripts/verify-editor-publication.mjs",
      "npm --prefix editors/vscode run smoke:package",
    ].join("\n"),
    securityWorkflow: {
      on: {
        push: { branches: ["main"] },
        pull_request: { branches: ["main"] },
        schedule: [{ cron: "17 14 * * 1" }],
      },
      jobs: {
        "rust-dependency-policy": {
          steps: [
            { uses: CHECKOUT_ACTION },
            { uses: RUST_TOOLCHAIN_ACTION },
            {
              uses: INSTALL_ACTION,
              with: { tool: "cargo-deny@0.18.9" },
            },
            { run: "bash scripts/check-rust-dependency-policy.test.sh" },
            { run: "bash scripts/check-rust-dependency-policy.sh" },
          ],
        },
        "dependency-review": {
          if: "github.event_name == 'pull_request'",
          steps: [
            { uses: CHECKOUT_ACTION },
            {
              uses: DEPENDENCY_ACTION,
              with: {
                "fail-on-severity": "moderate",
                "fail-on-scopes": "runtime, development, unknown",
                "license-check": true,
                "vulnerability-check": true,
                "allow-licenses": [
                  "0BSD",
                  "Apache-2.0",
                  "Apache-2.0 WITH LLVM-exception",
                  "MIT",
                  "NCSA",
                  "Unicode-3.0",
                  "Unlicense",
                  "Zlib",
                  "BlueOak-1.0.0",
                  "ISC",
                  ...EDITOR_TOOL_LICENSES,
                ].join(", "),
                "allow-dependencies-licenses":
                  EDITOR_TOOL_LICENSE_EXCEPTIONS.join(", "),
              },
            },
          ],
        },
        codeql: {
          permissions: {
            contents: "read",
            "security-events": "write",
          },
          strategy: {
            matrix: {
              include: [
                { language: "rust", "build-mode": "none" },
                {
                  language: "javascript-typescript",
                  "build-mode": "none",
                },
              ],
            },
          },
          steps: [
            { uses: CHECKOUT_ACTION },
            {
              uses: CODEQL_INIT,
              with: {
                languages: "${{ matrix.language }}",
                "build-mode": "${{ matrix.build-mode }}",
              },
            },
            { uses: CODEQL_ANALYZE },
          ],
        },
        "workflow-security": {
          permissions: {
            contents: "read",
          },
          steps: [
            {
              uses: CHECKOUT_ACTION,
              with: { "persist-credentials": false },
            },
            {
              uses: SETUP_NODE_ACTION,
              with: { "node-version-file": ".node-version" },
            },
            { run: "npm ci" },
            {
              uses: INSTALL_ACTION,
              with: { tool: "zizmor@1.28.0", fallback: "none" },
            },
            { run: "node --test scripts/check-workflow-security.test.mjs" },
            { run: "node scripts/check-workflow-security.mjs" },
          ],
        },
      },
    },
    workflowFiles: {
      ".github/workflows/release.yml": releaseWorkflow,
    },
    ciWorkflow: {
      jobs: {
        docs: {
          steps: [
            {
              run: "node --test scripts/check-repository-maintenance.test.mjs",
            },
            { run: "node scripts/check-repository-maintenance.mjs" },
          ],
        },
        "closure-contract": {
          steps: [
            {
              run: "bash scripts/check-closure-contract.sh --self-test",
            },
            {
              run: "bash scripts/check-closure-contract.test.sh",
            },
          ],
        },
      },
    },
    releasePrep: `node --test scripts/check-repository-maintenance.test.mjs
node scripts/check-repository-maintenance.mjs
bash scripts/check-closure-contract.sh --self-test
bash scripts/check-closure-contract.test.sh
node --test scripts/check-workflow-security.test.mjs
node scripts/check-workflow-security.mjs
bash scripts/check-rust-dependency-policy.test.sh
bash scripts/check-rust-dependency-policy.sh
`,
    codeowners: "* @flyingrobots\n",
    ruleset: {
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            require_code_owner_review: false,
          },
        },
      ],
    },
  };
}

function expectCode(mutate, code, path) {
  const candidate = fixture();
  mutate(candidate);
  assert.throws(
    () => validateRepositoryMaintenance(candidate),
    (error) =>
      error instanceof RepositoryMaintenanceError &&
      error.code === code &&
      (path === undefined || error.message.startsWith(`${path}:`)),
  );
}

function actionStep(job, action) {
  return job.steps.find((step) => step.uses === action);
}

function refreshWorkflowActions(candidate, updates) {
  for (const job of Object.values(candidate.securityWorkflow.jobs)) {
    for (const step of job.steps) {
      if (typeof step.uses !== "string") {
        continue;
      }
      const identity = step.uses.split("@", 1)[0];
      if (updates.has(identity)) {
        step.uses = updates.get(identity);
      }
    }
  }
}

function assertWorkflowActionsRefreshed(candidate, updates) {
  const uses = Object.values(candidate.securityWorkflow.jobs).flatMap((job) =>
    job.steps.map((step) => step.uses),
  );
  for (const [identity, expected] of updates) {
    const matching = uses.filter(
      (value) =>
        typeof value === "string" && value.split("@", 1)[0] === identity,
    );
    assert.notEqual(
      matching.length,
      0,
      `security fixture must use ${identity}`,
    );
    assert.deepEqual(
      matching,
      Array.from({ length: matching.length }, () => expected),
      `every ${identity} use must carry the refreshed pin`,
    );
  }
}

function dependencyReviewStep(candidate) {
  return actionStep(
    candidate.securityWorkflow.jobs["dependency-review"],
    DEPENDENCY_ACTION,
  );
}

function commandStep(job, command) {
  return job.steps.find((step) => step.run === command);
}

function addAdvisoryException(candidate) {
  candidate.rustPolicy = candidate.rustPolicy.replace(
    "ignore = []",
    'ignore = ["RUSTSEC-2099-0001"]',
  );
  candidate.advisoryExceptions.exceptions.push({
    id: "RUSTSEC-2099-0001",
    owner: "@flyingrobots",
    reason: "No compatible upstream release is available.",
    remove_when: "Upgrade when upstream publishes the fixed release.",
  });
}

test("accepts the reviewed repository maintenance policy", () => {
  assert.doesNotThrow(() => validateRepositoryMaintenance(fixture()));
});

test("accepts full-SHA security action refreshes without checker edits", () => {
  const candidate = fixture();
  refreshWorkflowActions(candidate, UPDATED_ACTIONS);
  assertWorkflowActionsRefreshed(candidate, UPDATED_ACTIONS);
  assert.doesNotThrow(() => validateRepositoryMaintenance(candidate));
});

test("rejects repository homepage drift", () => {
  expectCode(({ repositoryProfile }) => {
    repositoryProfile.homepage = "https://example.invalid";
  }, "E_REPOSITORY_PROFILE");
});

test("rejects a competing release-milestone delivery axis", () => {
  expectCode((candidate) => {
    candidate.releaseProfile = {
      versioning: {
        milestone_format: "v{version}",
        release_tracking_issue_format: "[release] v{version}",
      },
    };
  }, "E_DELIVERY_TRACKING");

  expectCode(({ releaseProfile }) => {
    releaseProfile.versioning.version = {
      milestone_format: "v{version}",
    };
  }, "E_DELIVERY_TRACKING");

  assert.match(
    readFileSync("scripts/release-profile-check.sh", "utf8"),
    /^node scripts\/check-repository-maintenance\.mjs$/mu,
  );
});

test("rejects drift in either delivery-tracking axis", () => {
  for (const mutate of [
    ({ repositoryProfile }) => {
      repositoryProfile.delivery_tracker.issue_roles.pop();
    },
    ({ repositoryProfile }) => {
      repositoryProfile.delivery_tracker.milestone_role =
        "release-trains";
    },
    ({ repositoryProfile }) => {
      repositoryProfile.delivery_tracker.release_issue_format =
        "v{version}";
    },
    ({ releaseProfile }) => {
      releaseProfile.versioning.release_tracking_issue_format =
        "release/v{version}";
    },
  ]) {
    expectCode(mutate, "E_DELIVERY_TRACKING");
  }
});

test("rejects a stale delivery-tracking reference", () => {
  for (const key of [
    "agents",
    "contributing",
    "maintenance",
    "releasing",
    "releaseProcess",
    "roadmap",
  ]) {
    expectCode(({ deliveryReferences }) => {
      deliveryReferences[key] = deliveryReferences[key].replace(
        "Release trains use one versioned tracking issue;",
        "Release trains use a GitHub milestone;",
      );
    }, "E_DELIVERY_TRACKING");
    expectCode(({ deliveryReferences }) => {
      deliveryReferences[key] = deliveryReferences[key].replace(
        "GitHub milestones are goalposts.",
        "GitHub milestones are release trains.",
      );
    }, "E_DELIVERY_TRACKING");
  }
});

test("rejects an additive contradictory delivery-tracking reference", () => {
  for (const key of [
    "agents",
    "contributing",
    "maintenance",
    "releasing",
    "releaseProcess",
    "roadmap",
  ]) {
    expectCode(({ deliveryReferences }) => {
      deliveryReferences[key] +=
        "\nUse GitHub milestones as release buckets.";
    }, "E_DELIVERY_TRACKING");
  }
});

test("rejects an incomplete v0.4.0 tracking and prep sequence", () => {
  for (const missing of RELEASE_TRACKING_COMMANDS) {
    expectCode(({ deliveryReferences }) => {
      deliveryReferences.releasing = [
        DELIVERY_REFERENCE,
        ...RELEASE_TRACKING_COMMANDS.filter(
          (command) => command !== missing,
        ),
      ].join("\n");
    }, "E_DELIVERY_TRACKING");
  }
});

test("rejects a noncompliant release-tracker label set", () => {
  for (const mutate of [
    (reference) => reference.replace("--label area:core", ""),
    (reference) =>
      reference.replace(
        "--label area:core",
        "--label area:core --label area:core",
      ),
    (reference) =>
      reference.replace("--label area:core", "--label area:lsp"),
    (reference) => reference.replace("--label documentation", ""),
    (reference) =>
      reference.replace(
        "--label slice",
        "--label slice --label slice",
      ),
    (reference) =>
      reference.replace(
        "--label area:core",
        '--label area:core --label "area:lsp"',
      ),
    (reference) =>
      reference.replace(
        "--label area:core",
        "--label area:core -l area:lsp",
      ),
    (reference) =>
      reference.replace(
        "--label area:core",
        "--label area:core,area:lsp",
      ),
  ]) {
    expectCode(({ deliveryReferences }) => {
      deliveryReferences.releasing = mutate(
        deliveryReferences.releasing,
      );
    }, "E_DELIVERY_TRACKING", "docs/RELEASING.md");
  }
});

test("does not accept release-tracker labels outside the command", () => {
  expectCode(({ deliveryReferences }) => {
    deliveryReferences.releasing =
      deliveryReferences.releasing
        .replace("--label area:core", "")
        .replace(
          "bash scripts/release-prep.sh",
          [
            "bash scripts/release-prep.sh",
            "Unrelated example: --label area:core",
          ].join("\n"),
        );
  }, "E_DELIVERY_TRACKING", "docs/RELEASING.md");
});

test("includes continued options after the tracker body file", () => {
  expectCode(({ deliveryReferences }) => {
    deliveryReferences.releasing =
      deliveryReferences.releasing.replace(
        "--body-file docs/goalposts/v0.4.0/release.md",
        [
          "--body-file docs/goalposts/v0.4.0/release.md \\",
          "--label area:lsp",
        ].join("\n"),
      );
  }, "E_DELIVERY_TRACKING", "docs/RELEASING.md");
});

test("accepts a future aligned release example without policy code edits", () => {
  const candidate = fixture();
  candidate.deliveryReferences.releasing =
    candidate.deliveryReferences.releasing.replaceAll(
      "v0.4.0",
      "v0.5.0",
    );
  assert.doesNotThrow(() =>
    validateRepositoryMaintenance(candidate),
  );

  expectCode(({ deliveryReferences }) => {
    deliveryReferences.releasing =
      deliveryReferences.releasing.replace(
        '--title "[release] v0.4.0"',
        '--title "[release] v0.5.0"',
      );
  }, "E_DELIVERY_TRACKING");

  expectCode(({ deliveryReferences }) => {
    deliveryReferences.releasing += [
      "",
      '--title "[release] v0.5.0"',
      "--body-file docs/goalposts/v0.5.0/release.md",
      "git switch -c release/v0.5.0",
    ].join("\n");
  }, "E_DELIVERY_TRACKING");
});

test("accepts reordered delivery-tracking profile fields", () => {
  const candidate = fixture();
  candidate.repositoryProfile.delivery_tracker = {
    release_issue_format: "[release] v{version}",
    milestone_role: "goalposts",
    issue_roles:
      candidate.repositoryProfile.delivery_tracker.issue_roles.reverse(),
  };
  assert.doesNotThrow(() =>
    validateRepositoryMaintenance(candidate),
  );
});

test("rejects deployment credentials without a named custodian", () => {
  expectCode(({ repositoryProfile }) => {
    repositoryProfile.deployment.credential_owner = null;
  }, "E_DEPLOYMENT_OWNERSHIP");
});

test("rejects deployment environment and evidence drift", () => {
  for (const [mutate, code] of [
    [
      ({ deployment }) => {
        deployment.environment = "release";
      },
      "E_DEPLOYMENT_OWNERSHIP",
    ],
    [
      ({ deployment }) => {
        deployment.credential_secrets.pop();
      },
      "E_DEPLOYMENT_CREDENTIALS",
    ],
    [
      ({ deployment }) => {
        deployment.credential_secrets[1] =
          deployment.credential_secrets[0];
      },
      "E_DEPLOYMENT_CREDENTIALS",
    ],
    [
      ({ deployment }) => {
        deployment.evidence.pop();
      },
      "E_DEPLOYMENT_EVIDENCE",
    ],
    [
      ({ deployment }) => {
        deployment.evidence[1] = deployment.evidence[0];
      },
      "E_DEPLOYMENT_EVIDENCE",
    ],
    [
      ({ deployment }) => {
        deployment.create_environment_when = "";
      },
      "E_DEPLOYMENT_OWNERSHIP",
    ],
  ]) {
    expectCode(({ repositoryProfile }) => {
      mutate(repositoryProfile);
    }, code);
  }
});

test("accepts deployment inventories in any order", () => {
  for (const field of ["credential_secrets", "evidence"]) {
    const candidate = fixture();
    candidate.repositoryProfile.deployment[field].reverse();
    assert.doesNotThrow(() =>
      validateRepositoryMaintenance(candidate),
    );
  }
});

test("rejects a stale public-posture reference", () => {
  expectCode((candidate) => {
    candidate.maintenanceReference = "";
  }, "E_REPOSITORY_REFERENCE");
});

test("rejects a public-posture reference without homepage or owner", () => {
  for (const claim of [
    "https://github.com/flyingrobots/colorful-language#readme",
    "@flyingrobots owns release execution",
  ]) {
    expectCode((candidate) => {
      candidate.maintenanceReference =
        candidate.maintenanceReference.replace(claim, "");
    }, "E_REPOSITORY_REFERENCE");
  }
});

test("rejects promoted Discussion routes without supported intake", () => {
  expectCode(({ issueConfig }) => {
    issueConfig.contact_links.push({
      name: "Support",
      url: "https://github.com/flyingrobots/colorful-language/discussions/categories/q-a",
      about: "Ask a usage question.",
    });
  }, "E_DISCUSSION_ROUTE");
});

test("accepts reviewed workflow-security exceptions in any order", () => {
  const candidate = fixture();
  candidate.workflowSecurityPolicy.exceptions.reverse();
  assert.doesNotThrow(() => validateRepositoryMaintenance(candidate));
});

test("accepts the exact editor package-tool license policy", () => {
  const candidate = fixture();
  const step = dependencyReviewStep(candidate);
  assert.equal(
    step.with["allow-dependencies-licenses"],
    EDITOR_TOOL_LICENSE_EXCEPTIONS.join(", "),
  );
  assert.doesNotThrow(() => validateRepositoryMaintenance(candidate));
});

test("accepts the exact Open VSX publisher license exception", () => {
  const candidate = fixture();
  const step = dependencyReviewStep(candidate);
  assert.match(
    step.with["allow-dependencies-licenses"],
    /(?:^|, )pkg:npm\/ovsx@1\.0\.2(?:,|$)/u,
  );
  assert.doesNotThrow(() => validateRepositoryMaintenance(candidate));
});

test("rejects a missing editor package-tool license exception", () => {
  expectCode((candidate) => {
    const step = dependencyReviewStep(candidate);
    step.with["allow-dependencies-licenses"] =
      EDITOR_TOOL_LICENSE_EXCEPTIONS.slice(1).join(", ");
  }, "E_DEPENDENCY_REVIEW");
});

test("rejects an unexpected editor package-tool license exception", () => {
  expectCode((candidate) => {
    const step = dependencyReviewStep(candidate);
    step.with["allow-dependencies-licenses"] +=
      ", pkg:npm/unreviewed-tool@1.0.0";
  }, "E_DEPENDENCY_REVIEW");
});

test("rejects a version-broadened editor package-tool exception", () => {
  expectCode((candidate) => {
    const step = dependencyReviewStep(candidate);
    step.with["allow-dependencies-licenses"] = step.with[
      "allow-dependencies-licenses"
    ].replace("@1.0.1", "");
  }, "E_DEPENDENCY_REVIEW");
});

test("rejects an incomplete bug form", () => {
  expectCode(({ bugForm }) => {
    bugForm.body.pop();
  }, "E_ISSUE_FORM_REQUIRED");
});

test("rejects an incomplete feature form", () => {
  expectCode(({ featureForm }) => {
    featureForm.body[2].validations.required = false;
  }, "E_ISSUE_FORM_REQUIRED");
});

test("rejects an unstructured blank issue escape hatch", () => {
  expectCode(({ issueConfig }) => {
    issueConfig.blank_issues_enabled = true;
  }, "E_ISSUE_BLANK");
});

test("rejects any Discussion route without a supported owner", () => {
  expectCode(({ issueConfig }) => {
    issueConfig.contact_links.push({
      name: "Design",
      url: "https://github.com/flyingrobots/colorful-language/discussions/categories/ideas",
      about: "Explore an early design.",
    });
  }, "E_DISCUSSION_ROUTE");
});

test("rejects an issue form that advertises an unowned Discussion", () => {
  expectCode(({ bugForm }) => {
    bugForm.body.unshift({
      type: "markdown",
      attributes: {
        value: "Use the Q&A Discussion for support.",
      },
    });
  }, "E_DISCUSSION_ROUTE");
});

test("rejects a lowercase Discussion URL in an issue form", () => {
  expectCode(({ featureForm }) => {
    featureForm.body.unshift({
      type: "markdown",
      attributes: {
        value:
          "Request help at https://github.com/flyingrobots/colorful-language/discussions.",
      },
    });
  }, "E_DISCUSSION_ROUTE");
});

test("rejects a weakened Rust license allowlist", () => {
  expectCode((candidate) => {
    candidate.rustPolicy = candidate.rustPolicy.replace('  "Zlib",\n', "");
  }, "E_RUST_LICENSES");
});

test("rejects omitted Rust development-dependency license coverage", () => {
  expectCode((candidate) => {
    candidate.rustPolicy = candidate.rustPolicy.replace(
      "include-dev = true\n",
      "",
    );
  }, "E_RUST_LICENSES");
});

test("rejects a blanket Rust advisory exception", () => {
  expectCode((candidate) => {
    candidate.rustPolicy = candidate.rustPolicy.replace(
      "ignore = []",
      'ignore = ["RUSTSEC-2000-0001"]',
    );
  }, "E_RUST_ADVISORY_EXCEPTION");
});

test("accepts a complete narrow Rust advisory exception", () => {
  const candidate = fixture();
  addAdvisoryException(candidate);
  assert.doesNotThrow(() => validateRepositoryMaintenance(candidate));
});

test("rejects an advisory exception without a removal trigger", () => {
  expectCode((candidate) => {
    addAdvisoryException(candidate);
    delete candidate.advisoryExceptions.exceptions[0].remove_when;
  }, "E_RUST_ADVISORY_EXCEPTION");
});

test("rejects stale advisory exception metadata", () => {
  expectCode(({ advisoryExceptions }) => {
    advisoryExceptions.exceptions.push({
      id: "RUSTSEC-2099-0001",
      owner: "@flyingrobots",
      reason: "The advisory is no longer ignored.",
      remove_when: "Remove this stale metadata immediately.",
    });
  }, "E_RUST_ADVISORY_EXCEPTION");
});

test("rejects an unknown Rust dependency source", () => {
  expectCode((candidate) => {
    candidate.rustPolicy = candidate.rustPolicy.replace(
      'unknown-git = "deny"',
      'unknown-git = "warn"',
    );
  }, "E_RUST_SOURCES");
});

test("rejects a floating cargo-deny tool version", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs["rust-dependency-policy"],
      INSTALL_ACTION,
    ).with.tool = "cargo-deny";
  }, "E_CARGO_DENY_PIN");
});

test("rejects a floating workflow-security analyzer version", () => {
  expectCode(({ workflowSecurityPolicy }) => {
    workflowSecurityPolicy.analyzer.version = "latest";
  }, "E_WORKFLOW_SECURITY_POLICY");
});

test("rejects a weakened workflow-security severity threshold", () => {
  expectCode(({ workflowSecurityPolicy }) => {
    workflowSecurityPolicy.invocation.min_severity = "high";
  }, "E_WORKFLOW_SECURITY_POLICY");
});

test("rejects a broadened workflow-security exception", () => {
  expectCode(({ workflowSecurityPolicy }) => {
    workflowSecurityPolicy.exceptions[0].path =
      ".github/workflows/release.yml";
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects a missing reviewed workflow-security exception", () => {
  expectCode(({ workflowSecurityPolicy }) => {
    workflowSecurityPolicy.exceptions.pop();
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects a publisher token missing from its reviewed step", () => {
  expectCode(({ workflowFiles }) => {
    const release =
      workflowFiles[".github/workflows/release.yml"];
    const publish = release.jobs.release.steps.find(
      (step) =>
        step.name === "Verify and publish VS Marketplace extension",
    );
    delete publish.env.VSCE_PAT;
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects a publisher token used by an additional release step", () => {
  expectCode(({ workflowFiles }) => {
    const release =
      workflowFiles[".github/workflows/release.yml"];
    release.jobs.release.steps.push({
      name: "Unreviewed publication",
      env: { VSCE_PAT: "${{ secrets.VSCE_PAT }}" },
    });
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects a second use of an excepted workflow secret", () => {
  expectCode(({ workflowFiles }) => {
    workflowFiles[".github/workflows/other.yml"] = {
      jobs: {
        other: {
          steps: [
            {
              env: {
                CARGO_REGISTRY_TOKEN:
                  "${{ secrets.CARGO_REGISTRY_TOKEN }}",
              },
            },
          ],
        },
      },
    };
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects a second use of an excepted publisher secret", () => {
  expectCode(({ workflowFiles }) => {
    workflowFiles[".github/workflows/other.yml"] = {
      jobs: {
        other: {
          steps: [
            {
              env: {
                OVSX_PAT: "${{ secrets.OVSX_PAT }}",
              },
            },
          ],
        },
      },
    };
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects an alternate expression spelling of an excepted secret", () => {
  expectCode(({ workflowFiles }) => {
    workflowFiles[".github/workflows/other.yml"] = {
      jobs: {
        other: {
          steps: [
            {
              env: {
                TOKEN: "${{secrets.CARGO_REGISTRY_TOKEN}}",
              },
            },
          ],
        },
      },
    };
  }, "E_WORKFLOW_SECURITY_EXCEPTION");
});

test("rejects persisted analyzer checkout credentials", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs["workflow-security"],
      CHECKOUT_ACTION,
    ).with["persist-credentials"] = true;
  }, "E_WORKFLOW_SECURITY_CREDENTIALS");
});

test("rejects write-capable analyzer permissions", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs["workflow-security"].permissions.contents = "write";
  }, "E_WORKFLOW_SECURITY_PERMISSIONS");
});

test("rejects an explicit credential in the analyzer job", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs["workflow-security"].env = {
      ADMIN_TOKEN: "${{ secrets.ADMIN_TOKEN }}",
    };
  }, "E_WORKFLOW_SECURITY_CREDENTIALS");
});

test("rejects a missing hosted workflow-security scan", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs["workflow-security"].steps.pop();
  }, "E_WORKFLOW_SECURITY_WIRING");
});

test("rejects a missing release-preparation workflow-security scan", () => {
  expectCode((candidate) => {
    candidate.releasePrep = candidate.releasePrep.replace(
      "node scripts/check-workflow-security.mjs\n",
      "",
    );
  }, "E_WORKFLOW_SECURITY_WIRING");
});

test("rejects a floating Rust policy checkout action", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs["rust-dependency-policy"],
      CHECKOUT_ACTION,
    ).uses = "actions/checkout@main";
  }, "E_SECURITY_ACTION_PIN");
});

test("rejects a floating Rust toolchain action", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs["rust-dependency-policy"],
      RUST_TOOLCHAIN_ACTION,
    ).uses = "dtolnay/rust-toolchain@master";
  }, "E_SECURITY_ACTION_PIN");
});

test("rejects a floating CodeQL checkout action", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs.codeql,
      CHECKOUT_ACTION,
    ).uses = "actions/checkout@v5";
  }, "E_SECURITY_ACTION_PIN");
});

test("rejects an omitted live Rust dependency scan", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs["rust-dependency-policy"].steps.pop();
  }, "E_SECURITY_WORKFLOW");
});

test("rejects a non-blocking Rust policy job", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs["rust-dependency-policy"]["continue-on-error"] = true;
  }, "E_SECURITY_SUPPRESSION");
});

test("rejects a disabled Rust policy command", () => {
  expectCode(({ securityWorkflow }) => {
    commandStep(
      securityWorkflow.jobs["rust-dependency-policy"],
      "bash scripts/check-rust-dependency-policy.sh",
    ).if = "${{ false }}";
  }, "E_SECURITY_SUPPRESSION");
});

test("rejects a non-blocking dependency-review action", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs["dependency-review"],
      DEPENDENCY_ACTION,
    )["continue-on-error"] = true;
  }, "E_SECURITY_SUPPRESSION");
});

test("rejects a disabled CodeQL job", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs.codeql.if = "${{ false }}";
  }, "E_SECURITY_SUPPRESSION");
});

test("rejects a non-blocking CodeQL analysis step", () => {
  expectCode(({ securityWorkflow }) => {
    actionStep(
      securityWorkflow.jobs.codeql,
      CODEQL_ANALYZE,
    )["continue-on-error"] = true;
  }, "E_SECURITY_SUPPRESSION");
});

test("rejects a weakened dependency-review severity", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs["dependency-review"].steps[1].with[
      "fail-on-severity"
    ] = "high";
  }, "E_DEPENDENCY_REVIEW");
});

test("rejects a missing CodeQL language", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs.codeql.strategy.matrix.include.pop();
  }, "E_CODEQL_LANGUAGES");
});

test("rejects an unsupported CodeQL build mode", () => {
  expectCode(({ securityWorkflow }) => {
    securityWorkflow.jobs.codeql.strategy.matrix.include[0]["build-mode"] =
      "autobuild";
  }, "E_CODEQL_BUILD_MODE");
});

test("rejects an omitted weekly security schedule", () => {
  expectCode(({ securityWorkflow }) => {
    delete securityWorkflow.on.schedule;
  }, "E_SECURITY_EVENTS");
});

test("rejects missing repository ownership", () => {
  expectCode((candidate) => {
    candidate.codeowners = undefined;
  }, "E_CODEOWNERS");
});

test("rejects a solo-maintainer approval requirement", () => {
  expectCode(({ ruleset }) => {
    ruleset.rules[0].parameters.required_approving_review_count = 1;
  }, "E_SOLO_APPROVAL");
});

test("rejects required code-owner review for the solo maintainer", () => {
  expectCode(({ ruleset }) => {
    ruleset.rules[0].parameters.require_code_owner_review = true;
  }, "E_SOLO_CODEOWNERS");
});

test("rejects missing CI policy execution", () => {
  expectCode(({ ciWorkflow }) => {
    ciWorkflow.jobs.docs.steps.pop();
  }, "E_CI_POLICY");
});

test("rejects missing release-preparation policy execution", () => {
  expectCode((candidate) => {
    candidate.releasePrep = candidate.releasePrep.replace(
      "bash scripts/check-rust-dependency-policy.sh\n",
      "",
    );
  }, "E_RELEASE_PREP");
});

test("rejects missing hosted closure-contract fixtures", () => {
  expectCode(({ ciWorkflow }) => {
    ciWorkflow.jobs["closure-contract"].steps.pop();
  }, "E_CLOSURE_WIRING");
});

test("rejects missing release-preparation closure-contract fixtures", () => {
  expectCode((candidate) => {
    candidate.releasePrep = candidate.releasePrep.replace(
      "bash scripts/check-closure-contract.test.sh\n",
      "",
    );
  }, "E_CLOSURE_WIRING");
});

test("the repository satisfies the maintenance policy", () => {
  validateRepositoryMaintenance(repositoryCandidate());
});
