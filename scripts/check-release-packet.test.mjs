import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  CHECK_COMMAND,
  ReleasePacketPolicyError,
  SELF_TEST_COMMAND,
  loadRepositorySnapshot,
  parseDocument,
  validateReleasePacket,
} from "./check-release-packet.mjs";

const RELEASE_PATH = "docs/goalposts/v0.4.0/release.md";
const VERIFICATION_PATH = "docs/goalposts/v0.4.0/verification.md";
const TARGET_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const PUBLISH_WORKFLOW =
  "https://github.com/flyingrobots/colorful-language/actions/runs/123456";
const GITHUB_RELEASE =
  "https://github.com/flyingrobots/colorful-language/releases/tag/v0.4.0";
const PREVIOUS_VERIFICATION = `# v0.3.0 verification

## Retrospective

Retrospective status: completed.

- The release outcome and next recommendation were recorded.
`;

function validSnapshot() {
  return {
    version: "0.4.0",
    previousTag: "v0.3.0",
    releasePath: RELEASE_PATH,
    release: `# colorful-language v0.4.0 — Release Packet

## Release thesis

Ship the reviewed product-maturity work through normal public channels.

## Version decision

Release 0.4.0 after v0.3.0 because pre-1.0 public APIs changed.

## Scope

### Must ship

- Release the synchronized workspace and editor adapters ([#154](https://github.com/flyingrobots/colorful-language/issues/154)).

### May slip

- Public Homebrew tap installation may follow ([#37](https://github.com/flyingrobots/colorful-language/issues/37)).

### Not included

- Controlled English remains a future phase ([#13](https://github.com/flyingrobots/colorful-language/issues/13)).

## Goalposts

- **Reach:** publish signed artifacts with public verification.
- **Integrity:** preserve deterministic contract validation.

## Scoped slices

- [#154](https://github.com/flyingrobots/colorful-language/issues/154) — public distribution.
- [#37](https://github.com/flyingrobots/colorful-language/issues/37) — Homebrew follow-up.
- [#13](https://github.com/flyingrobots/colorful-language/issues/13) — explicitly excluded.

## Explicit non-claims

- Publication has not happened while this packet is under review.

## Risks and rollback

- A partial publication patches forward from the immutable tag.

## Acceptance evidence

- **Reach:** \`node scripts/check-release-distribution.mjs\` proves the artifact graph.
- **Integrity:** \`node scripts/check-release-packet.mjs\` proves packet admission.
`,
    verificationPath: VERIFICATION_PATH,
    verification: `# colorful-language v0.4.0 — Verification Witness

## Status

- Target version: 0.4.0
- Previous public tag: v0.3.0

Release phase: pre-publication.

- Annotated v0.4.0 tag: not available.

## Pre-publication evidence

- Release preparation: pending.

## Publication evidence

Evidence state: unavailable.

- Tag and registries: not available.

## Public verification

Evidence state: unavailable.

- Clean installation and public URLs: not available.

## Retrospective

Evidence state: unavailable.

- Release retrospective: not available.
`,
    gateSources: {
      ".github/workflows/ci.yml": `jobs:
  docs:
    steps:
      - name: Self-test packet policy
        run: ${SELF_TEST_COMMAND}
      - name: Check packet
        run: ${CHECK_COMMAND}
`,
      ".github/workflows/release.yml": `jobs:
  validate-release:
    steps:
      - name: Self-test packet policy
        run: ${SELF_TEST_COMMAND}
      - name: Check packet
        run: ${CHECK_COMMAND}
  binary-artifacts:
    needs: validate-release
    steps:
      - run: "true"
  release:
    needs: binary-artifacts
    steps:
      - run: "true"
`,
      "scripts/release-prep.sh": `#!/usr/bin/env bash
set -euo pipefail
${SELF_TEST_COMMAND}
${CHECK_COMMAND}
`,
    },
  };
}

