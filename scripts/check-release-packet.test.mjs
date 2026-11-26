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
const ABANDONED_PUBLICATION = `Evidence state: not applicable.

- Publication of v0.4.0 was abandoned; the forward version carries its work.`;
const ABANDONED_PUBLIC_VERIFICATION = `Evidence state: not applicable.

- Public verification does not apply to an abandoned tag.`;
const ABANDONED_RETROSPECTIVE = `Evidence state: completed.

Retrospective status: completed.

- Planned versus actual: the tag run failed admission and nothing shipped.
- Fallout: the tag stays unpublished.
- Repeatable wins: a release dry run before the tag.
- Next recommendation: release the same work as v0.4.1.
- Forward version: v0.4.1.`;
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
    (error) =>
      error instanceof ReleasePacketPolicyError && error.code === code,
  );
}

function sectionBounds(source, heading) {
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
  return { bodyStart, bodyEnd };
}

function replaceLevelTwoSection(source, heading, body) {
  const { bodyStart, bodyEnd } = sectionBounds(source, heading);
  return `${source.slice(0, bodyStart)}\n${body.trim()}\n${source.slice(bodyEnd)}`;
}

function sectionBody(source, heading) {
  const { bodyStart, bodyEnd } = sectionBounds(source, heading);
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
  snapshot.targetCommit = TARGET_COMMIT;
  if (phase === "abandoned") {
    snapshot.verification = abandonedVerification(snapshot.verification);
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

function gitOutput(root, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
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
    "abandoned",
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

test("rejects regression from the previously admitted release phase", () => {
  for (const [previousPhase, phase] of [
    ["published", "pre-publication"],
    ["verified", "published"],
    ["retrospected", "verified"],
  ]) {
    const snapshot = snapshotForPhase(phase);
    snapshot.previousPhase = previousPhase;
    expectSnapshotCode(
      snapshot,
      () => {},
      "E_RELEASE_PACKET_EVIDENCE",
    );
  }

  const advancing = snapshotForPhase("verified");
  advancing.previousPhase = "published";
  assert.equal(validateReleasePacket(advancing).phase, "verified");
});

test("accepts autolink publication identities without double counting", () => {
  const snapshot = snapshotForPhase("published");
  snapshot.verification = snapshot.verification
    .replace(PUBLISH_WORKFLOW, `<${PUBLISH_WORKFLOW}>`)
    .replace(GITHUB_RELEASE, `<${GITHUB_RELEASE}>`);
  assert.equal(validateReleasePacket(snapshot).phase, "published");
});

test("rejects a phase declaration without its required evidence", () => {
  for (const phase of ["published", "verified", "retrospected"]) {
    expectCode((snapshot) => {
      snapshot.verification = snapshot.verification.replace(
        "Release phase: pre-publication.",
        `Release phase: ${phase}.`,
      );
      snapshot.verification = snapshot.verification.replace(
        "Annotated v0.4.0 tag: not available.",
        "Annotated v0.4.0 tag: available.",
      );
      snapshot.targetCommit = TARGET_COMMIT;
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
      source.replace(TARGET_COMMIT, TARGET_COMMIT.slice(0, 39)),
    (source) =>
      source.replace(TARGET_COMMIT, "f".repeat(TARGET_COMMIT.length)),
    (source) =>
      source.replace(
        `- Publish workflow: ${PUBLISH_WORKFLOW}.`,
        "- Publish workflow: pending.",
      ),
    (source) =>
      source.replace(PUBLISH_WORKFLOW, `${PUBLISH_WORKFLOW}.invalid`),
    (source) =>
      source.replace(
        `- GitHub Release: ${GITHUB_RELEASE}.`,
        "- GitHub Release: not available.",
      ),
    (source) =>
      source.replace(GITHUB_RELEASE, GITHUB_RELEASE.replace("0.4.0", "0.4.1")),
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
    (source) => source.replace("2026-07-30", "2026-02-31"),
    (source) =>
      source.replace(
        "Rollback result: passed on 2026-07-30.",
        "Rollback result: failed on 2026-07-30.",
      ),
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

test("accepts a dated patch-forward result instead of rollback", () => {
  const snapshot = snapshotForPhase("verified");
  snapshot.verification = snapshot.verification.replace(
    "Rollback result: passed on 2026-07-30.",
    "Patch-forward result: passed on 2026-07-30.",
  );
  assert.equal(validateReleasePacket(snapshot).phase, "verified");
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
    (source) =>
      source.replace(
        "- Next recommendation: begin held-out validation.",
        "- Next recommendation: begin held-out validation.\n- Deferred registry: not available.",
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

test("allows completed retrospective fallout to name an unavailable surface", () => {
  const snapshot = snapshotForPhase("retrospected");
  snapshot.verification = snapshot.verification.replace(
    "- Fallout: none.",
    "- Fallout: the may-slip Homebrew channel remained unavailable.",
  );
  assert.equal(validateReleasePacket(snapshot).phase, "retrospected");
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
      snapshot.verification = snapshot.verification.replace(
        "v0.4.0",
        "v0.4.1",
      );
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
      snapshot.release = blankLevelTwoSection(
        snapshot.release,
        heading,
      );
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

test("rejects public evidence hidden in literal Markdown blocks", () => {
  for (const hiddenEvidence of [
    "```text\nTag published successfully at https://example.invalid/release\n```",
    "<div>Tag published successfully at https://example.invalid/release</div>",
    "### Tag published successfully at https://example.invalid/release",
  ]) {
    expectCode((snapshot) => {
      snapshot.verification = snapshot.verification.replace(
        "- Tag and registries: not available.",
        `- Tag and registries: not available.\n\n${hiddenEvidence}`,
      );
    }, "E_RELEASE_PACKET_EVIDENCE");
  }
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
        source.replace(
          "    steps:",
          "    continue-on-error: true\n    steps:",
        ),
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
    "[workspace.package]\nversion = \"0.4.0\"\n",
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

test("keeps historical v0.1.0 through v0.3.0 witnesses readable", () => {
  for (const version of ["0.1.0", "0.2.0", "0.2.1", "0.3.0"]) {
    const source = readFileSync(
      new URL(`../docs/goalposts/v${version}/verification.md`, import.meta.url),
      "utf8",
    );
  const document = parseDocument(
    source,
    `docs/goalposts/v${version}/verification.md`,
  );
  assert.match(
    source,
    /##\s+Discovery/u,
    `v${version} missing Discovery section`,
  );
  assert.match(
    source,
    /##\s+Tag and publish/u,
    `v${version} missing tag-and-publish section`,
  );
    assert.match(
      source,
      new RegExp(`^# colorful-language v${version.replaceAll(".", "\\.")}`),
    );
    assert.equal(document.children[0]?.type, "heading");
    assert.equal(document.children[0]?.depth, 1);
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

test("fails closed when the branch-base phase cannot be resolved", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeRepositorySnapshot(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "release-packet@example.invalid");
  git(root, "config", "user.name", "Release Packet Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "current branch");
  const tree = gitOutput(root, "write-tree");
  const unrelated = gitOutput(
    root,
    "commit-tree",
    tree,
    "-m",
    "unrelated origin main",
  );
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    unrelated,
  );

  assert.throws(
    () =>
      loadRepositorySnapshot(root, {
        publicTags: ["v0.3.0"],
      }),
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === "E_RELEASE_PACKET_IO",
  );
});

test("binds published commit evidence to the annotated target tag", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeRepositorySnapshot(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "release-packet@example.invalid");
  git(root, "config", "user.name", "Release Packet Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "previous release");
  git(root, "tag", "--no-sign", "v0.3.0");
  writeFileSync(join(root, "release-target.txt"), "release target\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "release target");
  const targetCommit = gitOutput(root, "rev-parse", "HEAD");
  git(root, "tag", "--no-sign", "v0.4.0");

  const published = snapshotForPhase("published");
  published.verification = published.verification.replace(
    TARGET_COMMIT,
    targetCommit,
  );
  writeFileSync(
    join(root, published.verificationPath),
    published.verification,
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "record publication");

  assert.throws(
    () => validateReleasePacket(loadRepositorySnapshot(root)),
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === "E_RELEASE_PACKET_EVIDENCE",
  );
  git(root, "tag", "--delete", "v0.4.0");
  git(
    root,
    "tag",
    "--no-sign",
    "-a",
    "v0.4.0",
    targetCommit,
    "-m",
    "release: v0.4.0",
  );
  assert.equal(loadRepositorySnapshot(root).targetCommit, targetCommit);
  assert.equal(
    validateReleasePacket(loadRepositorySnapshot(root)).phase,
    "published",
  );
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    gitOutput(root, "rev-parse", "HEAD"),
  );
  const verified = snapshotForPhase("verified");
  verified.verification = verified.verification.replace(
    TARGET_COMMIT,
    targetCommit,
  );
  writeFileSync(
    join(root, verified.verificationPath),
    verified.verification,
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "record public verification");
  const loaded = loadRepositorySnapshot(root);
  assert.equal(loaded.previousPhase, "published");
  assert.equal(validateReleasePacket(loaded).phase, "verified");

  writeFileSync(
    join(root, verified.verificationPath),
    verified.verification.replace(targetCommit, "f".repeat(40)),
  );
  assert.throws(
    () => validateReleasePacket(loadRepositorySnapshot(root)),
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === "E_RELEASE_PACKET_EVIDENCE",
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

function taggedVerification(source) {
  return source
    .replace("Release phase: pre-publication.", "Release phase: tagged.")
    .replace(
      "Annotated v0.4.0 tag: not available.",
      "Annotated v0.4.0 tag: available.",
    );
}

function abandonedVerification(source) {
  let verification = taggedVerification(source).replace(
    "Release phase: tagged.",
    "Release phase: abandoned.",
  );
  verification = replaceLevelTwoSection(
    verification,
    "Publication evidence",
    ABANDONED_PUBLICATION,
  );
  verification = replaceLevelTwoSection(
    verification,
    "Public verification",
    ABANDONED_PUBLIC_VERIFICATION,
  );
  return replaceLevelTwoSection(
    verification,
    "Retrospective",
    ABANDONED_RETROSPECTIVE,
  );
}

function taggedSnapshot() {
  const snapshot = validSnapshot();
  snapshot.targetCommit = TARGET_COMMIT;
  snapshot.verification = taggedVerification(snapshot.verification);
  return snapshot;
}

function assertPolicyRejection(action, code, pattern) {
  assert.throws(
    action,
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === code &&
      pattern.test(error.message),
  );
}

function releaseRepository(t) {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeRepositorySnapshot(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "release-packet@example.invalid");
  git(root, "config", "user.name", "Release Packet Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "previous release");
  git(root, "tag", "--no-sign", "v0.3.0");
  writeFileSync(join(root, "release-target.txt"), "release target\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "release target");
  return { root, targetCommit: gitOutput(root, "rev-parse", "HEAD") };
}

function annotateTargetTag(root, commit = "HEAD") {
  git(
    root,
    "tag",
    "--no-sign",
    "-a",
    "v0.4.0",
    commit,
    "-m",
    "release: v0.4.0",
  );
}

function commitWitness(root, verification, message) {
  writeFileSync(join(root, VERIFICATION_PATH), verification);
  git(root, "add", ".");
  git(root, "commit", "--allow-empty", "-m", message);
}

test("accepts pre-publication on the commit the annotated target tag resolves to", (t) => {
  const { root, targetCommit } = releaseRepository(t);
  annotateTargetTag(root);

  const loaded = loadRepositorySnapshot(root);
  assert.equal(loaded.targetCommit, targetCommit);
  assert.equal(validateReleasePacket(loaded).phase, "pre-publication");
});

test("rejects pre-publication on a commit after the annotated target tag", (t) => {
  const { root, targetCommit } = releaseRepository(t);
  annotateTargetTag(root);
  writeFileSync(join(root, "after-tag.txt"), "after the tag\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "after the tag");

  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(root)),
    "E_RELEASE_PACKET_EVIDENCE",
    new RegExp(`already resolves to ${targetCommit}`, "u"),
  );
});

test("accepts the tagged phase while the annotated target tag resolves", (t) => {
  const { root, targetCommit } = releaseRepository(t);
  annotateTargetTag(root);
  commitWitness(
    root,
    taggedVerification(validSnapshot().verification),
    "record the tag",
  );

  const loaded = loadRepositorySnapshot(root);
  assert.equal(loaded.targetCommit, targetCommit);
  assert.equal(validateReleasePacket(loaded).phase, "tagged");
  assert.equal(validateReleasePacket(taggedSnapshot()).phase, "tagged");
});

test("rejects the tagged phase when the annotated target tag does not resolve", (t) => {
  const tagged = taggedVerification(validSnapshot().verification);
  const unresolved = /requires annotated tag v0\.4\.0 to resolve/u;

  const absent = releaseRepository(t);
  commitWitness(absent.root, tagged, "claim an absent tag");
  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(absent.root)),
    "E_RELEASE_PACKET_EVIDENCE",
    unresolved,
  );

  const lightweight = releaseRepository(t);
  git(lightweight.root, "tag", "--no-sign", "v0.4.0");
  commitWitness(lightweight.root, tagged, "claim a lightweight tag");
  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(lightweight.root)),
    "E_RELEASE_PACKET_EVIDENCE",
    unresolved,
  );

  const unreachable = releaseRepository(t);
  git(unreachable.root, "switch", "-c", "abandoned-release");
  writeFileSync(join(unreachable.root, "abandoned.txt"), "not merged\n");
  git(unreachable.root, "add", ".");
  git(unreachable.root, "commit", "-m", "abandoned");
  annotateTargetTag(unreachable.root);
  git(unreachable.root, "switch", "main");
  assert.equal(
    validateReleasePacket(loadRepositorySnapshot(unreachable.root)).phase,
    "pre-publication",
  );
  commitWitness(unreachable.root, tagged, "claim an unreachable tag");
  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(unreachable.root)),
    "E_RELEASE_PACKET_EVIDENCE",
    unresolved,
  );

  const source = releaseRepository(t);
  annotateTargetTag(source.root);
  commitWitness(source.root, tagged, "record the tag");
  const shallow = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(shallow, { recursive: true }));
  git(
    shallow,
    "clone",
    "--quiet",
    "--depth",
    "1",
    "--no-tags",
    `file://${source.root}`,
    ".",
  );
  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(shallow)),
    "E_RELEASE_PACKET_IDENTITY",
    /no public release tag precedes 0\.4\.0/u,
  );
  assertPolicyRejection(
    () =>
      validateReleasePacket(
        loadRepositorySnapshot(shallow, { publicTags: ["v0.3.0"] }),
      ),
    "E_RELEASE_PACKET_EVIDENCE",
    unresolved,
  );
});

test("rejects a tagged witness with an unavailable tag or completed publication", () => {
  assertPolicyRejection(
    () => {
      const snapshot = taggedSnapshot();
      snapshot.verification = snapshot.verification.replace(
        "Annotated v0.4.0 tag: available.",
        "Annotated v0.4.0 tag: not available.",
      );
      validateReleasePacket(snapshot);
    },
    "E_RELEASE_PACKET_EVIDENCE",
    /keep annotated target tag v0\.4\.0 available during the tagged phase/u,
  );
  assertPolicyRejection(
    () => {
      const snapshot = taggedSnapshot();
      snapshot.verification = replaceLevelTwoSection(
        snapshot.verification,
        "Publication evidence",
        sectionBody(
          snapshotForPhase("published").verification,
          "Publication evidence",
        ),
      );
      validateReleasePacket(snapshot);
    },
    "E_RELEASE_PACKET_EVIDENCE",
    /'Publication evidence' must declare exactly one unavailable evidence state/u,
  );
});

test("rejects regression through the tagged phase", (t) => {
  const regression = /cannot regress from branch-base phase/u;
  const backToPrePublication = validSnapshot();
  backToPrePublication.previousPhase = "tagged";
  assertPolicyRejection(
    () => validateReleasePacket(backToPrePublication),
    "E_RELEASE_PACKET_EVIDENCE",
    regression,
  );
  const backToTagged = taggedSnapshot();
  backToTagged.previousPhase = "published";
  assertPolicyRejection(
    () => validateReleasePacket(backToTagged),
    "E_RELEASE_PACKET_EVIDENCE",
    regression,
  );

  const forwardToTagged = taggedSnapshot();
  forwardToTagged.previousPhase = "pre-publication";
  assert.equal(validateReleasePacket(forwardToTagged).phase, "tagged");
  const forwardToPublished = snapshotForPhase("published");
  forwardToPublished.previousPhase = "tagged";
  assert.equal(validateReleasePacket(forwardToPublished).phase, "published");

  const { root } = releaseRepository(t);
  annotateTargetTag(root);
  commitWitness(
    root,
    taggedVerification(validSnapshot().verification),
    "record the tag",
  );
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    gitOutput(root, "rev-parse", "HEAD"),
  );
  writeFileSync(join(root, "later.txt"), "later work on main\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "later work");
  const loaded = loadRepositorySnapshot(root);
  assert.equal(loaded.previousPhase, "tagged");
  assert.equal(validateReleasePacket(loaded).phase, "tagged");
});

const PREDECESSOR_VERIFICATION_PATH = "docs/goalposts/v0.4.0/verification.md";

function successorSnapshot() {
  const snapshot = validSnapshot();
  snapshot.version = "0.4.1";
  snapshot.previousTag = "v0.4.0";
  snapshot.releasePath = "docs/goalposts/v0.4.1/release.md";
  snapshot.verificationPath = "docs/goalposts/v0.4.1/verification.md";
  snapshot.release = snapshot.release
    .replace("# colorful-language v0.4.0", "# colorful-language v0.4.1")
    .replace("Release 0.4.0 after v0.3.0", "Release 0.4.1 after v0.4.0");
  snapshot.verification = snapshot.verification
    .replace("# colorful-language v0.4.0", "# colorful-language v0.4.1")
    .replace("Target version: 0.4.0", "Target version: 0.4.1")
    .replace("Previous public tag: v0.3.0", "Previous public tag: v0.4.0")
    .replace("Annotated v0.4.0 tag:", "Annotated v0.4.1 tag:");
  return snapshot;
}

function writeSuccessorFiles(root) {
  writeRepositorySnapshot(root, successorSnapshot());
  mkdirSync(join(root, dirname(RELEASE_PATH)), { recursive: true });
  writeFileSync(join(root, RELEASE_PATH), validSnapshot().release);
}

function successorRepository(t, predecessorWitness) {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeSuccessorFiles(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "release-packet@example.invalid");
  git(root, "config", "user.name", "Release Packet Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "previous release");
  git(root, "tag", "--no-sign", "-a", "v0.3.0", "-m", "release: v0.3.0");
  writeFileSync(join(root, "predecessor-target.txt"), "predecessor\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "predecessor target");
  annotateTargetTag(root);
  const predecessorCommit = gitOutput(root, "rev-parse", "HEAD");
  writeFileSync(
    join(root, PREDECESSOR_VERIFICATION_PATH),
    predecessorWitness(predecessorCommit),
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "record the predecessor witness");
  return { root };
}

function predecessorAtPhase(phase) {
  return (predecessorCommit) =>
    (phase === "tagged"
      ? taggedVerification(validSnapshot().verification)
      : snapshotForPhase(phase).verification
    ).replace(TARGET_COMMIT, predecessorCommit);
}

test("rejects a predecessor witness that contradicts its own phase", (t) => {
  const { root } = successorRepository(
    t,
    (commit) =>
      `${predecessorAtPhase("tagged")(commit)}\nRetrospective status: completed.\n`,
  );
  assertPolicyRejection(
    () => loadRepositorySnapshot(root),
    "E_RELEASE_PACKET_EVIDENCE",
    /v0\.4\.0\/verification\.md: section 'Retrospective' contradicts its unavailable state with completed or public evidence/u,
  );
});

test("admits a predecessor witness only at a predecessor phase", (t) => {
  for (const phase of ["tagged", "verified"]) {
    const { root } = successorRepository(t, predecessorAtPhase(phase));
    assertPolicyRejection(
      () => loadRepositorySnapshot(root),
      "E_RELEASE_PACKET_EVIDENCE",
      new RegExp(
        `previous release v0\\.4\\.0 is at release phase ${phase}; a new train is admitted only after release phase: retrospected`,
        "u",
      ),
    );
  }

  const unbound = successorRepository(
    t,
    () => snapshotForPhase("retrospected").verification,
  );
  assertPolicyRejection(
    () => loadRepositorySnapshot(unbound.root),
    "E_RELEASE_PACKET_EVIDENCE",
    /must contain the full commit behind annotated tag v0\.4\.0/u,
  );

  const { root } = successorRepository(t, predecessorAtPhase("retrospected"));
  const loaded = loadRepositorySnapshot(root);
  assert.equal(loaded.previousTag, "v0.4.0");
  assert.equal(validateReleasePacket(loaded).phase, "pre-publication");
});

test("requires an earlier public tag behind a phase-machine predecessor", (t) => {
  const root = mkdtempSync(join(tmpdir(), "colorful-release-packet-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeSuccessorFiles(root);
  writeFileSync(
    join(root, PREDECESSOR_VERIFICATION_PATH),
    predecessorAtPhase("retrospected")(TARGET_COMMIT),
  );
  assertPolicyRejection(
    () => loadRepositorySnapshot(root, { publicTags: ["v0.4.0"] }),
    "E_RELEASE_PACKET_IDENTITY",
    /no public release tag precedes predecessor v0\.4\.0/u,
  );
});

test("admits the abandoned phase only from tagged and keeps it terminal", (t) => {
  for (const previousPhase of [undefined, "tagged", "abandoned"]) {
    const snapshot = snapshotForPhase("abandoned");
    snapshot.previousPhase = previousPhase;
    assert.equal(validateReleasePacket(snapshot).phase, "abandoned");
  }
  for (const previousPhase of [
    "pre-publication",
    "published",
    "verified",
    "retrospected",
  ]) {
    const snapshot = snapshotForPhase("abandoned");
    snapshot.previousPhase = previousPhase;
    assertPolicyRejection(
      () => validateReleasePacket(snapshot),
      "E_RELEASE_PACKET_EVIDENCE",
      new RegExp(
        `release phase abandoned can follow only branch-base phase tagged, not ${previousPhase}`,
        "u",
      ),
    );
  }
  for (const phase of [
    "pre-publication",
    "tagged",
    "published",
    "verified",
    "retrospected",
  ]) {
    const snapshot =
      phase === "tagged" ? taggedSnapshot() : snapshotForPhase(phase);
    snapshot.previousPhase = "abandoned";
    assertPolicyRejection(
      () => validateReleasePacket(snapshot),
      "E_RELEASE_PACKET_EVIDENCE",
      new RegExp(
        `release phase ${phase} cannot follow branch-base phase abandoned, which is terminal`,
        "u",
      ),
    );
  }

  const { root } = releaseRepository(t);
  annotateTargetTag(root);
  commitWitness(
    root,
    taggedVerification(validSnapshot().verification),
    "record the tag",
  );
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    gitOutput(root, "rev-parse", "HEAD"),
  );
  commitWitness(
    root,
    abandonedVerification(validSnapshot().verification),
    "abandon the tag",
  );
  const abandoned = loadRepositorySnapshot(root);
  assert.equal(abandoned.previousPhase, "tagged");
  assert.equal(validateReleasePacket(abandoned).phase, "abandoned");
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    gitOutput(root, "rev-parse", "HEAD"),
  );
  commitWitness(
    root,
    taggedVerification(validSnapshot().verification),
    "regress to tagged",
  );
  const regressed = loadRepositorySnapshot(root);
  assert.equal(regressed.previousPhase, "abandoned");
  assertPolicyRejection(
    () => validateReleasePacket(regressed),
    "E_RELEASE_PACKET_EVIDENCE",
    /release phase tagged cannot follow branch-base phase abandoned, which is terminal/u,
  );
});

test("requires the abandoned phase's evidence", () => {
  const appendToSection = (heading, line) => (source) =>
    replaceLevelTwoSection(
      source,
      heading,
      `${sectionBody(source, heading)}\n${line}`,
    );
  const notApplicable = (name) =>
    new RegExp(
      `section '${name}' must declare exactly one not applicable evidence state`,
      "u",
    );
  const contradicted = (name) =>
    new RegExp(
      `section '${name}' contradicts its not applicable state with completed or public evidence`,
      "u",
    );
  const oneForwardVersion =
    /section 'Retrospective' must contain exactly one 'Forward version' line/u;
  const newerForwardVersion =
    /forward version v0\.(?:4\.0|3\.9) must be newer than v0\.4\.0/u;
  const cases = [
    [
      (source) =>
        source.replace(
          "Annotated v0.4.0 tag: available.",
          "Annotated v0.4.0 tag: not available.",
        ),
      /keep annotated target tag v0\.4\.0 available during the abandoned phase/u,
    ],
    [
      (source) =>
        replaceLevelTwoSection(
          source,
          "Publication evidence",
          sectionBody(
            snapshotForPhase("published").verification,
            "Publication evidence",
          ),
        ),
      notApplicable("Publication evidence"),
    ],
    [
      (source) =>
        replaceLevelTwoSection(
          source,
          "Publication evidence",
          "Evidence state: unavailable.\n\n- Tag and registries: not available.",
        ),
      notApplicable("Publication evidence"),
    ],
    [
      appendToSection(
        "Publication evidence",
        `- Publish workflow: ${PUBLISH_WORKFLOW}.`,
      ),
      contradicted("Publication evidence"),
    ],
    [
      appendToSection(
        "Publication evidence",
        `- Tag target commit: ${TARGET_COMMIT}.`,
      ),
      contradicted("Publication evidence"),
    ],
    [
      (source) =>
        replaceLevelTwoSection(
          source,
          "Public verification",
          sectionBody(
            snapshotForPhase("verified").verification,
            "Public verification",
          ),
        ),
      notApplicable("Public verification"),
    ],
    [
      appendToSection(
        "Public verification",
        "- Verification result: passed on 2026-07-30.",
      ),
      contradicted("Public verification"),
    ],
    [
      (source) =>
        source.replace(
          "## Retrospective\n\nEvidence state: completed.",
          "## Retrospective\n\nEvidence state: unavailable.",
        ),
      /section 'Retrospective' must declare exactly one completed evidence state/u,
    ],
    [
      (source) => source.replace("Retrospective status: completed.\n\n", ""),
      /section 'Retrospective' must contain exactly one completed retrospective status/u,
    ],
    [
      (source) =>
        source.replace(
          "Retrospective status: completed.",
          "Retrospective status: completed.\n\nRetrospective status: completed.",
        ),
      /section 'Retrospective' must contain exactly one completed retrospective status/u,
    ],
    ...[
      "Planned versus actual",
      "Fallout",
      "Repeatable wins",
      "Next recommendation",
    ].map((label) => [
      (source) => source.replace(new RegExp(`^- ${label}:.*\\n?`, "mu"), ""),
      new RegExp(
        `section 'Retrospective' must contain exactly one non-empty '${label}' entry`,
        "u",
      ),
    ]),
    [
      (source) => source.replace("\n- Forward version: v0.4.1.", ""),
      oneForwardVersion,
    ],
    [
      (source) =>
        source.replace(
          "- Forward version: v0.4.1.",
          "- Forward version: v0.4.1.\n- Forward version: v0.4.2.",
        ),
      oneForwardVersion,
    ],
    [
      (source) =>
        source.replace(
          "- Forward version: v0.4.1.",
          "- Forward version: v0.4.1-rc.1.",
        ),
      /section 'Retrospective' must name its forward version as one stable vX\.Y\.Z version/u,
    ],
    [
      (source) =>
        source.replace(
          "- Forward version: v0.4.1.",
          "- Forward version: v0.4.0.",
        ),
      newerForwardVersion,
    ],
    [
      (source) =>
        source.replace(
          "- Forward version: v0.4.1.",
          "- Forward version: v0.3.9.",
        ),
      newerForwardVersion,
    ],
  ];
  for (const [mutate, message] of cases) {
    const snapshot = snapshotForPhase("abandoned");
    snapshot.verification = mutate(snapshot.verification);
    assertPolicyRejection(
      () => validateReleasePacket(snapshot),
      "E_RELEASE_PACKET_EVIDENCE",
      message,
    );
  }

  const taggedNotApplicable = taggedSnapshot();
  taggedNotApplicable.verification = replaceLevelTwoSection(
    taggedNotApplicable.verification,
    "Publication evidence",
    ABANDONED_PUBLICATION,
  );
  assertPolicyRejection(
    () => validateReleasePacket(taggedNotApplicable),
    "E_RELEASE_PACKET_EVIDENCE",
    /section 'Publication evidence' must declare exactly one unavailable evidence state/u,
  );
  const retrospectedForward = snapshotForPhase("retrospected");
  retrospectedForward.verification = retrospectedForward.verification.replace(
    "- Next recommendation: begin held-out validation.",
    "- Next recommendation: begin held-out validation.\n- Forward version: v0.4.1.",
  );
  assertPolicyRejection(
    () => validateReleasePacket(retrospectedForward),
    "E_RELEASE_PACKET_EVIDENCE",
    /only the abandoned phase names a forward version; release phase retrospected does not/u,
  );
});

test("admits the abandoned phase only while the annotated target tag resolves", (t) => {
  const abandoned = abandonedVerification(validSnapshot().verification);
  const unresolved =
    /release phase abandoned requires annotated tag v0\.4\.0 to resolve/u;

  const annotated = releaseRepository(t);
  annotateTargetTag(annotated.root);
  commitWitness(annotated.root, abandoned, "abandon the tag");
  assert.equal(
    validateReleasePacket(loadRepositorySnapshot(annotated.root)).phase,
    "abandoned",
  );

  const absent = releaseRepository(t);
  commitWitness(absent.root, abandoned, "abandon an absent tag");
  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(absent.root)),
    "E_RELEASE_PACKET_EVIDENCE",
    unresolved,
  );

  const lightweight = releaseRepository(t);
  git(lightweight.root, "tag", "--no-sign", "v0.4.0");
  commitWitness(lightweight.root, abandoned, "abandon a lightweight tag");
  assertPolicyRejection(
    () => validateReleasePacket(loadRepositorySnapshot(lightweight.root)),
    "E_RELEASE_PACKET_EVIDENCE",
    unresolved,
  );
});

test("admits an abandoned predecessor only with its retrospective and forward version", (t) => {
  const { root } = successorRepository(t, predecessorAtPhase("abandoned"));
  const loaded = loadRepositorySnapshot(root);
  assert.equal(loaded.previousTag, "v0.4.0");
  assert.equal(validateReleasePacket(loaded).phase, "pre-publication");

  for (const [mutate, message] of [
    [
      (source) =>
        source.replace(
          "## Retrospective\n\nEvidence state: completed.",
          "## Retrospective\n\nEvidence state: unavailable.",
        ),
      /v0\.4\.0\/verification\.md: section 'Retrospective' must declare exactly one completed evidence state/u,
    ],
    [
      (source) => source.replace("\n- Forward version: v0.4.1.", ""),
      /v0\.4\.0\/verification\.md: section 'Retrospective' must contain exactly one 'Forward version' line/u,
    ],
  ]) {
    const incomplete = successorRepository(t, (commit) =>
      mutate(predecessorAtPhase("abandoned")(commit)),
    );
    assertPolicyRejection(
      () => loadRepositorySnapshot(incomplete.root),
      "E_RELEASE_PACKET_EVIDENCE",
      message,
    );
  }
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
    .find((entry) => entry.startsWith("**Tagged v0.4.0:**"));
  assert.ok(plannedEntry, "docs/README.md must list tagged v0.4.0");
  assert.match(plannedEntry, /\(goalposts\/v0\.4\.0\/release\.md\)/u);
  assert.match(
    plannedEntry,
    /\(goalposts\/v0\.4\.0\/verification\.md\)/u,
  );
  assert.match(plannedEntry, /\bis tagged and has not been published\b/u);
});
