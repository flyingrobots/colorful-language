// Round-trip witness leg (TypeScript/JS): read a DocumentAnalysis JSON from
// stdin, **validate** it against the colorful.syntax/v1 wire contract and the
// real source bytes, then re-emit *canonical* JSON (compact, object keys
// sorted lexicographically) — the exact same canonical form colorful-ir
// produces in Rust, so a faithful round-trip is byte-for-byte identical.
// Validating before re-emitting is what keeps this leg from laundering a
// malformed artifact into clean-looking JSON, exactly like the Rust leg's
// `recanon` example.
//
// Uses `validateWireContract`, the same shared admission gate behind the Graft
// reference consumer's product-facing `validateArtifact` entry point.
//
//   node ir-canonicalize.mjs SOURCE < document.json
import { readFileSync } from "node:fs";
import {
  GraftProjectionError,
  validateWireContract,
} from "../consumers/graft-projection.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("usage: node ir-canonicalize.mjs SOURCE < document.json");
  process.exit(2);
}

const input = readFileSync(0, "utf8");
let document;
try {
  document = JSON.parse(input);
} catch (error) {
  console.error(`ir-canonicalize: E_JSON_DECODE: ${error.message}`);
  process.exit(1);
}
const buffer = readFileSync(sourcePath);

try {
  validateWireContract(buffer, document);
} catch (err) {
  const code = err instanceof GraftProjectionError ? err.code : "E_VALIDATION";
  console.error(`ir-canonicalize: ${code}: ${err.message}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(canonicalize(document)));