function expectCode(mutate, code) {
  const snapshot = validSnapshot();
  expectSnapshotCode(snapshot, mutate, code);
}

function expectSnapshotCode(snapshot, mutate, code) {
  mutate(snapshot);
  assert.throws(
    () => validateReleasePacket(snapshot),
    (error) => error instanceof ReleasePacketPolicyError && error.code === code,
  );
}

function replaceLevelTwoSection(source, heading, body) {
  const marker = `## ${heading}\n`;
  const headingStart = source.indexOf(marker);
  assert.notEqual(
    headingStart,
    -1,
    `fixture is missing level-two heading ${heading}`,
  );
  const bodyStart = headingStart + marker.length;
  const nextHeading = source.indexOf("\n## ", bodyStart);
  const bodyEnd = nextHeading === -1 ? source.length : nextHeading;
  return `${source.slice(0, bodyStart)}\n${body.trim()}\n${source.slice(bodyEnd)}`;
}

function sectionBody(source, heading) {
  const marker = `## ${heading}\n`;
  const headingStart = source.indexOf(marker);
  assert.notEqual(
    headingStart,
    -1,
    `fixture is missing level-two heading ${heading}`,
  );
  const bodyStart = headingStart + marker.length;
  const nextHeading = source.indexOf("\n## ", bodyStart);
  const bodyEnd = nextHeading === -1 ? source.length : nextHeading;
  return source.slice(bodyStart, bodyEnd).trim();
}

function blankLevelTwoSection(source, heading) {
  return replaceLevelTwoSection(source, heading, "");
}

function snapshotForPhase(phase) {
  const snapshot = validSnapshot();
  if (phase === "pre-publication") {
    return snapshot;
  }
  snapshot.verification = snapshot.verification
    .replace("Release phase: pre-publication.", `Release phase: ${phase}.`)
    .replace(
      "Annotated v0.4.0 tag: not available.",
      "Annotated v0.4.0 tag: available.",
    );
  snapshot.verification = replaceLevelTwoSection(
    snapshot.verification,
    "Publication evidence",
    `Evidence state: completed.

- Tag target commit: ${TARGET_COMMIT}.
- Publish workflow: ${PUBLISH_WORKFLOW}.
- GitHub Release: ${GITHUB_RELEASE}.`,
  );
  if (phase === "published") {
    return snapshot;
  }
  snapshot.verification = replaceLevelTwoSection(
    snapshot.verification,
    "Public verification",
    `Evidence state: completed.

- Verification result: passed on 2026-07-30.
- Rollback result: passed on 2026-07-30.`,
  );
  if (phase === "verified") {
    return snapshot;
  }
  snapshot.verification = replaceLevelTwoSection(
    snapshot.verification,
    "Retrospective",
    `Evidence state: completed.

Retrospective status: completed.

- Planned versus actual: reviewed scope recorded.
- Fallout: none.
- Repeatable wins: deterministic packet evidence.
- Next recommendation: begin held-out validation.`,
  );
  return snapshot;
}

function writeRepositorySnapshot(root, snapshot = validSnapshot()) {
  const sources = {
    "Cargo.toml": `[workspace.package]\nversion = "${snapshot.version}"\n`,
    [snapshot.releasePath]: snapshot.release,
    [snapshot.verificationPath]: snapshot.verification,
    "docs/goalposts/v0.3.0/release.md": "released\n",
    "docs/goalposts/v0.3.0/verification.md": PREVIOUS_VERIFICATION,
    ...snapshot.gateSources,
  };
  for (const [path, source] of Object.entries(sources)) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
}

function git(root, ...arguments_) {
  execFileSync("git", arguments_, {
    cwd: root,
    stdio: "ignore",
  });
}

test("accepts a complete pre-publication release packet", () => {
  assert.deepEqual(validateReleasePacket(validSnapshot()), {
    version: "0.4.0",
    previousTag: "v0.3.0",
    goalpostCount: 2,
    scopedIssueCount: 3,
    phase: "pre-publication",
  });
});

