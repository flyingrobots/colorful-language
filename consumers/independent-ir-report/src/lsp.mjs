import {
  fail,
  isRecord,
  normalizeSpans,
  parseJson,
  renderReport,
} from "./common.mjs";

export const LSP_ERROR_CODES = Object.freeze([
  "E_LSP_JSON",
  "E_LSP_SHAPE",
  "E_LSP_VERSION",
  "E_LSP_LEGEND",
  "E_LSP_POSITION",
]);

function sourceLines(source) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r" || source[index] === "\n") {
      lines.push({
        text: source.slice(start, index),
        startUtf8: Buffer.byteLength(source.slice(0, start), "utf8"),
      });
      if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
      start = index + 1;
    }
  }
  lines.push({
    text: source.slice(start),
    startUtf8: Buffer.byteLength(source.slice(0, start), "utf8"),
  });
  return lines;
}

function positionToByte(lines, line, character) {
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(character) ||
    line < 0 ||
    character < 0 ||
    line >= lines.length ||
    character > lines[line].text.length ||
    (character > 0 &&
      /[\uDC00-\uDFFF]/u.test(lines[line].text[character] ?? ""))
  ) {
    fail("E_LSP_POSITION", `invalid LSP position ${line}:${character}`);
  }
  return (
    lines[line].startUtf8 +
    Buffer.byteLength(lines[line].text.slice(0, character), "utf8")
  );
}

export function consumeLsp({ source, responseJson, profile }) {
  const response = parseJson(responseJson, "E_LSP_JSON");
  if (
    !isRecord(response) ||
    response.fixtureVersion !== "colorful.lsp-fixture/v1" ||
    !isRecord(response.serverInfo) ||
    response.serverInfo.name !== "colorful-lsp" ||
    typeof response.serverInfo.version !== "string" ||
    !Array.isArray(response.legend) ||
    !Array.isArray(response.data)
  ) {
    fail("E_LSP_SHAPE", "semantic-token fixture has an unsupported shape");
  }
  if (`v${response.serverInfo.version}` !== profile.release) {
    fail("E_LSP_VERSION", "semantic-token server version does not match profile");
  }
  if (
    response.legend.length !== profile.lspLegend.length ||
    response.legend.some(
      (tokenType, index) => tokenType !== profile.lspLegend[index],
    )
  ) {
    fail("E_LSP_LEGEND", "semantic-token legend does not match profile");
  }
  if (
    response.data.length % 5 !== 0 ||
    response.data.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    fail("E_LSP_SHAPE", "semantic-token data must be unsigned integer tuples");
  }

  const lines = sourceLines(source);
  const spans = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < response.data.length; index += 5) {
    const [deltaLine, deltaStart, length, tokenType] = response.data.slice(
      index,
      index + 4,
    );
    if (deltaLine === 0) {
      character += deltaStart;
    } else {
      line += deltaLine;
      character = deltaStart;
    }
    const lspType = response.legend[tokenType];
    const role = profile.rolesByLspType.get(lspType);
    if (!role || length === 0) {
      fail("E_LSP_SHAPE", `invalid semantic-token tuple at index ${index / 5}`);
    }
    spans.push({
      startUtf8: positionToByte(lines, line, character),
      endUtf8: positionToByte(lines, line, character + length),
      role,
    });
  }
  return renderReport(normalizeSpans(source, spans, "E_LSP_POSITION"));
}
