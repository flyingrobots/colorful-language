import { fail, normalizeSpans, renderReport } from "./common.mjs";

export const ANSI_ERROR_CODES = Object.freeze([
  "E_ANSI_ESCAPE",
  "E_ANSI_CODE",
  "E_ANSI_STATE",
  "E_SOURCE_TEXT",
]);

export function consumeAnsi({ source, ansiText, profile }) {
  const escape = /\x1b\[([0-9;]*)m/g;
  const spans = [];
  let activeCode = null;
  let plainText = "";
  let cursor = 0;

  function appendPlain(text) {
    const startUtf8 = Buffer.byteLength(plainText, "utf8");
    plainText += text;
    const endUtf8 = Buffer.byteLength(plainText, "utf8");
    if (activeCode !== null && text.length > 0) {
      const role = profile.rolesByAnsi.get(activeCode);
      if (!role) fail("E_ANSI_CODE", `unrecognized ANSI SGR ${activeCode}`);
      if (profile.projectionsByRole.get(role)?.lspTokenType !== null) {
        spans.push({ startUtf8, endUtf8, role });
      }
    }
  }

  for (const match of ansiText.matchAll(escape)) {
    appendPlain(ansiText.slice(cursor, match.index));
    const code = match[1] === "" ? "0" : match[1];
    if (code === "0") {
      activeCode = null;
    } else if (profile.rolesByAnsi.has(code)) {
      activeCode = code;
    } else {
      fail("E_ANSI_CODE", `unrecognized ANSI SGR ${code}`);
    }
    cursor = match.index + match[0].length;
  }
  appendPlain(ansiText.slice(cursor));

  if (plainText.includes("\x1b")) {
    fail("E_ANSI_ESCAPE", "unsupported ANSI escape sequence");
  }
  if (activeCode !== null) {
    fail("E_ANSI_STATE", "ANSI input ends before its final reset");
  }
  if (plainText !== source) {
    fail("E_SOURCE_TEXT", "ANSI text does not reconstruct the source exactly");
  }
  return renderReport(normalizeSpans(source, spans, "E_ANSI_STATE"));
}
