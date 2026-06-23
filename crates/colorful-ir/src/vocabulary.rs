//! The `colorful.vocabulary/v1` manifest: the single source of presentation
//! intent.
//!
//! Token axes (`TokenKind` + `LexicalClass`) map to one abstract [`VisualRole`],
//! and each `VisualRole` projects onto every surface — terminal ANSI, LSP token
//! type, graft class. That mapping is authored **once** in
//! `contracts/colorful/vocabulary.v1.json` and embedded here; the CLI, the
//! language server, and the graft reference consumer all derive their colors from
//! it instead of hardcoding their own copy.
//!
//! The manifest's bytes are what [`hash`] returns, and that is the IR's
//! `vocabularyHash` — so the hash certifies *presentation behavior*: change a
//! color or a role mapping and the hash changes. A consumer can compare the
//! manifest it holds against an artifact's `vocabularyHash` to detect drift.

use std::sync::OnceLock;

use colorful_core::PosClass;
use serde::Deserialize;

use crate::generated::vocabulary_v1::VisualRole;
use crate::sha256_hex;
use crate::syntax_v1::{LexicalClass, TokenKind};

const MANIFEST_JSON: &str = include_str!("../../../contracts/colorful/vocabulary.v1.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    class_roles: Vec<ClassRole>,
    role_projections: Vec<RoleProjection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClassRole {
    token_kind: String,
    lexical_class: Option<String>,
    visual_role: String,
}

/// How a [`VisualRole`] is rendered on each surface. A `None` field means "leave
/// it unstyled" on that surface.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleProjection {
    /// The role this projection is for (the `VisualRole` SCREAMING_SNAKE name).
    pub visual_role: String,
    /// ANSI SGR parameters for the terminal, or `None` for the default foreground.
    pub ansi: Option<String>,
    /// The LSP semantic token type name, or `None` to emit no token.
    pub lsp_token_type: Option<String>,
    /// The graft syntax class name, or `None` to leave the span unstyled.
    pub graft_class: Option<String>,
}

/// The parsed manifest, loaded once. A malformed manifest is a build-time bug,
/// pinned by the tests, so panicking here is the right failure mode.
fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON).expect("colorful.vocabulary/v1 manifest is valid JSON")
    })
}

/// `sha256:<hex>` of the manifest bytes — the IR's `vocabularyHash`.
#[must_use]
pub fn hash() -> String {
    sha256_hex(MANIFEST_JSON.as_bytes())
}

/// The [`VisualRole`] for a token's axes, per the manifest. A `WORD` is
/// disambiguated by its [`LexicalClass`]; every other [`TokenKind`] ignores it.
#[must_use]
pub fn visual_role(token_kind: &TokenKind, lexical_class: Option<&LexicalClass>) -> VisualRole {
    let tk = token_kind_name(token_kind);
    let lc = lexical_class.map(lexical_class_name);
    for rule in &manifest().class_roles {
        let kind_matches = rule.token_kind == tk;
        let class_matches = rule.lexical_class.is_none() || rule.lexical_class.as_deref() == lc;
        if kind_matches && class_matches {
            return role_from_name(&rule.visual_role);
        }
    }
    VisualRole::Unstyled
}

/// The [`VisualRole`] for a `colorful-core` [`PosClass`], via the same token axes
/// the IR projection uses — the bridge every surface calls.
#[must_use]
pub fn visual_role_for(class: PosClass) -> VisualRole {
    let (token_kind, lexical_class, _function_kind) = crate::token_axes(class);
    visual_role(&token_kind, lexical_class.as_ref())
}

/// The per-surface [`RoleProjection`] for a [`VisualRole`].
#[must_use]
pub fn projection(role: &VisualRole) -> &'static RoleProjection {
    let name = role_name(role);
    manifest()
        .role_projections
        .iter()
        .find(|p| p.visual_role == name)
        .expect("every VisualRole has a projection in the manifest")
}