test("accepts one canonical witness for every release phase", () => {
  for (const phase of [
    "pre-publication",
    "published",
    "verified",
    "retrospected",
  ]) {
    assert.deepEqual(validateReleasePacket(snapshotForPhase(phase)), {
      version: "0.4.0",
      previousTag: "v0.3.0",
      goalpostCount: 2,
      scopedIssueCount: 3,
      phase,
    });
  }
});

test("rejects a phase declaration without its required evidence", () => {
  for (const phase of ["published", "verified", "retrospected"]) {
    expectCode((snapshot) => {
      snapshot.verification = snapshot.verification.replace(
        "Release phase: pre-publication.",
        `Release phase: ${phase}.`,
      );
    }, "E_RELEASE_PACKET_EVIDENCE");
  }
});

test("requires complete immutable publication evidence", () => {
  const mutations = [
    (source) =>
      source.replace(
        "Annotated v0.4.0 tag: available.",
        "Annotated v0.4.0 tag: unavailable.",
      ),
    (source) => source.replace(`- Tag target commit: ${TARGET_COMMIT}.\n`, ""),
    (source) =>
      source.replace(
        `- Publish workflow: ${PUBLISH_WORKFLOW}.`,
        "- Publish workflow: pending.",
      ),
    (source) =>
      source.replace(
        `- GitHub Release: ${GITHUB_RELEASE}.`,
        "- GitHub Release: not available.",
      ),
    (source) =>
      source.replace(
        "## Publication evidence\n\nEvidence state: completed.",
        "## Publication evidence\n\nEvidence state: unavailable.",
      ),
    (source) =>
      source.replace(
        "## Publication evidence\n\nEvidence state: completed.",
        "## Publication evidence\n\nEvidence state: completed.\n\nEvidence state: completed.",
      ),
  ];
  for (const mutate of mutations) {
    expectSnapshotCode(
      snapshotForPhase("published"),
      (snapshot) => {
        snapshot.verification = mutate(snapshot.verification);
      },
      "E_RELEASE_PACKET_EVIDENCE",
    );
  }
});

test("rejects verification or retrospective evidence before its phase", () => {
  expectSnapshotCode(
    snapshotForPhase("published"),
    (snapshot) => {
      const verified = snapshotForPhase("verified");
      snapshot.verification = replaceLevelTwoSection(
        snapshot.verification,
        "Public verification",
        sectionBody(verified.verification, "Public verification"),
      );
    },
    "E_RELEASE_PACKET_EVIDENCE",
  );
  expectSnapshotCode(
    snapshotForPhase("verified"),
    (snapshot) => {
      const retrospected = snapshotForPhase("retrospected");
      snapshot.verification = replaceLevelTwoSection(
        snapshot.verification,
        "Retrospective",
        sectionBody(retrospected.verification, "Retrospective"),
      );
    },
    "E_RELEASE_PACKET_EVIDENCE",
  );
});

test("requires publication and dated public-verification evidence", () => {
  const mutations = [
    (source) =>
      source.replace(
        "## Publication evidence\n\nEvidence state: completed.",
        "## Publication evidence\n\nEvidence state: unavailable.",
      ),
    (source) =>
      source.replace(
        "## Public verification\n\nEvidence state: completed.",
        "## Public verification\n\nEvidence state: unavailable.",
      ),
    (source) =>
      source.replace("- Verification result: passed on 2026-07-30.\n", ""),
    (source) => source.replace("- Rollback result: passed on 2026-07-30.", ""),
  ];
  for (const mutate of mutations) {
    expectSnapshotCode(
      snapshotForPhase("verified"),
      (snapshot) => {
        snapshot.verification = mutate(snapshot.verification);
      },
      "E_RELEASE_PACKET_EVIDENCE",
    );
  }
});

