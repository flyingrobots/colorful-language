// Proves the Wesley-generated TypeScript contract type for colorful.syntax/v1 is
// importable and usable. `tsc --noEmit` over this file fails if the generated
// types drift out of shape.
import type {
  DocumentAnalysis,
  Token,
  TokenKind,
} from "../crates/colorful-ir/ts/syntax_v1";

export function functionWordCount(doc: DocumentAnalysis): number {
  return doc.tokens.filter((t: Token) => t.lexicalClass === "FUNCTION").length;
}

const kinds: TokenKind[] = ["WORD", "NUMBER", "PUNCTUATION", "QUOTE"];
export const tokenKinds = kinds;
