#![forbid(unsafe_code)]
#![no_main]

use colorful_ir::validate_document;
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_parse::ProseParser;
use colorful_projection::build_document;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: (&str, u8)| {
    let (input, mutation) = data;
    let source = format!("é{input}");
    let mut document = build_document(
        "fuzz",
        &source,
        &ProseParser::new(),
        &ContextualOpenClassAnnotator::default(),
    )
    .expect("valid built-in projection");
    validate_document(&document.document, Some(source.as_bytes()))
        .expect("successful projection validates");

    let (expected_code, expected_path) = match mutation % 4 {
        0 => {
            document.document.contract_version = "colorful.syntax/fuzz".to_string();
            ("UnsupportedContractVersion", "contractVersion")
        }
        1 => {
            document.document.source.content_hash = "fuzz".to_string();
            ("ContentHashMismatch", "source.contentHash")
        }
        2 => {
            document
                .document
                .tokens
                .first_mut()
                .expect("the prefixed source produces a token")
                .byte_range
                .start_utf8 = -1;
            ("NegativeOffset", "tokens[0].byteRange.startUtf8")
        }
        _ => {
            document
                .document
                .tokens
                .first_mut()
                .expect("the prefixed source produces a token")
                .byte_range
                .start_utf8 = 1;
            ("RangeNotOnCharBoundary", "tokens[0].byteRange.startUtf8")
        }
    };
    let errors = validate_document(&document.document, Some(source.as_bytes()))
        .expect_err("selected IR mutation must fail");
    assert_eq!(errors.0[0].code(), expected_code);
    assert_eq!(errors.0[0].path().to_string(), expected_path);
});
