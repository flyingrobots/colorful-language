//! Round-trip witness leg (Rust): read a `DocumentAnalysis` JSON from stdin,
//! decode it through the generated DTO, **validate** it against the contract
//! (and, given an optional source-file argument, against the real bytes), and
//! re-emit canonical JSON on stdout. Validating before re-emitting is what keeps
//! the witness from laundering a malformed artifact into clean-looking JSON.
//!
//!   recanon [SOURCE] < document.json

use std::io::Read as _;

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("read stdin");
    let document: colorful_ir::syntax_v1::DocumentAnalysis =
        serde_json::from_str(input.trim()).expect("decode DocumentAnalysis");

    // When a source path is supplied, validate the document against its exact
    // bytes (content hash, byte length, UTF-8 boundaries); otherwise validate
    // the structural and self-consistent-hash invariants alone.
    let source = std::env::args()
        .nth(1)
        .map(|path| std::fs::read(path).expect("read source file"));
    if let Err(errors) = colorful_ir::validate_document(&document, source.as_deref()) {
        eprintln!("recanon: {errors}");
        std::process::exit(1);
    }

    print!(
        "{}",
        colorful_ir::canonical_json(&document).expect("canonical json")
    );
}
