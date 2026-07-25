//! Generated boundary code. Regenerate all files with `scripts/gen-ir.sh`.
//!
//! Wesley emits the wire DTOs; the repository's vocabulary generator emits the
//! role/key validator. These are boundaries, not the internal domain model —
//! do not edit them by hand, and do not use them in place of `colorful-core`'s
//! types.

pub mod syntax_v1;
pub mod vocabulary_v1;
pub(crate) mod vocabulary_validator_v1;
