import assert from "node:assert/strict";
import test from "node:test";

import {
  ReleasePacketPolicyError,
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

Pre-publication planning only.

## Pre-publication evidence

- Release preparation: pending.

## Publication evidence

- Tag and registries: not available.

## Public verification

- Clean installation and public URLs: not available.

## Retrospective

- Release retrospective: not available.
`,
  };
}

test("rejects a release packet without a thesis", () => {
  const snapshot = validSnapshot();
  snapshot.release = snapshot.release.replace(
    "Ship the reviewed product-maturity work through normal public channels.",
    "",
  );
  assert.throws(
    () => validateReleasePacket(snapshot),
    (error) =>
      error instanceof ReleasePacketPolicyError &&
      error.code === "E_RELEASE_PACKET_SECTION",
  );
});