test("requires every completed retrospective field", () => {
  const mutations = [
    (source) =>
      source.replace(
        "## Public verification\n\nEvidence state: completed.",
        "## Public verification\n\nEvidence state: unavailable.",
      ),
    (source) =>
      source.replace(
        "## Retrospective\n\nEvidence state: completed.",
        "## Retrospective\n\nEvidence state: unavailable.",
      ),
    (source) =>
      source.replace(
        "Retrospective status: completed.",
        "Retrospective status: pending.",
      ),
    ...[
      "Planned versus actual",
      "Fallout",
      "Repeatable wins",
      "Next recommendation",
    ].map(
      (label) => (source) =>
        source.replace(new RegExp(`^- ${label}:.*\\n?`, "mu"), ""),
    ),
  ];
  for (const mutate of mutations) {
    expectSnapshotCode(
      snapshotForPhase("retrospected"),
      (snapshot) => {
        snapshot.verification = mutate(snapshot.verification);
      },
      "E_RELEASE_PACKET_EVIDENCE",
    );
  }
});

test("parses release packet pipe tables structurally", () => {
  const document = parseDocument(
    "| Disposition | Slices |\n| --- | --- |\n| Included | #154 |\n",
    "table-fixture.md",
  );
  assert.equal(document.children[0]?.type, "table");
  assert.equal(document.children[0]?.children[1]?.type, "tableRow");
  assert.equal(
    document.children[0]?.children[1]?.children[0]?.type,
    "tableCell",
  );
});

test("rejects a release packet without a thesis", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "Ship the reviewed product-maturity work through normal public channels.",
      "",
    );
  }, "E_RELEASE_PACKET_SECTION");
});

test("rejects packet and witness identity drift", () => {
  for (const mutate of [
    (snapshot) => {
      snapshot.releasePath = "docs/goalposts/v0.4.1/release.md";
    },
    (snapshot) => {
      snapshot.release = snapshot.release.replace("v0.4.0", "v0.4.1");
    },
    (snapshot) => {
      snapshot.release = snapshot.release.replace("v0.3.0", "v0.2.1");
    },
    (snapshot) => {
      snapshot.verification = snapshot.verification.replace("v0.4.0", "v0.4.1");
    },
  ]) {
    expectCode(mutate, "E_RELEASE_PACKET_IDENTITY");
  }
});

test("requires exact version decision tokens", () => {
  for (const replacement of [
    "Release 10.4.0 after v0.3.0",
    "Release 0.4.0 after v10.3.0",
  ]) {
    expectCode((snapshot) => {
      snapshot.release = snapshot.release.replace(
        "Release 0.4.0 after v0.3.0",
        replacement,
      );
    }, "E_RELEASE_PACKET_IDENTITY");
  }
});

test("rejects every missing or empty release section", () => {
  for (const heading of [
    "Release thesis",
    "Version decision",
    "Scope",
    "Goalposts",
    "Scoped slices",
    "Explicit non-claims",
    "Risks and rollback",
    "Acceptance evidence",
  ]) {
    expectCode((snapshot) => {
      snapshot.release = snapshot.release.replace(`## ${heading}`, "");
    }, "E_RELEASE_PACKET_SECTION");
    expectCode((snapshot) => {
      snapshot.release = blankLevelTwoSection(snapshot.release, heading);
    }, "E_RELEASE_PACKET_SECTION");
  }
});

test("rejects an empty scope bucket", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "- Public Homebrew tap installation may follow ([#37](https://github.com/flyingrobots/colorful-language/issues/37)).",
      "",
    );
  }, "E_RELEASE_PACKET_SCOPE");
});

test("requires exact scope buckets and slice inventory", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "## Goalposts",
      "### Undeclared\n\n- Ship an unreviewed surface.\n\n## Goalposts",
    );
  }, "E_RELEASE_PACKET_SCOPE");
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "## Explicit non-claims",
      "- [#99](https://github.com/flyingrobots/colorful-language/issues/99) — inventory-only scope.\n\n## Explicit non-claims",
    );
  }, "E_RELEASE_PACKET_SCOPE");
});

