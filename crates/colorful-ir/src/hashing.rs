use crate::{vocabulary, SYNTAX_V1_SDL};
use std::fmt::Write as _;

/// Canonical JSON: compact, with object keys sorted lexicographically. Both the
/// Rust and TS sides use this exact form so a round-trip is byte-for-byte.
///
/// # Errors
/// Returns an error if `value` cannot be serialized.
pub fn canonical_json<T: serde::Serialize>(value: &T) -> Result<String, serde_json::Error> {
    // `serde_json::Value`'s object map is a BTreeMap (sorted keys) unless the
    // `preserve_order` feature is on, and `Display` is compact.
    Ok(serde_json::to_value(value)?.to_string())
}

/// `sha256:<hex>` of `bytes`.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    format!("sha256:{hex}")
}

/// Strip GraphQL description strings from `sdl` before hashing, so a
/// documentation-only description edit does not change `schemaHash` --
/// only real shape (types, fields, enum values) does. This crate's
/// contracts may use either single-line `"..."` descriptions or multiline
/// `"""..."""` block descriptions.
pub(crate) fn strip_graphql_descriptions(sdl: &str) -> String {
    let mut in_block_description = false;
    sdl.lines()
        .filter(|line| {
            let trimmed = line.trim();
            if in_block_description {
                if trimmed.contains("\"\"\"") {
                    in_block_description = false;
                }
                return false;
            }
            if let Some(after_delimiter) = trimmed.strip_prefix("\"\"\"") {
                if !after_delimiter.contains("\"\"\"") {
                    in_block_description = true;
                }
                return false;
            }
            !(trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The hash of the `colorful.syntax/v1` contract these types implement.
///
/// Normalized against description-only edits (see
/// `strip_graphql_descriptions`): a `DerivationStep` description fix, for
/// example, does not bump this hash. A real shape change -- a new field, a
/// renamed type, a new enum value -- still does.
#[must_use]
pub fn syntax_schema_hash() -> String {
    sha256_hex(strip_graphql_descriptions(SYNTAX_V1_SDL).as_bytes())
}

/// The hash of the `colorful.vocabulary/v1` **manifest** — the concrete
/// presentation mapping in `contracts/colorful/vocabulary.v1.json`, not merely
/// the `VisualRole` enum SDL. This is what the IR carries as `vocabularyHash`, so
/// the hash certifies presentation behavior: change a color or a role mapping and
/// the hash changes. See [`vocabulary`].
#[must_use]
pub fn vocabulary_hash() -> String {
    vocabulary::hash()
}

/// Compatibility alias for the IR vocabulary hash.
///
/// Earlier Stage 1 code used this name while `vocabularyHash` pointed at the
/// generated vocabulary SDL. The hash now intentionally points at the concrete
/// `colorful.vocabulary/v1` manifest; keep the symbol so downstream callers do
/// not break while they migrate to [`vocabulary_hash`].
#[must_use]
pub fn vocabulary_schema_hash() -> String {
    vocabulary_hash()
}

pub(crate) fn build_hash() -> String {
    // A stand-in identity for Stage 1; a real reproducible build hash comes later.
    format!("colorful-ir@{}", env!("CARGO_PKG_VERSION"))
}
