import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";

import {
  EditorPublicationError,
  githubReleaseVsixUrl,
  verifyEditorPublication,
} from "./verify-editor-publication.mjs";

const VERSION = "0.4.0";
const PACKAGE = Buffer.from("exact-vsix-bytes");

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

test("accepts exact bytes from the public GitHub Release asset", async () => {
  await withVsix(async (vsixPath) => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(String(url));
      return response(PACKAGE);
    };

    const result = await verifyEditorPublication({
      vsixPath,
      version: VERSION,
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(result.extension, "flyingrobots.colorful-language@0.4.0");
    assert.deepEqual(result.channels, ["github-release"]);
    assert.equal(result.sha256.length, 64);
    assert.deepEqual(requested, [githubReleaseVsixUrl(VERSION)]);
    assert.equal(
      requested[0],
      "https://github.com/flyingrobots/colorful-language/releases/download/" +
        "v0.4.0/colorful-language-0.4.0.vsix",
    );
  });
});

test("hashes decoded VSIX bytes from an encoded release response", async () => {
  const compressed = gzipSync(PACKAGE);
  const server = createServer((request, responseStream) => {
    assert.equal(request.url, "/colorful-language-0.4.0.vsix");
    responseStream.writeHead(200, {
      "content-encoding": "gzip",
      "content-length": String(compressed.byteLength),
      "content-type": "application/octet-stream",
    });
    responseStream.end(compressed);
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    await withVsix(async (vsixPath) => {
      const result = await verifyEditorPublication({
        vsixPath,
        version: VERSION,
        fetchImpl: async () =>
          fetch(
            `http://127.0.0.1:${String(address.port)}/` +
              "colorful-language-0.4.0.vsix",
          ),
        sleep: async () => {},
      });
      assert.deepEqual(result.channels, ["github-release"]);
    });
  } finally {
    await new Promise((resolveClose, rejectClose) =>
      server.close((error) =>
        error === undefined ? resolveClose() : rejectClose(error),
      ),
    );
  }
});

test("rejects a GitHub Release VSIX with different bytes", async () => {
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
        /github-release/u.test(error.message),
    );
  });
});

test("retries bounded eventual GitHub Release propagation", async () => {
  await withVsix(async (vsixPath) => {
    const sleeps = [];
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return attempts === 1 ? response("pending", 404) : response(PACKAGE);
    };

    await verifyEditorPublication({
      vsixPath,
      version: VERSION,
      attempts: 2,
      fetchImpl,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    });
    assert.equal(attempts, 2);
    assert.deepEqual(sleeps, [15_000]);
  });
});

test("default retry budget covers delayed GitHub Release propagation", async () => {
  await withVsix(async (vsixPath) => {
    const sleeps = [];
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return attempts < 60 ? response("pending", 404) : response(PACKAGE);
    };

    await verifyEditorPublication({
      vsixPath,
      version: VERSION,
      fetchImpl,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    });
    assert.equal(attempts, 60);
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

test("rejects and cancels an oversized release asset", async () => {
  await withVsix(async (vsixPath) => {
    let cancelled = false;
    const oversized = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await assert.rejects(
      verifyEditorPublication({
        vsixPath,
        version: VERSION,
        fetchImpl: async () => oversized,
        sleep: async () => {},
      }),
      (error) =>
        error instanceof EditorPublicationError &&
        error.code === "E_EDITOR_PUBLICATION_FETCH" &&
        /response exceeds 33554432 bytes/u.test(error.message),
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
        `${vsixPath} must fail before release access`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
