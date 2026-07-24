// Round-trip witness leg (TypeScript/JS): read a DocumentAnalysis JSON from
// stdin, **validate** it against the colorful.syntax/v1 wire contract and the
// real source bytes, then re-emit *canonical* JSON (compact, object keys
// sorted lexicographically) — the exact same canonical form colorful-ir
// produces in Rust, so a faithful round-trip is byte-for-byte identical.
// Validating before re-emitting is what keeps this leg from laundering a
// malformed artifact into clean-looking JSON, exactly like the Rust leg's
// `recanon` example.
//
// Uses `validateWireContract`, not the graft reference consumer's full
// `validateArtifact`: the latter also enforces non-overlapping token wire
// order, a graft-projection-specific requirement that
// `colorful_ir::validate_document` deliberately does not check (inter-token
// layout is a producer guarantee, not part of the wire contract). Reusing
// the graft-specific gate here would make this witness reject a token
// layout the Rust leg would accept.
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
