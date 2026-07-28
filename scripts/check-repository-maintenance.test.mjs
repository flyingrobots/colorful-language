#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  RepositoryMaintenanceError,
  repositoryCandidate,
  validateRepositoryMaintenance,
} from "./check-repository-maintenance.mjs";

const CHECKOUT_ACTION =
  "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const RUST_TOOLCHAIN_ACTION =
  "dtolnay/rust-toolchain@4cda84d5c5c54efe2404f9d843567869ab1699d4";
const INSTALL_ACTION =
  "taiki-e/install-action@41049aa56687c35e0afa74eed4f09cec4f9afabf";
const DEPENDENCY_ACTION =
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294";
const CODEQL_INIT =
  "github/codeql-action/init@e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81";
const CODEQL_ANALYZE =
  "github/codeql-action/analyze@e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81";

function requiredField(id) {
  return {
    type: "textarea",
    id,
    attributes: { label: id },
    validations: { required: true },
  };
}

function fixture() {
  return {
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
      contact_links: [
        {
          name: "Support",
          url: "https://github.com/flyingrobots/colorful-language/discussions/categories/q-a",
          about: "Ask a usage question.",
        },
        {
          name: "Design",
          url: "https://github.com/flyingrobots/colorful-language/discussions/categories/ideas",
          about: "Explore an early design.",
        },
      ],
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
                "allow-licenses":
                  "0BSD, Apache-2.0, Apache-2.0 WITH LLVM-exception, MIT, Unicode-3.0, Unlicense, Zlib, BlueOak-1.0.0, ISC",
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
      },
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
      },
    },
    releasePrep: `node --test scripts/check-repository-maintenance.test.mjs
node scripts/check-repository-maintenance.mjs
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

function expectCode(mutate, code) {
  const candidate = fixture();
  mutate(candidate);
  assert.throws(
    () => validateRepositoryMaintenance(candidate),
    (error) =>
      error instanceof RepositoryMaintenanceError && error.code === code,
  );
}

function actionStep(job, action) {
  return job.steps.find((step) => step.uses === action);
}

test("accepts the reviewed repository maintenance policy", () => {
  assert.doesNotThrow(() => validateRepositoryMaintenance(fixture()));
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

test("rejects a Discussion route outside the reviewed categories", () => {
  expectCode(({ issueConfig }) => {
    issueConfig.contact_links[0].url =
      "https://github.com/flyingrobots/colorful-language/discussions";
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

test("the repository satisfies the maintenance policy", () => {
  validateRepositoryMaintenance(repositoryCandidate());
});