test("enforces the two-to-five goalpost bound", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "- **Integrity:** preserve deterministic contract validation.\n",
      "",
    );
  }, "E_RELEASE_PACKET_GOALPOSTS");
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "- **Integrity:** preserve deterministic contract validation.",
      [
        "- **Integrity:** preserve deterministic contract validation.",
        "- **Evidence:** retain executable proof.",
        "- **Editors:** preserve adapter compatibility.",
        "- **Operations:** retain rollback ownership.",
        "- **Extra:** exceed the reviewed bound.",
      ].join("\n"),
    );
  }, "E_RELEASE_PACKET_GOALPOSTS");
});

test("requires observable acceptance evidence for every goalpost", () => {
  for (const [evidence, vague] of [
    [
      "- **Reach:** `node scripts/check-release-distribution.mjs` proves the artifact graph.",
      "- **Reach:** the release looks complete.",
    ],
    [
      "- **Integrity:** `node scripts/check-release-packet.mjs` proves packet admission.",
      "- **Integrity:** the implementation appears reliable.",
    ],
  ]) {
    expectCode((snapshot) => {
      snapshot.release = snapshot.release.replace(evidence, vague);
    }, "E_RELEASE_PACKET_GOALPOSTS");
  }
});

test("requires unique goalpost labels", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "- **Integrity:** preserve deterministic contract validation.",
      "- **Reach:** preserve deterministic contract validation.",
    );
  }, "E_RELEASE_PACKET_GOALPOSTS");
});

test("rejects a scoped issue omitted from the slice inventory", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "- [#37](https://github.com/flyingrobots/colorful-language/issues/37) — Homebrew follow-up.\n",
      "",
    );
  }, "E_RELEASE_PACKET_SCOPE");
});

test("resolves reference-style issue links in the scope inventory", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release
      .replace(
        "([#154](https://github.com/flyingrobots/colorful-language/issues/154)).",
        "([#154](https://github.com/flyingrobots/colorful-language/issues/154) and [#99][slice-99]).",
      )
      .replace(
        "## Goalposts",
        "[slice-99]: https://github.com/flyingrobots/colorful-language/issues/99\n\n## Goalposts",
      );
  }, "E_RELEASE_PACKET_SCOPE");
});

test("rejects every missing or empty verification section", () => {
  for (const heading of [
    "Status",
    "Pre-publication evidence",
    "Publication evidence",
    "Public verification",
    "Retrospective",
  ]) {
    expectCode((snapshot) => {
      snapshot.verification = snapshot.verification.replace(
        `## ${heading}`,
        "",
      );
    }, "E_RELEASE_PACKET_SECTION");
    expectCode((snapshot) => {
      snapshot.verification = blankLevelTwoSection(
        snapshot.verification,
        heading,
      );
    }, "E_RELEASE_PACKET_SECTION");
  }
});

test("requires exactly one release phase", () => {
  expectCode((snapshot) => {
    snapshot.verification = snapshot.verification.replace(
      "Release phase: pre-publication.",
      "Release phase: pre-publication.\n\nRelease phase: published.",
    );
  }, "E_RELEASE_PACKET_EVIDENCE");
});

test("rejects contradictory pre-publication status identity", () => {
  for (const [before, after, code] of [
    [
      "Target version: 0.4.0",
      "Target version: 0.4.1",
      "E_RELEASE_PACKET_IDENTITY",
    ],
    [
      "Previous public tag: v0.3.0",
      "Previous public tag: v0.2.1",
      "E_RELEASE_PACKET_IDENTITY",
    ],
    [
      "Annotated v0.4.0 tag: not available.",
      "Annotated v0.4.0 tag: available.",
      "E_RELEASE_PACKET_EVIDENCE",
    ],
  ]) {
    expectCode((snapshot) => {
      snapshot.verification = snapshot.verification.replace(before, after);
    }, code);
  }
});

