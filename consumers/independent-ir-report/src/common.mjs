import { createHash } from "node:crypto";

export class ConsumerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConsumerError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new ConsumerError(code, message);
}

export function parseJson(text, code = "E_JSON") {
  try {
    return JSON.parse(text);
  } catch {
    fail(code, "input is not valid JSON");
  }
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("E_SOURCE_UTF8", "source is not valid UTF-8");
  }
}

export function sha256(value) {
  const hash = createHash("sha256");
  hash.update(value, typeof value === "string" ? "utf8" : undefined);
  return `sha256:${hash.digest("hex")}`;
}

export function utf8Boundaries(source) {
  const boundaries = new Set([0]);
  let offset = 0;
  for (const scalar of source) {
    offset += Buffer.byteLength(scalar, "utf8");
    boundaries.add(offset);
  }
  return boundaries;
}

export function sourceSlice(source, start, end) {
  return Buffer.from(source, "utf8").subarray(start, end).toString("utf8");
}

function markdownCode(text) {
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(
    1 + runs.reduce((maximum, run) => Math.max(maximum, run.length), 0),
  );
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

export function normalizeSpans(source, spans, code) {
  const boundaries = utf8Boundaries(source);
  const sourceLength = Buffer.byteLength(source, "utf8");
  let previousEnd = 0;
  return spans.map((span, index) => {
    if (
      !Number.isSafeInteger(span.startUtf8) ||
      !Number.isSafeInteger(span.endUtf8) ||
      span.startUtf8 < previousEnd ||
      span.startUtf8 >= span.endUtf8 ||
      span.endUtf8 > sourceLength ||
      !boundaries.has(span.startUtf8) ||
      !boundaries.has(span.endUtf8) ||
      typeof span.role !== "string"
    ) {
      fail(code, `invalid or unordered span at index ${index}`);
    }
    previousEnd = span.endUtf8;
    return {
      startUtf8: span.startUtf8,
      endUtf8: span.endUtf8,
      text: sourceSlice(source, span.startUtf8, span.endUtf8),
      role: span.role,
    };
  });
}

export function renderReport(spans) {
  const lines = [
    "# Highlight spans",
    "",
    "| UTF-8 bytes | Text | Role |",
    "| --- | --- | --- |",
  ];
  for (const span of spans) {
    lines.push(
      `| ${markdownCode(`${span.startUtf8}..${span.endUtf8}`)} | ` +
        `${markdownCode(span.text)} | ${markdownCode(span.role)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
