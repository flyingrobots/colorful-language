//! Experimental WebAssembly build of `colorful ir`.
//!
//! The module reproduces the bytes `colorful ir -` writes to stdout: the
//! `colorful.syntax/v1` `DocumentAnalysis` as canonical JSON followed by one
//! newline. It runs the same production stack as the CLI — the
//! [`colorful_parse::ProseParser`], the default
//! [`colorful_lexicon::ContextualOpenClassAnnotator`], and
//! [`colorful_projection::build_document`] — and serializes with
//! [`colorful_ir::canonical_json`]. Nothing is forked into JavaScript.
//!
//! [`ir_output`] is the safe, target-independent core. The `exports` module is
//! a plain C-ABI surface for `wasm32-unknown-unknown`: the host writes UTF-8
//! into a buffer the module owns, calls `colorful_ir`, and copies the result
//! out of a second module-owned buffer. The only unsafe capability in this
//! crate is `#[no_mangle]` on those exports; see
//! `docs/design/0007-wasm-c-abi-exports.md`.

#![deny(unsafe_code)]
#![warn(missing_docs)]

use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_parse::ProseParser;

/// Version of the exported C-ABI calling convention, not of the IR contract.
pub const ABI_VERSION: u32 = 1;

/// The unit id `colorful ir -` uses for standard input.
pub const STDIN_UNIT_ID: &str = "stdin";

/// Why [`ir_output`] produced no IR. Each maps to one non-zero export status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// The unit id or the document is not valid UTF-8.
    InvalidUtf8,
    /// The parser/annotator output failed projection into the IR.
    Projection(String),
    /// Canonical JSON serialization failed.
    Serialization(String),
}

impl Failure {
    /// The status code the `colorful_ir` export returns for this failure.
    #[must_use]
    pub fn status(&self) -> u32 {
        match self {
            Self::InvalidUtf8 => 1,
            Self::Projection(_) => 2,
            Self::Serialization(_) => 3,
        }
    }

    /// The message the CLI would print after `colorful: ` on stderr.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            // std's io::Read::read_to_string error text, which the CLI reports.
            Self::InvalidUtf8 => "stream did not contain valid UTF-8".to_string(),
            Self::Projection(message) | Self::Serialization(message) => message.clone(),
        }
    }
}

/// The exact stdout bytes of `colorful ir` for `input` read as `unit_id`.
///
/// `colorful ir -` uses [`STDIN_UNIT_ID`]; `colorful ir FILE` uses the path
/// operand as given.
///
/// # Errors
///
/// Returns [`Failure`] when either input is not UTF-8 or the analysis cannot
/// be projected or serialized. No partial output is produced.
pub fn ir_output(unit_id: &[u8], input: &[u8]) -> Result<String, Failure> {
    let unit_id = std::str::from_utf8(unit_id).map_err(|_| Failure::InvalidUtf8)?;
    let input = std::str::from_utf8(input).map_err(|_| Failure::InvalidUtf8)?;
    let parser = ProseParser::new();
    let annotator = ContextualOpenClassAnnotator::default();
    let analyzed = colorful_projection::build_document(unit_id, input, &parser, &annotator)
        .map_err(|err| Failure::Projection(err.to_string()))?;
    let mut json = colorful_ir::canonical_json(&analyzed.document)
        .map_err(|err| Failure::Serialization(err.to_string()))?;
    json.push('\n');
    Ok(json)
}

/// The exact stdout bytes of `colorful --version`.
#[must_use]
pub fn version_output() -> String {
    format!("colorful {}\n", env!("CARGO_PKG_VERSION"))
}

#[allow(unsafe_code)]
mod exports {
    //! The C-ABI surface. Every function here is safe Rust except for the
    //! `#[no_mangle]` attribute that exports it under a stable symbol name.
    //! The host only ever writes into the input buffer between calls, inside
    //! the region `colorful_input` just returned, and only reads the output
    //! buffer between calls; no Rust borrow is live while it does either.

    use std::cell::RefCell;

