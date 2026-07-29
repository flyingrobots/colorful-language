import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  generateHomebrewFormula,
  HomebrewFormulaError,
  parseChecksumSidecar,
  renderHomebrewFormula,
} from "./generate-homebrew-formula.mjs";

const linuxChecksum = "a".repeat(64);
const macosChecksum = "b".repeat(64);
const version = "0.4.0";
const archiveTargets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-apple-darwin",
];

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

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withReleaseArchives(action) {
  const distDir = await mkdtemp(
    path.join(tmpdir(), "colorful-homebrew-formula-"),
  );
  try {
    for (const target of archiveTargets) {
      const archive = `colorful-language-v${version}-${target}.tar.gz`;
      const bytes = Buffer.from(`fixture:${target}\n`, "utf8");
      await writeFile(path.join(distDir, archive), bytes);
      await writeFile(
        path.join(distDir, `${archive}.sha256`),
        `${digest(bytes)}  ${archive}\n`,
        "utf8",
      );
    }
    return await action(distDir);
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
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

test("loads checksums only after verifying the exact native archives", async () => {
  await withReleaseArchives(async (distDir) => {
    const formula = await generateHomebrewFormula({ distDir, version });
    for (const target of archiveTargets) {
      assert.match(
        formula,
        new RegExp(
          `colorful-language-v0\\.4\\.0-${target}\\.tar\\.gz`,
          "u",
        ),
      );
    }
  });
});

test("rejects missing native archives even when a sidecar exists", async () => {
  await withReleaseArchives(async (distDir) => {
    const target = archiveTargets[0];
    const archive = `colorful-language-v${version}-${target}.tar.gz`;
    await rm(path.join(distDir, archive));
    await assert.rejects(
      generateHomebrewFormula({ distDir, version }),
      (error) =>
        error instanceof HomebrewFormulaError &&
        error.code === "missing-archive",
    );
  });
});

test("rejects native bytes that do not match their sidecar", async () => {
  await withReleaseArchives(async (distDir) => {
    const target = archiveTargets[1];
    const archive = `colorful-language-v${version}-${target}.tar.gz`;
    await writeFile(path.join(distDir, archive), "mutated archive\n", "utf8");
    await assert.rejects(
      generateHomebrewFormula({ distDir, version }),
      (error) =>
        error instanceof HomebrewFormulaError &&
        error.code === "checksum-mismatch",
    );
  });
});

test("reports invalid release inputs in fixed platform order", async () => {
  const distDir = await mkdtemp(
    path.join(tmpdir(), "colorful-homebrew-order-"),
  );
  try {
    const linuxArchive =
      `colorful-language-v${version}-${archiveTargets[0]}.tar.gz`;
    await writeFile(
      path.join(distDir, `${linuxArchive}.sha256`),
      Buffer.alloc(16 * 1024 * 1024, "x"),
    );
    await assert.rejects(
      generateHomebrewFormula({ distDir, version }),
      (error) =>
        error instanceof HomebrewFormulaError &&
        error.code === "invalid-sidecar" &&
        error.message.includes(linuxArchive),
    );
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
});

test("the CLI emits the verified formula on stdout only", async () => {
  await withReleaseArchives(async (distDir) => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(import.meta.dirname, "generate-homebrew-formula.mjs"),
        "--version",
        version,
        "--dist-dir",
        distDir,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^class Colorful < Formula\n/u);
    assert.match(result.stdout, /\nend\n$/u);
  });
});
