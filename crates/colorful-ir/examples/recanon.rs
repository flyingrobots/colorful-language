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
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        reject("E_STDIN_READ", error);
    }
    let document: colorful_ir::syntax_v1::DocumentAnalysis =
        match serde_json::from_str(input.trim()) {
            Ok(document) => document,
            Err(error) => reject("E_JSON_DECODE", error),
        };

    // When a source path is supplied, validate the document against its exact
    // bytes (content hash, byte length, UTF-8 boundaries); otherwise validate
    // the structural and self-consistent-hash invariants alone.
    let source = std::env::args()
        .nth(1)
        .map(|path| std::fs::read(path).unwrap_or_else(|error| reject("E_SOURCE_READ", error)));
    if let Err(errors) = colorful_ir::validate_document(&document, source.as_deref()) {
        let code = errors
            .0
            .first()
            .map(colorful_ir::ValidationError::code)
            .unwrap_or("E_EMPTY_VALIDATION_ERRORS");
        reject(code, errors);
    }

    match colorful_ir::canonical_json(&document) {
        Ok(json) => print!("{json}"),
        Err(error) => reject("E_CANONICAL_JSON", error),
    }
}

fn reject(code: &str, error: impl core::fmt::Display) -> ! {
    eprintln!("recanon: {code}: {error}");
    std::process::exit(1);
}
