// Run from the repository root after the release wasm build:
//   node crates/colorful-wasm/examples/node.mjs "The cat sat on the mat."
import { readFile } from 'node:fs/promises';

import { instantiate } from '../js/colorful-wasm.mjs';

const wasm = new URL('../../../target/wasm32-unknown-unknown/release/colorful_wasm.wasm', import.meta.url);
const colorful = await instantiate(await readFile(wasm));

const text = process.argv[2] ?? 'The cat sat on the mat.';
const ir = JSON.parse(colorful.ir(text)); // the bytes `colorful ir -` prints
console.log(colorful.version().trim(), '-', ir.tokens.length, 'tokens');
const bytes = new TextEncoder().encode(text); // ranges are UTF-8 byte offsets
const decoder = new TextDecoder();
for (const token of ir.tokens) {
  const { startUtf8, endUtf8 } = token.byteRange;
  const word = decoder.decode(bytes.subarray(startUtf8, endUtf8));
  console.log(word.padEnd(8), token.tokenKind, token.openClassKind ?? token.lexicalClass ?? '');
}
