// Round-trip witness leg (TypeScript/JS): read a DocumentAnalysis JSON from
// stdin, **validate** it against the contract and the real source bytes (the
// same admission gate the graft reference consumer runs before projecting),
// then re-emit *canonical* JSON (compact, object keys sorted lexicographically)
// — the exact same canonical form colorful-ir produces in Rust, so a faithful
// round-trip is byte-for-byte identical. Validating before re-emitting is what
// keeps this leg from laundering a malformed artifact into clean-looking JSON,
// exactly like the Rust leg's `recanon` example.
//
//   node ir-canonicalize.mjs SOURCE < document.json
import { readFileSync } from "node:fs";
import { validateArtifact } from "../consumers/graft-projection.mjs";

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
const document = JSON.parse(input);
const buffer = readFileSync(sourcePath);

try {
  validateArtifact(buffer, document);
} catch (err) {
  console.error(`ir-canonicalize: ${err.message}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(canonicalize(document)));
