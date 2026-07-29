#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLISHER = "flyingrobots";
const EXTENSION = "colorful-language";
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_VSIX_BYTES = 32 * 1024 * 1024;
const DEFAULT_ATTEMPTS = 12;
const RETRY_DELAY_MS = 10_000;
const VERSION = /^\d+\.\d+\.\d+$/u;

export class EditorPublicationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EditorPublicationError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new EditorPublicationError(code, message);
}

function requireVersion(version) {
  if (typeof version !== "string" || !VERSION.test(version)) {
    reject(
      "E_EDITOR_PUBLICATION_USAGE",
      `version must be stable major.minor.patch, got ${JSON.stringify(version)}`,
    );
  }
  return version;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function responseBytes(response, maximum, context) {
  if (response.body === null) {
    reject("E_EDITOR_PUBLICATION_FETCH", `${context}: response body is absent`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      reject(
        "E_EDITOR_PUBLICATION_FETCH",
        `${context}: response exceeds ${maximum} bytes`,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

function isRetryableStatus(status) {
  return status === 404 || status === 429 || status >= 500;
}

async function fetchAvailable(
  url,
  {
    attempts,
    context,
    fetchImpl,
    maximum,
    sleep,
  },
) {
  let lastFailure = "no response";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          "accept-encoding": "identity",
          "user-agent": "colorful-language-release-verifier",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        return responseBytes(response, maximum, context);
      }
      lastFailure = `HTTP ${response.status}`;
      await response.body?.cancel();
      if (!isRetryableStatus(response.status)) {
        break;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      await sleep(RETRY_DELAY_MS);
    }
  }
  reject(
    "E_EDITOR_PUBLICATION_FETCH",
    `${context}: unavailable after ${attempts} attempts (${lastFailure})`,
  );
}

export function marketplacePackageUrl(version) {
  requireVersion(version);
  return (
    "https://marketplace.visualstudio.com/_apis/public/gallery/" +
    `publishers/${PUBLISHER}/vsextensions/${EXTENSION}/${version}/vspackage`
  );
}

export function openVsxMetadataUrl(version) {
  requireVersion(version);
  return `https://open-vsx.org/api/${PUBLISHER}/${EXTENSION}/${version}`;
}

function openVsxDownloadUrl(metadata, version) {
  let parsed;
  try {
    parsed = JSON.parse(metadata.toString("utf8"));
  } catch (error) {
    reject(
      "E_EDITOR_PUBLICATION_METADATA",
      `Open VSX metadata is not JSON: ${error.message}`,
    );
  }
  if (
    parsed?.namespace !== PUBLISHER ||
    parsed?.name !== EXTENSION ||
    parsed?.version !== version ||
    typeof parsed?.files?.download !== "string"
  ) {
    reject(
      "E_EDITOR_PUBLICATION_METADATA",
      "Open VSX metadata does not identify the requested extension version",
    );
  }

  let download;
  try {
    download = new URL(parsed.files.download);
  } catch {
    reject(
      "E_EDITOR_PUBLICATION_METADATA",
      "Open VSX download URL is invalid",
    );
  }
  const expectedPrefix =
    `/api/${PUBLISHER}/${EXTENSION}/${version}/file/`;
  if (
    download.protocol !== "https:" ||
    download.hostname !== "open-vsx.org" ||
    !download.pathname.startsWith(expectedPrefix) ||
    !download.pathname.endsWith(".vsix")
  ) {
    reject(
      "E_EDITOR_PUBLICATION_METADATA",
      "Open VSX download URL is outside the requested registry version",
    );
  }
  return download.href;
}

function localVsix(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch (error) {
    reject(
      "E_EDITOR_PUBLICATION_INPUT",
      `${path}: ${error.message}`,
    );
  }
  if (size <= 0 || size > MAX_VSIX_BYTES) {
    reject(
      "E_EDITOR_PUBLICATION_INPUT",
      `${path}: expected 1-${MAX_VSIX_BYTES} bytes, observed ${size}`,
    );
  }
  return readFileSync(path);
}

function assertDigest(channel, bytes, expectedDigest) {
  const actualDigest = sha256(bytes);
  if (actualDigest !== expectedDigest) {
    reject(
      "E_EDITOR_PUBLICATION_DIGEST",
      `${channel}: expected ${expectedDigest}, observed ${actualDigest}`,
    );
  }
}

export async function verifyEditorPublication({
  vsixPath,
  version,
  attempts = DEFAULT_ATTEMPTS,
  fetchImpl = fetch,
  sleep = (milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
}) {
  requireVersion(version);
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    reject(
      "E_EDITOR_PUBLICATION_USAGE",
      "attempts must be a positive safe integer",
    );
  }
  const expectedDigest = sha256(localVsix(vsixPath));

  const marketplace = await fetchAvailable(
    marketplacePackageUrl(version),
    {
      attempts,
      context: "Visual Studio Marketplace package",
      fetchImpl,
      maximum: MAX_VSIX_BYTES,
      sleep,
    },
  );
  assertDigest("visual-studio-marketplace", marketplace, expectedDigest);

  const metadata = await fetchAvailable(openVsxMetadataUrl(version), {
    attempts,
    context: "Open VSX metadata",
    fetchImpl,
    maximum: MAX_METADATA_BYTES,
    sleep,
  });
  const openVsxUrl = openVsxDownloadUrl(metadata, version);
  const openVsx = await fetchAvailable(openVsxUrl, {
    attempts,
    context: "Open VSX package",
    fetchImpl,
    maximum: MAX_VSIX_BYTES,
    sleep,
  });
  assertDigest("open-vsx", openVsx, expectedDigest);

  return {
    extension: `${PUBLISHER}.${EXTENSION}@${version}`,
    sha256: expectedDigest,
    channels: ["visual-studio-marketplace", "open-vsx"],
  };
}

function parseArguments(argv) {
  if (argv.length !== 4) {
    reject(
      "E_EDITOR_PUBLICATION_USAGE",
      "usage: scripts/verify-editor-publication.mjs --vsix PATH --version X.Y.Z",
    );
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      !["--version", "--vsix"].includes(option) ||
      values.has(option) ||
      typeof value !== "string" ||
      value === ""
    ) {
      reject(
        "E_EDITOR_PUBLICATION_USAGE",
        "usage: scripts/verify-editor-publication.mjs --vsix PATH --version X.Y.Z",
      );
    }
    values.set(option, value);
  }
  if (!values.has("--version") || !values.has("--vsix")) {
    reject(
      "E_EDITOR_PUBLICATION_USAGE",
      "usage: scripts/verify-editor-publication.mjs --vsix PATH --version X.Y.Z",
    );
  }
  return {
    version: values.get("--version"),
    vsixPath: resolve(values.get("--vsix")),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyEditorPublication(
      parseArguments(process.argv.slice(2)),
    );
    process.stdout.write(
      `verify-editor-publication: ${result.sha256} matches ${result.channels.join(", ")}\n`,
    );
  } catch (error) {
    const code = error?.code ?? "E_EDITOR_PUBLICATION";
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
