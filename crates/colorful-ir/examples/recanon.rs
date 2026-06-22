//! Round-trip witness leg (Rust): read a `DocumentAnalysis` JSON from stdin,
//! decode it through the generated DTO, and re-emit canonical JSON on stdout.

use std::io::Read as _;

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("read stdin");
    let document: colorful_ir::syntax_v1::DocumentAnalysis =
        serde_json::from_str(input.trim()).expect("decode DocumentAnalysis");
    print!(
        "{}",
        colorful_ir::canonical_json(&document).expect("canonical json")
    );
}