    thread_local! {
        static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    fn set_output(bytes: Vec<u8>) {
        OUTPUT.with(|output| *output.borrow_mut() = bytes);
    }

    /// Test-only stand-in for the host's write into the input buffer.
    #[cfg(test)]
    pub(super) fn host_write(bytes: &[u8]) {
        let len = u32::try_from(bytes.len()).expect("test input fits u32");
        colorful_input(len);
        INPUT.with(|input| input.borrow_mut().copy_from_slice(bytes));
    }

    /// Test-only read of the output buffer.
    #[cfg(test)]
    pub(super) fn host_read() -> Vec<u8> {
        OUTPUT.with(|output| output.borrow().clone())
    }

    /// The calling-convention version. Hosts refuse a module they do not know.
    #[no_mangle]
    pub extern "C" fn colorful_abi_version() -> u32 {
        super::ABI_VERSION
    }

    /// Resize the input buffer to `len` zeroed bytes and return its address.
    /// The host writes `unit_id ‖ document` there before calling `colorful_ir`.
    #[no_mangle]
    pub extern "C" fn colorful_input(len: u32) -> *mut u8 {
        INPUT.with(|input| {
            let mut input = input.borrow_mut();
            input.clear();
            input.shrink_to_fit();
            input.resize(len as usize, 0);
            input.as_mut_ptr()
        })
    }

    /// Analyze the input buffer, whose first `unit_len` bytes are the unit id
    /// and whose remainder is the document. Returns 0 and leaves the exact
    /// `colorful ir` stdout bytes in the output buffer, or a non-zero
    /// [`super::Failure::status`] and leaves its UTF-8 message there instead.
    #[no_mangle]
    pub extern "C" fn colorful_ir(unit_len: u32) -> u32 {
        let result = INPUT.with(|input| {
            let input = input.borrow();
            let split = (unit_len as usize).min(input.len());
            let (unit_id, document) = input.split_at(split);
            super::ir_output(unit_id, document)
        });
        match result {
            Ok(json) => {
                set_output(json.into_bytes());
                0
            }
            Err(failure) => {
                set_output(failure.message().into_bytes());
                failure.status()
            }
        }
    }

    /// Leave the exact `colorful --version` stdout bytes in the output buffer.
    #[no_mangle]
    pub extern "C" fn colorful_version() -> u32 {
        set_output(super::version_output().into_bytes());
        0
    }

    /// Address of the output buffer written by the last call.
    #[no_mangle]
    pub extern "C" fn colorful_output_ptr() -> *const u8 {
        OUTPUT.with(|output| output.borrow().as_ptr())
    }

    /// Length in bytes of the output buffer written by the last call.
    #[no_mangle]
    pub extern "C" fn colorful_output_len() -> u32 {
        OUTPUT.with(|output| u32::try_from(output.borrow().len()).unwrap_or(u32::MAX))
    }

    /// Release both buffers so a large document's memory can be reused.
    #[no_mangle]
    pub extern "C" fn colorful_release() {
        INPUT.with(|input| *input.borrow_mut() = Vec::new());
        set_output(Vec::new());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ir_output_ends_with_one_newline_and_is_canonical_json() {
        let out = ir_output(STDIN_UNIT_ID.as_bytes(), b"The cat sat.").expect("analysis");
        assert!(out.ends_with("}\n"));
        assert!(!out.ends_with("\n\n"));
        assert!(out.contains("\"unitId\":\"stdin\""));
    }

    #[test]
    fn invalid_utf8_is_a_typed_failure_with_the_cli_message() {
        let failure = ir_output(b"stdin", b"\xff").expect_err("invalid UTF-8");
        assert_eq!(failure, Failure::InvalidUtf8);
        assert_eq!(failure.status(), 1);
        assert_eq!(failure.message(), "stream did not contain valid UTF-8");
    }

    #[test]
    fn failure_statuses_and_messages_are_distinct() {
        let projection = Failure::Projection("bad span".to_string());
        let serialization = Failure::Serialization("bad json".to_string());
        assert_eq!(
            (projection.status(), projection.message().as_str()),
            (2, "bad span")
        );
        assert_eq!(
            (serialization.status(), serialization.message().as_str()),
            (3, "bad json")
        );
    }

    #[test]
    fn exports_return_the_safe_core_bytes() {
        assert_eq!(exports::colorful_abi_version(), ABI_VERSION);
        assert!(!exports::colorful_input(0).is_null());

        exports::host_write(b"stdinColorful colors prose.");
        assert_eq!(exports::colorful_ir(5), 0);
        let expected = ir_output(b"stdin", b"Colorful colors prose.").expect("analysis");
        assert_eq!(exports::host_read(), expected.as_bytes());
        assert_eq!(exports::colorful_output_len() as usize, expected.len());
        assert!(!exports::colorful_output_ptr().is_null());

        exports::host_write(b"stdin\xff");
        assert_eq!(exports::colorful_ir(5), 1);
        assert_eq!(exports::host_read(), b"stream did not contain valid UTF-8");

        // A unit length past the buffer clamps rather than reading out of bounds.
        exports::host_write(b"abc");
        assert_eq!(exports::colorful_ir(99), 0);
        assert_eq!(
            exports::host_read(),
            ir_output(b"abc", b"").expect("empty document").as_bytes()
        );

        assert_eq!(exports::colorful_version(), 0);
        assert_eq!(exports::host_read(), version_output().as_bytes());
        exports::colorful_release();
        assert_eq!(exports::colorful_output_len(), 0);
    }
}