test("rejects invented public evidence in the pre-publication phase", () => {
  for (const text of [
    "Tag and registries: not available.",
    "Clean installation and public URLs: not available.",
    "Release retrospective: not available.",
  ]) {
    expectCode((snapshot) => {
      snapshot.verification = snapshot.verification.replace(
        text,
        `${text.split(":")[0]}: complete.`,
      );
    }, "E_RELEASE_PACKET_EVIDENCE");
  }
  expectCode((snapshot) => {
    snapshot.verification = snapshot.verification.replace(
      "- Tag and registries: not available.",
      "- Tag and registries: not available.\n- Tag: published successfully.",
    );
  }, "E_RELEASE_PACKET_EVIDENCE");
});

test("requires structured unavailable evidence states before publication", () => {
  expectCode((snapshot) => {
    snapshot.verification = snapshot.verification.replace(
      "## Publication evidence\n\nEvidence state: unavailable.\n\n",
      "## Publication evidence\n\n",
    );
  }, "E_RELEASE_PACKET_EVIDENCE");
  expectCode((snapshot) => {
    snapshot.verification = snapshot.verification.replace(
      "- Tag and registries: not available.",
      "- The v0.4.0 tag was created at abc1234; registry checks are pending.",
    );
  }, "E_RELEASE_PACKET_EVIDENCE");
});

test("rejects linked public evidence in the pre-publication phase", () => {
  expectCode((snapshot) => {
    snapshot.verification = snapshot.verification.replace(
      "- Tag and registries: not available.",
      "- Tag and registries: not available. [release run](https://github.com/flyingrobots/colorful-language/actions/runs/1)",
    );
  }, "E_RELEASE_PACKET_EVIDENCE");
});

test("rejects reference-linked public evidence in the pre-publication phase", () => {
  expectCode((snapshot) => {
    snapshot.verification = snapshot.verification
      .replace(
        "- Release preparation: pending.",
        "- Release preparation: pending.\n\n[published-run]: https://github.com/flyingrobots/colorful-language/actions/runs/1",
      )
      .replace(
        "- Tag and registries: not available.",
        "- Tag and registries: not available. [release run][published-run]",
      );
  }, "E_RELEASE_PACKET_EVIDENCE");
});

test("accepts the documented unavailable pre-publication state", () => {
  const snapshot = validSnapshot();
  snapshot.verification = snapshot.verification.replaceAll(
    "not available",
    "unavailable",
  );
  assert.doesNotThrow(() => validateReleasePacket(snapshot));
});

test("requires the self-test before the live check in every release gate", () => {
  for (const gate of Object.keys(validSnapshot().gateSources)) {
    expectCode((snapshot) => {
      snapshot.gateSources[gate] = CHECK_COMMAND;
    }, "E_RELEASE_PACKET_GATE");
    expectCode((snapshot) => {
      snapshot.gateSources[gate] =
        `# ${SELF_TEST_COMMAND}\n# ${CHECK_COMMAND}\n`;
    }, "E_RELEASE_PACKET_GATE");
    expectCode((snapshot) => {
      snapshot.gateSources[gate] = snapshot.gateSources[gate]
        .replace(SELF_TEST_COMMAND, "__RELEASE_GATE_ORDER_SWAP__")
        .replace(CHECK_COMMAND, SELF_TEST_COMMAND)
        .replace("__RELEASE_GATE_ORDER_SWAP__", CHECK_COMMAND);
    }, "E_RELEASE_PACKET_GATE");
  }
});

test("requires packet admission in every tag-workflow dependency path", () => {
  expectCode((snapshot) => {
    snapshot.gateSources[".github/workflows/release.yml"] = `jobs:
  validate-release:
    steps:
      - run: "true"
  detached-packet-check:
    steps:
      - run: ${SELF_TEST_COMMAND}
      - run: ${CHECK_COMMAND}
  release:
    needs: validate-release
    steps:
      - run: "true"
`;
  }, "E_RELEASE_PACKET_GATE");
  expectCode((snapshot) => {
    snapshot.gateSources[".github/workflows/release.yml"] =
      snapshot.gateSources[".github/workflows/release.yml"].replace(
        "  binary-artifacts:\n    needs: validate-release",
        "  binary-artifacts:",
      );
  }, "E_RELEASE_PACKET_GATE");
});

