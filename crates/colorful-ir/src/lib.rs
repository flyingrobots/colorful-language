//! Boundary DTOs for the `colorful.syntax/v1` IR, plus the projection from
//! `colorful-core`'s domain model and a canonical JSON serializer.
//!
//! The types under [`syntax_v1`] / [`vocabulary_v1`] are **Wesley-generated wire
//! boundary** types — never edited by hand and never used in place of
//! `colorful-core`'s ergonomic model. `colorful-core` stays free of generated
//! types; this crate is the one-way bridge.

#![forbid(unsafe_code)]
#![cfg_attr(not(test), warn(clippy::cognitive_complexity))]

mod generated;
mod hashing;
mod path;
mod projection;
mod validation;
pub mod vocabulary;

pub use generated::{syntax_v1, vocabulary_v1};
pub use hashing::{
    canonical_json, sha256_hex, syntax_schema_hash, vocabulary_hash, vocabulary_schema_hash,
};
pub use path::{Path, PathSegment};
pub use projection::{from_classification, from_validated_classification, ProjectionError};
pub use validation::{validate_document, ValidationError, ValidationErrors};

/// The contract identity this crate produces.
pub const CONTRACT_VERSION: &str = "colorful.syntax/v1";
/// The Wesley version the committed generated types were emitted with.
pub const WESLEY_VERSION: &str = "0.1.1";

const SYNTAX_V1_SDL: &str = include_str!("../contracts/syntax.v1.graphql");
#[cfg(test)]
const SYNTAX_COMPATIBILITY_V1: &str = include_str!("../contracts/syntax-compatibility.v1.json");

#[cfg(test)]
use hashing::strip_graphql_descriptions;
#[cfg(test)]
use projection::{is_paragraph_break, logical_line_break_count, to_i32, token_axes};

#[cfg(test)]
mod integration;
#[cfg(test)]
mod tests;