/// The LSP semantic token-type names in legend order: the distinct, non-`null`
/// `lspTokenType` values in manifest declaration order. Surfaces index into this
/// list, so its order is the wire contract for token-type indices.
#[must_use]
pub fn lsp_legend() -> Vec<&'static str> {
    let mut legend: Vec<&'static str> = Vec::new();
    for projection in &manifest().role_projections {
        if let Some(name) = projection.lsp_token_type.as_deref() {
            if !legend.contains(&name) {
                legend.push(name);
            }
        }
    }
    legend
}

fn token_kind_name(kind: &TokenKind) -> &'static str {
    match kind {
        TokenKind::Word => "WORD",
        TokenKind::Number => "NUMBER",
        TokenKind::Punctuation => "PUNCTUATION",
        TokenKind::Quote => "QUOTE",
    }
}

fn lexical_class_name(class: &LexicalClass) -> &'static str {
    match class {
        LexicalClass::Function => "FUNCTION",
        LexicalClass::Content => "CONTENT",
        LexicalClass::ProperNounCandidate => "PROPER_NOUN_CANDIDATE",
    }
}

fn role_name(role: &VisualRole) -> &'static str {
    match role {
        VisualRole::StructuralKeyword => "STRUCTURAL_KEYWORD",
        VisualRole::TypeLike => "TYPE_LIKE",
        VisualRole::Literal => "LITERAL",
        VisualRole::Quoted => "QUOTED",
        VisualRole::Muted => "MUTED",
        VisualRole::Unstyled => "UNSTYLED",
    }
}

fn role_from_name(name: &str) -> VisualRole {
    match name {
        "STRUCTURAL_KEYWORD" => VisualRole::StructuralKeyword,
        "TYPE_LIKE" => VisualRole::TypeLike,
        "LITERAL" => VisualRole::Literal,
        "QUOTED" => VisualRole::Quoted,
        "MUTED" => VisualRole::Muted,
        _ => VisualRole::Unstyled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_parses_and_every_role_has_a_projection() {
        let m = manifest();
        assert_eq!(m.class_roles.len(), 6);
        for role in [
            VisualRole::StructuralKeyword,
            VisualRole::TypeLike,
            VisualRole::Literal,
            VisualRole::Quoted,
            VisualRole::Muted,
            VisualRole::Unstyled,
        ] {
            // Does not panic: the projection exists for every role.
            let _ = projection(&role);
        }
    }

    #[test]
    fn pos_classes_map_to_the_expected_roles() {
        use colorful_core::FunctionKind;
        assert_eq!(
            visual_role_for(PosClass::Function(FunctionKind::Article)),
            VisualRole::StructuralKeyword
        );
        assert_eq!(visual_role_for(PosClass::ProperNoun), VisualRole::TypeLike);
        assert_eq!(visual_role_for(PosClass::Number), VisualRole::Literal);
        assert_eq!(visual_role_for(PosClass::Quote), VisualRole::Quoted);
        assert_eq!(visual_role_for(PosClass::Punctuation), VisualRole::Muted);
        assert_eq!(visual_role_for(PosClass::Content), VisualRole::Unstyled);
    }

    #[test]
    fn projections_match_the_authored_table() {
        assert_eq!(
            projection(&VisualRole::StructuralKeyword).ansi.as_deref(),
            Some("1;35")
        );
        assert_eq!(
            projection(&VisualRole::TypeLike).graft_class.as_deref(),
            Some("type")
        );
        assert_eq!(projection(&VisualRole::Muted).ansi.as_deref(), Some("90"));
        assert_eq!(
            projection(&VisualRole::Muted).lsp_token_type.as_deref(),
            None
        );
        assert_eq!(projection(&VisualRole::Unstyled).ansi.as_deref(), None);
    }

    #[test]
    fn lsp_legend_is_keyword_class_number_string_in_order() {
        assert_eq!(lsp_legend(), ["keyword", "class", "number", "string"]);
    }

    #[test]
    fn hash_is_prefixed_and_stable() {
        let h = hash();
        assert!(h.starts_with("sha256:"));
        assert_eq!(h, hash());
    }
}