test("does not accept dormant release gate commands", () => {
  for (const gate of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ]) {
    expectCode((snapshot) => {
      snapshot.gateSources[gate] = `env:
  DORMANT_COMMANDS: |
    ${SELF_TEST_COMMAND}
    ${CHECK_COMMAND}
jobs:
  inert:
    steps:
      - run: "true"
`;
    }, "E_RELEASE_PACKET_GATE");
  }
  expectCode((snapshot) => {
    snapshot.gateSources["scripts/release-prep.sh"] = `#!/usr/bin/env bash
if false; then
  ${SELF_TEST_COMMAND}
  ${CHECK_COMMAND}
fi
`;
  }, "E_RELEASE_PACKET_GATE");
});

test("does not accept release gates after shell termination", () => {
  expectCode((snapshot) => {
    snapshot.gateSources["scripts/release-prep.sh"] = `#!/usr/bin/env bash
exit 0
${SELF_TEST_COMMAND}
${CHECK_COMMAND}
`;
  }, "E_RELEASE_PACKET_GATE");
});

test("shell comments cannot hide later packet commands", () => {
  for (const comment of [
    "# don't treat this apostrophe as shell syntax",
    "# `this unmatched backtick is inert",
    "# <<COMMENT is not a here-document",
  ]) {
    const snapshot = validSnapshot();
    snapshot.gateSources["scripts/release-prep.sh"] = `#!/usr/bin/env bash
${comment}
${SELF_TEST_COMMAND}
${CHECK_COMMAND}
    `;
    assert.doesNotThrow(() => validateReleasePacket(snapshot));
  }
  const quotedMarkerSnapshot = validSnapshot();
  quotedMarkerSnapshot.gateSources["scripts/release-prep.sh"] =
    `#!/usr/bin/env bash
printf '%s\\n' "# don't strip <<COMMENT or \`quoted data"
${SELF_TEST_COMMAND}
${CHECK_COMMAND}
`;
  assert.doesNotThrow(() => validateReleasePacket(quotedMarkerSnapshot));
});

test("does not accept packet commands inside guarded compound lists", () => {
  for (const [opening, closing] of [
    ["false && {", "}"],
    ["false && (", ")"],
  ]) {
    expectCode((snapshot) => {
      snapshot.gateSources["scripts/release-prep.sh"] = `#!/usr/bin/env bash
set -euo pipefail
${opening}
  ${SELF_TEST_COMMAND}
  ${CHECK_COMMAND}
${closing}
`;
    }, "E_RELEASE_PACKET_GATE");
  }
});

test("requires fail-closed workflow gate steps", () => {
  for (const gate of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ]) {
    for (const mutate of [
      (source) => source.replace("    steps:", "    if: false\n    steps:"),
      (source) =>
        source.replace("    steps:", "    continue-on-error: true\n    steps:"),
      (source) =>
        source.replace(
          "      - name: Self-test packet policy",
          "      - name: Self-test packet policy\n        if: false",
        ),
      (source) =>
        source.replace(
          "      - name: Self-test packet policy",
          "      - name: Self-test packet policy\n        continue-on-error: true",
        ),
      (source) =>
        source.replace(
          "      - name: Check packet",
          "      - name: Check packet\n        if: false",
        ),
      (source) =>
        source.replace(
          "      - name: Check packet",
          "      - name: Check packet\n        continue-on-error: true",
        ),
    ]) {
      expectCode((snapshot) => {
        snapshot.gateSources[gate] = mutate(snapshot.gateSources[gate]);
      }, "E_RELEASE_PACKET_GATE");
    }
  }
});

