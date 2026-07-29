import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPOSITORY = "flyingrobots/colorful-language";
const RELEASE_BASE_URL = `https://github.com/${REPOSITORY}/releases/download`;
const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const PLATFORMS = Object.freeze({
  linuxX64: "x86_64-unknown-linux-gnu",
  macosArm64: "aarch64-apple-darwin",
});

export class HomebrewFormulaError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "HomebrewFormulaError";
    this.code = code;
  }
}

function requireVersion(version) {
  if (typeof version !== "string" || !STABLE_VERSION.test(version)) {
    throw new HomebrewFormulaError(
      "invalid-version",
      "version must be a stable canonical SemVer value",
    );
  }
  return version;
}

function requireChecksum(checksum, platform) {
  if (typeof checksum !== "string" || !SHA256.test(checksum)) {
    throw new HomebrewFormulaError(
      "invalid-checksum",
      `${platform} checksum must be 64 lowercase hexadecimal characters`,
    );
  }
  return checksum;
}

function archiveName(version, target) {
  return `colorful-language-v${version}-${target}.tar.gz`;
}

export function parseChecksumSidecar(source, expectedArchive) {
  if (typeof source !== "string" || typeof expectedArchive !== "string") {
    throw new HomebrewFormulaError(
      "invalid-sidecar",
      "sidecar source and expected archive must be strings",
    );
  }
  const match = source.match(/^([0-9a-f]{64}) {2}([^\r\n]+)\n$/u);
  if (match === null || match[2] !== expectedArchive) {
    throw new HomebrewFormulaError(
      "invalid-sidecar",
      `sidecar must name exactly ${expectedArchive}`,
    );
  }
  return match[1];
}

export function renderHomebrewFormula({
  linuxX64Sha256,
  macosArm64Sha256,
  version,
}) {
  const releaseVersion = requireVersion(version);
  const linuxChecksum = requireChecksum(linuxX64Sha256, "linux-x86-64");
  const macosChecksum = requireChecksum(macosArm64Sha256, "macos-arm64");
  const tag = `v${releaseVersion}`;
  const linuxArchive = archiveName(releaseVersion, PLATFORMS.linuxX64);
  const macosArchive = archiveName(releaseVersion, PLATFORMS.macosArm64);

  return `class Colorful < Formula
  desc "Deterministic English structure coloring and prose linting"
  homepage "https://github.com/flyingrobots/colorful-language"
  version "${releaseVersion}"
  license "MIT"

  on_macos do
    on_arm do
      url "${RELEASE_BASE_URL}/${tag}/${macosArchive}"
      sha256 "${macosChecksum}"
    end
  end

  on_linux do
    on_intel do
      url "${RELEASE_BASE_URL}/${tag}/${linuxArchive}"
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
}

async function checksumFromDist(distDir, version, target) {
  const archive = archiveName(version, target);
  const archivePath = path.join(distDir, archive);
  const sidecar = path.join(distDir, `${archive}.sha256`);
  let source;
  try {
    source = await readFile(sidecar, "utf8");
  } catch (error) {
    const code = error.code === "ENOENT"
      ? "missing-sidecar"
      : "unreadable-sidecar";
    throw new HomebrewFormulaError(
      code,
      `${sidecar}: ${error.code ?? "read-failed"}`,
    );
  }
  const expected = parseChecksumSidecar(source, archive);
  const observed = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(archivePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (error) => {
      const code = error.code === "ENOENT"
        ? "missing-archive"
        : "unreadable-archive";
      reject(
        new HomebrewFormulaError(
          code,
          `${archivePath}: ${error.code ?? "read-failed"}`,
        ),
      );
    });
  });
  if (observed !== expected) {
    throw new HomebrewFormulaError(
      "checksum-mismatch",
      `${archive} does not match its SHA-256 sidecar`,
    );
  }
  return expected;
}

export async function generateHomebrewFormula({ distDir, version }) {
  const releaseVersion = requireVersion(version);
  if (typeof distDir !== "string" || distDir.length === 0) {
    throw new HomebrewFormulaError(
      "invalid-dist-dir",
      "distribution directory must be a non-empty path",
    );
  }
  const linuxX64Sha256 = await checksumFromDist(
    distDir,
    releaseVersion,
    PLATFORMS.linuxX64,
  );
  const macosArm64Sha256 = await checksumFromDist(
    distDir,
    releaseVersion,
    PLATFORMS.macosArm64,
  );
  return renderHomebrewFormula({
    linuxX64Sha256,
    macosArm64Sha256,
    version: releaseVersion,
  });
}

function parseArguments(argv) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--version" ||
    argv[2] !== "--dist-dir"
  ) {
    throw new HomebrewFormulaError(
      "usage",
      "generate-homebrew-formula.mjs --version X.Y.Z --dist-dir PATH",
    );
  }
  return { distDir: argv[3], version: argv[1] };
}

async function main() {
  const formula = await generateHomebrewFormula(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(formula);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const message =
      error instanceof Error ? error.message : "unexpected non-error failure";
    process.stderr.write(`generate-homebrew-formula failed: ${message}\n`);
    process.exitCode = 1;
  });
}
