import assert from "node:assert/strict";
import test from "node:test";

import {
  HomebrewFormulaError,
  parseChecksumSidecar,
  renderHomebrewFormula,
} from "./generate-homebrew-formula.mjs";

const linuxChecksum = "a".repeat(64);
const macosChecksum = "b".repeat(64);

const expectedFormula = `class Colorful < Formula
  desc "Deterministic English structure coloring and prose linting"
  homepage "https://github.com/flyingrobots/colorful-language"
  version "0.4.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/flyingrobots/colorful-language/releases/download/v0.4.0/colorful-language-v0.4.0-aarch64-apple-darwin.tar.gz"
      sha256 "${macosChecksum}"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/flyingrobots/colorful-language/releases/download/v0.4.0/colorful-language-v0.4.0-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "${linuxChecksum}"
    end
  end

  def install
    bin.install "colorful"
    bin.install "colorful-lsp"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/colorful --version")
    assert_predicate bin/"colorful-lsp", :executable?
  end
end
`;

function assertFormulaError(action, code) {
  assert.throws(
    action,
    (error) =>
      error instanceof HomebrewFormulaError &&
      error.code === code &&
      error.message.startsWith(`${code}: `),
  );
}

test("renders exact synchronized Homebrew formula bytes", () => {
  assert.equal(
    renderHomebrewFormula({
      linuxX64Sha256: linuxChecksum,
      macosArm64Sha256: macosChecksum,
      version: "0.4.0",
    }),
    expectedFormula,
  );
});

test("rejects malformed and non-release versions", () => {
  for (const version of [
    "",
    "v0.4.0",
    "0.4",
    "0.4.0-rc.1",
    "0.4.0\nsystem('false')",
  ]) {
    assertFormulaError(
      () =>
        renderHomebrewFormula({
          linuxX64Sha256: linuxChecksum,
          macosArm64Sha256: macosChecksum,
          version,
        }),
      "invalid-version",
    );
  }
});

test("rejects missing or malformed platform checksums", () => {
  for (const [field, checksum] of [
    ["linuxX64Sha256", undefined],
    ["linuxX64Sha256", "A".repeat(64)],
    ["linuxX64Sha256", "a".repeat(63)],
    ["macosArm64Sha256", undefined],
    ["macosArm64Sha256", "g".repeat(64)],
    ["macosArm64Sha256", `${"b".repeat(64)} extra`],
  ]) {
    const input = {
      linuxX64Sha256: linuxChecksum,
      macosArm64Sha256: macosChecksum,
      version: "0.4.0",
    };
    input[field] = checksum;
    assertFormulaError(() => renderHomebrewFormula(input), "invalid-checksum");
  }
});

test("accepts the exact native checksum sidecar identity", () => {
  const archive =
    "colorful-language-v0.4.0-aarch64-apple-darwin.tar.gz";
  assert.equal(
    parseChecksumSidecar(`${macosChecksum}  ${archive}\n`, archive),
    macosChecksum,
  );
});

test("rejects malformed or mismatched checksum sidecars", () => {
  const archive =
    "colorful-language-v0.4.0-aarch64-apple-darwin.tar.gz";
  for (const source of [
    "",
    `${macosChecksum}  other.tar.gz\n`,
    `${macosChecksum}  ../${archive}\n`,
    `${macosChecksum} ${archive}\n`,
    `${macosChecksum}  ${archive}\nextra\n`,
    `${"B".repeat(64)}  ${archive}\n`,
  ]) {
    assertFormulaError(
      () => parseChecksumSidecar(source, archive),
      "invalid-sidecar",
    );
  }
});
