// Deterministically mutate one canonical colorful.syntax/v1 document for the
// process-level refusal matrix in scripts/ir-witness.sh.
//
//   node witness/process-negative.mjs CASE BASE.json > malformed.json
import { readFileSync } from "node:fs";

const caseName = process.argv[2];
const basePath = process.argv[3];
if (!caseName || !basePath) {
  process.stderr.write("usage: node witness/process-negative.mjs CASE BASE.json\n");
  process.exit(2);
}

if (caseName === "invalid-json") {
  process.stdout.write('{"contractVersion":');
  process.exit(0);
}

const document = JSON.parse(readFileSync(basePath, "utf8"));
switch (caseName) {
  case "mismatched-source":
    break;
  case "wrong-contract-version":
    document.contractVersion = "colorful.syntax/v999";
    break;
  case "wrong-schema-hash":
    document.schemaHash = "sha256:wrong-schema";
    break;
  case "wrong-vocabulary-hash":
    document.vocabularyHash = "sha256:wrong-vocabulary";
    break;
  case "illegal-axes":
    document.tokens[0].openClassKind = "NOUN";
    break;
  case "fractional-offset":
    document.tokens[0].byteRange.startUtf8 = 0.5;
    break;
  case "out-of-range-offset":
    document.tokens[0].byteRange.endUtf8 = document.source.utf8ByteLength + 1;
    break;
  case "missing-field":
    delete document.derivation;
    break;
  case "identity-precedence":
    document.contractVersion = "colorful.syntax/v999";
    document.schemaHash = "sha256:wrong-schema";
    document.vocabularyHash = "sha256:wrong-vocabulary";
    break;
  default:
    process.stderr.write(`unknown process-negative case: ${caseName}\n`);
    process.exit(2);
}

process.stdout.write(JSON.stringify(document));