test("reports a stable category when the target packet is missing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, "docs/goalposts/v0.3.0"), { recursive: true });
  writeFileSync(
    join(root, "Cargo.toml"),
    '[workspace.package]\nversion = "0.4.0"\n',
  );
  writeFileSync(join(root, "docs/goalposts/v0.3.0/release.md"), "released\n");
  writeFileSync(
    join(root, "docs/goalposts/v0.3.0/verification.md"),
    PREVIOUS_VERIFICATION,
  );

  assert.throws(
    () =>
      loadRepositorySnapshot(root, {
        publicTags: ["v0.3.0"],
      }),
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === "E_RELEASE_PACKET_IO" &&
      error.message.includes(RELEASE_PATH),
  );
});

test("derives the previous release from public tags, not packet directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeRepositorySnapshot(root);
  mkdirSync(join(root, "docs/goalposts/v0.3.1"), { recursive: true });
  writeFileSync(join(root, "docs/goalposts/v0.3.1/release.md"), "abandoned\n");
  writeFileSync(
    join(root, "docs/goalposts/v0.3.1/verification.md"),
    "pre-publication\n",
  );

  assert.equal(
    loadRepositorySnapshot(root, {
      publicTags: ["v0.3.0"],
    }).previousTag,
    "v0.3.0",
  );
});

test("requires a completed predecessor retrospective", (t) => {
  for (const [name, previousVerification] of [
    ["missing", "# v0.3.0 verification\n"],
    [
      "pending",
      "# v0.3.0 verification\n\n## Retrospective\n\nRetrospective status: pending.\n",
    ],
  ]) {
    const root = mkdtempSync(
      join(tmpdir(), `colorful-release-packet-${name}-`),
    );
    t.after(() => rmSync(root, { recursive: true }));
    writeRepositorySnapshot(root);
    writeFileSync(
      join(root, "docs/goalposts/v0.3.0/verification.md"),
      previousVerification,
    );
    assert.throws(
      () =>
        loadRepositorySnapshot(root, {
          publicTags: ["v0.3.0"],
        }),
      (error) =>
        error instanceof ReleasePacketPolicyError &&
        error.code === "E_RELEASE_PACKET_EVIDENCE",
    );
  }
});

test("rejects a target behind the latest public release", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeRepositorySnapshot(root);

  assert.throws(
    () =>
      loadRepositorySnapshot(root, {
        publicTags: ["v0.3.0", "v0.5.0"],
      }),
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === "E_RELEASE_PACKET_IDENTITY",
  );
});

test("ignores release tags that are not reachable from HEAD", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeRepositorySnapshot(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "release-packet@example.invalid");
  git(root, "config", "user.name", "Release Packet Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  git(root, "tag", "--no-sign", "v0.3.0");
  git(root, "switch", "-c", "abandoned-release");
  writeFileSync(join(root, "abandoned.txt"), "not merged\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "abandoned");
  git(root, "tag", "--no-sign", "v0.3.1");
  git(root, "switch", "main");

  assert.equal(loadRepositorySnapshot(root).previousTag, "v0.3.0");
});

test("the checked-in v0.4.0 release packet satisfies the policy", () => {
  assert.doesNotThrow(() => validateReleasePacket(loadRepositorySnapshot()));
});

test("documentation spine links the planned packet and witness", () => {
  const documentationIndex = readFileSync(
    new URL("../docs/README.md", import.meta.url),
    "utf8",
  );
  const plannedEntry = documentationIndex
    .split("\n- ")
    .find((entry) => entry.startsWith("**Planned v0.4.0:**"));
  assert.ok(plannedEntry, "docs/README.md must list planned v0.4.0");
  assert.match(plannedEntry, /\(goalposts\/v0\.4\.0\/release\.md\)/u);
  assert.match(plannedEntry, /\(goalposts\/v0\.4\.0\/verification\.md\)/u);
  assert.match(plannedEntry, /\bnot yet tagged or published\b/u);
});
