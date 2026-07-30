import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
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
  validateReleasePacket,
} from "./check-release-packet.mjs";

const RELEASE_PATH = "docs/goalposts/v0.4.0/release.md";
const VERIFICATION_PATH = "docs/goalposts/v0.4.0/verification.md";

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

- The complete release-preparation gate passes before tagging.
`,
    verificationPath: VERIFICATION_PATH,
    verification: `# colorful-language v0.4.0 — Verification Witness

## Status

Release phase: pre-publication.

## Pre-publication evidence

- Release preparation: pending.

## Publication evidence

- Tag and registries: not available.

## Public verification

- Clean installation and public URLs: not available.

## Retrospective

- Release retrospective: not available.
`,
    gateSources: {
      ".github/workflows/ci.yml":
        `${SELF_TEST_COMMAND}\n${CHECK_COMMAND}\n`,
      ".github/workflows/release.yml":
        `${SELF_TEST_COMMAND}\n${CHECK_COMMAND}\n`,
      "scripts/release-prep.sh":
        `${SELF_TEST_COMMAND}\n${CHECK_COMMAND}\n`,
    },
  };
}

function expectCode(mutate, code) {
  const snapshot = validSnapshot();
  mutate(snapshot);
  assert.throws(
    () => validateReleasePacket(snapshot),
    (error) =>
      error instanceof ReleasePacketPolicyError && error.code === code,
  );
}

function writeRepositorySnapshot(root, snapshot = validSnapshot()) {
  const sources = {
    "Cargo.toml": `[workspace.package]\nversion = "${snapshot.version}"\n`,
    [snapshot.releasePath]: snapshot.release,
    [snapshot.verificationPath]: snapshot.verification,
    "docs/goalposts/v0.3.0/release.md": "released\n",
    "docs/goalposts/v0.3.0/verification.md": "verified\n",
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

test("rejects a scoped issue omitted from the slice inventory", () => {
  expectCode((snapshot) => {
    snapshot.release = snapshot.release.replace(
      "- [#37](https://github.com/flyingrobots/colorful-language/issues/37) — Homebrew follow-up.\n",
      "",
    );
  }, "E_RELEASE_PACKET_SCOPE");
});

test("rejects every missing verification section", () => {
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

test("requires the self-test before the live check in every release gate", () => {
  for (const gate of Object.keys(validSnapshot().gateSources)) {
    expectCode((snapshot) => {
      snapshot.gateSources[gate] = CHECK_COMMAND;
    }, "E_RELEASE_PACKET_GATE");
    expectCode((snapshot) => {
      snapshot.gateSources[gate] =
        `# ${SELF_TEST_COMMAND}\n# ${CHECK_COMMAND}\n`;
    }, "E_RELEASE_PACKET_GATE");
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
    "verified\n",
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
