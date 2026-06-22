// Reference consumer: how graft (and, through it, jedit) turns the colorful IR
// into a syntax projection.
//
// colorful emits UTF-8 byte ranges (authoritative). Editors want line/column, so
// the consumer derives those from the source — exactly the "derived adapter
// projection" the IR contract keeps out of itself. The resulting className spans
// are the shape graft already produces and jedit's graft-source-highlighter
// already maps to editor roles, so prose flows through the existing path.
//
//   colorful ir FILE | node consumers/graft-projection.mjs FILE
import { readFileSync } from "node:fs";

// colorful.syntax/v1 token -> graft syntax class (skeleton: content/punct unstyled).
function className(token) {
  if (token.lexicalClass === "FUNCTION") return "keyword";
  if (token.lexicalClass === "PROPER_NOUN_CANDIDATE") return "type";
  if (token.tokenKind === "NUMBER") return "number";
  if (token.tokenKind === "QUOTE") return "string";
  return undefined;
}

// Byte offset -> { row, column } (column counted in characters from line start).
function makeByteToPoint(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  return (byte) => {
    let row = 0;
    while (row + 1 < lineStarts.length && lineStarts[row + 1] <= byte) row += 1;
    const column = [...source.slice(lineStarts[row], byte)].length;
    return { row, column };
  };
}

const sourcePath = process.argv[2];
if (!sourcePath) {
  process.stderr.write("usage: colorful ir FILE | node graft-projection.mjs FILE\n");
  process.exit(1);
}
const source = readFileSync(sourcePath, "utf8");
const ir = JSON.parse(readFileSync(0, "utf8"));
const byteToPoint = makeByteToPoint(source);

const spans = ir.tokens
  .map((token) => {
    const cls = className(token);
    if (!cls) return undefined;
    return {
      className: cls,
      range: {
        start: byteToPoint(token.byteRange.startUtf8),
        end: byteToPoint(token.byteRange.endUtf8),
      },
    };
  })
  .filter(Boolean);

// graft's projection-bundle shape (the thing jedit's adapter reads).
process.stdout.write(JSON.stringify({ syntax: { partial: false, spans } }, null, 2));
process.stdout.write("\n");
