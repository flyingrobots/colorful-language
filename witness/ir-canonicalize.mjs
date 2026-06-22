// Round-trip witness leg (TypeScript/JS): read a DocumentAnalysis JSON from
// stdin, decode it, and re-emit *canonical* JSON (compact, object keys sorted
// lexicographically) — the exact same canonical form colorful-ir produces in
// Rust, so a faithful round-trip is byte-for-byte identical.
import { readFileSync } from "node:fs";

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

const input = readFileSync(0, "utf8");
const document = JSON.parse(input);
process.stdout.write(JSON.stringify(canonicalize(document)));
