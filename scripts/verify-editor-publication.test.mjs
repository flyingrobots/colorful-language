import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EditorPublicationError,
  marketplacePackageUrl,
  openVsxMetadataUrl,
  verifyEditorPublication,
} from "./verify-editor-publication.mjs";

const VERSION = "0.4.0";
const PACKAGE = Buffer.from("exact-vsix-bytes");
const OPEN_VSX_DOWNLOAD =
  "https://open-vsx.org/api/flyingrobots/colorful-language/0.4.0/file/flyingrobots.colorful-language-0.4.0.vsix";

function metadata(download = OPEN_VSX_DOWNLOAD) {
  return Buffer.from(
    JSON.stringify({
      namespace: "flyingrobots",
      name: "colorful-language",
      version: VERSION,
      files: { download },
    }),
  );
}

function response(body, status = 200) {
  return new Response(body, { status });
}

async function withVsix(run) {
  const directory = mkdtempSync(join(tmpdir(), "colorful-editor-publish-"));
  const vsixPath = join(directory, "colorful-language-0.4.0.vsix");
  writeFileSync(vsixPath, PACKAGE);
  try {
    return await run(vsixPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("accepts exact bytes from both public registries", async () => {
  await withVsix(async (vsixPath) => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(String(url));
      if (url === marketplacePackageUrl(VERSION)) {
        return response(PACKAGE);
      }
      if (url === openVsxMetadataUrl(VERSION)) {
        return response(metadata());
      }
      if (url === OPEN_VSX_DOWNLOAD) {
        return response(PACKAGE);
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await verifyEditorPublication({
      vsixPath,
      version: VERSION,
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(result.extension, "flyingrobots.colorful-language@0.4.0");
    assert.deepEqual(result.channels, [
      "visual-studio-marketplace",
      "open-vsx",
    ]);
    assert.equal(result.sha256.length, 64);
    assert.deepEqual(requested, [
      marketplacePackageUrl(VERSION),
      openVsxMetadataUrl(VERSION),
      OPEN_VSX_DOWNLOAD,
    ]);
  });
});

test("rejects a pre-existing Marketplace version with different bytes", async () => {
  await withVsix(async (vsixPath) => {
    await assert.rejects(
      verifyEditorPublication({
        vsixPath,
        version: VERSION,
        fetchImpl: async () => response("different-vsix"),
        sleep: async () => {},
      }),
      (error) =>
        error instanceof EditorPublicationError &&
        error.code === "E_EDITOR_PUBLICATION_DIGEST" &&
        /visual-studio-marketplace/u.test(error.message),
    );
  });
});

test("retries bounded eventual publication without accepting another status", async () => {
  await withVsix(async (vsixPath) => {
    const sleeps = [];
    let marketplaceAttempts = 0;
    const fetchImpl = async (url) => {
      if (url === marketplacePackageUrl(VERSION)) {
        marketplaceAttempts += 1;
        return marketplaceAttempts === 1
          ? response("pending", 404)
          : response(PACKAGE);
      }
      if (url === openVsxMetadataUrl(VERSION)) {
        return response(metadata());
      }
      return response(PACKAGE);
    };

    await verifyEditorPublication({
      vsixPath,
      version: VERSION,
      attempts: 2,
      fetchImpl,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    });
    assert.equal(marketplaceAttempts, 2);
    assert.deepEqual(sleeps, [15_000]);
  });
});

test("default retry budget covers delayed Marketplace propagation", async () => {
  await withVsix(async (vsixPath) => {
    const sleeps = [];
    let marketplaceAttempts = 0;
    const fetchImpl = async (url) => {
      if (url === marketplacePackageUrl(VERSION)) {
        marketplaceAttempts += 1;
        return marketplaceAttempts < 60
          ? response("pending", 404)
          : response(PACKAGE);
      }
      if (url === openVsxMetadataUrl(VERSION)) {
        return response(metadata());
      }
      return response(PACKAGE);
    };

    await verifyEditorPublication({
      vsixPath,
      version: VERSION,
      fetchImpl,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    });
    assert.equal(marketplaceAttempts, 60);
    assert.equal(sleeps.length, 59);
    assert.equal(sleeps.every((milliseconds) => milliseconds === 15_000), true);
  });
});

test("reports the actual attempt count for a non-retryable response", async () => {
  await withVsix(async (vsixPath) => {
    let requests = 0;
    await assert.rejects(
      verifyEditorPublication({
        vsixPath,
        version: VERSION,
        fetchImpl: async () => {
          requests += 1;
          return response("unauthorized", 401);
        },
        sleep: async () => {},
      }),
      (error) =>
        error instanceof EditorPublicationError &&
        error.code === "E_EDITOR_PUBLICATION_FETCH" &&
        /after 1 attempt \(/u.test(error.message),
    );
    assert.equal(requests, 1);
  });
});

test("rejects and cancels an oversized registry response", async () => {
  await withVsix(async (vsixPath) => {
    let cancelled = false;
    const oversizedMetadata = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const fetchImpl = async (url) =>
      url === marketplacePackageUrl(VERSION)
        ? response(PACKAGE)
        : oversizedMetadata;

    await assert.rejects(
      verifyEditorPublication({
        vsixPath,
        version: VERSION,
        fetchImpl,
        sleep: async () => {},
      }),
      (error) =>
        error instanceof EditorPublicationError &&
        error.code === "E_EDITOR_PUBLICATION_FETCH" &&
        /response exceeds 1048576 bytes/u.test(error.message),
    );
    assert.equal(cancelled, true);
  });
});

test("rejects missing and empty local VSIX inputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "colorful-editor-input-"));
  const missing = join(directory, "missing.vsix");
  const empty = join(directory, "empty.vsix");
  writeFileSync(empty, "");
  try {
    for (const vsixPath of [missing, empty]) {
      await assert.rejects(
        verifyEditorPublication({
          vsixPath,
          version: VERSION,
          fetchImpl: async () => {
            throw new Error("network access must not occur");
          },
          sleep: async () => {},
        }),
        (error) =>
          error instanceof EditorPublicationError &&
          error.code === "E_EDITOR_PUBLICATION_INPUT",
        `${vsixPath} must fail before registry access`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects Open VSX metadata that redirects outside the requested version", async () => {
  await withVsix(async (vsixPath) => {
    const fetchImpl = async (url) => {
      if (url === marketplacePackageUrl(VERSION)) {
        return response(PACKAGE);
      }
      return response(metadata("https://example.com/untrusted.vsix"));
    };
    await assert.rejects(
      verifyEditorPublication({
        vsixPath,
        version: VERSION,
        fetchImpl,
        sleep: async () => {},
      }),
      (error) =>
        error instanceof EditorPublicationError &&
        error.code === "E_EDITOR_PUBLICATION_METADATA",
    );
  });
});

test("rejects malformed publication-verifier CLI arguments", () => {
  for (const argv of [
    [],
    ["--vsix", "artifact.vsix"],
    ["--version", VERSION],
    ["--version", VERSION, "--version", VERSION],
    ["--unknown", "value", "--vsix", "artifact.vsix"],
    ["--version", "", "--vsix", "artifact.vsix"],
    ["--version", VERSION, "--vsix"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-editor-publication.mjs", ...argv],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, JSON.stringify(argv));
    assert.match(
      result.stderr,
      /^E_EDITOR_PUBLICATION_USAGE: usage:/u,
      JSON.stringify(argv),
    );
  }
});
