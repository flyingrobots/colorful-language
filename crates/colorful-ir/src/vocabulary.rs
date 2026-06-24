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

use std::collections::BTreeSet;
use std::sync::OnceLock;

use colorful_core::PosClass;
use serde::Deserialize;

use crate::sha256_hex;
use crate::syntax_v1::{LexicalClass, TokenKind};
use crate::vocabulary_v1::VisualRole;

const MANIFEST_JSON: &str = include_str!("../contracts/vocabulary.v1.json");
const MANIFEST_VERSION: &str = "colorful.vocabulary/v1";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: String,
    class_roles: Vec<ClassRole>,
    role_projections: Vec<RoleProjection>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct ClassRole {
    token_kind: TokenKind,
    lexical_class: Option<LexicalClass>,
    visual_role: VisualRole,
}

/// How a [`VisualRole`] is rendered on each surface. A `None` field means "leave
/// it unstyled" on that surface.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RoleProjection {
    /// The role this projection is for.
    pub visual_role: VisualRole,
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
        parse_manifest(MANIFEST_JSON).expect("valid colorful.vocabulary/v1 manifest")
    })
}

fn parse_manifest(json: &str) -> Result<Manifest, String> {
    let manifest: Manifest =
        serde_json::from_str(json).map_err(|err| format!("invalid JSON shape: {err}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.version != MANIFEST_VERSION {
        return Err(format!(
            "manifest version `{}` does not match `{MANIFEST_VERSION}`",
            manifest.version
        ));
    }

    let expected_roles = all_role_names();
    let mut projection_roles = BTreeSet::new();
    for projection in &manifest.role_projections {
        let role = role_name(&projection.visual_role);
        if !projection_roles.insert(role) {
            return Err(format!("duplicate projection for VisualRole `{role}`"));
        }
    }
    if projection_roles != expected_roles {
        return Err(format!(
            "projection roles {:?} do not match expected {:?}",
            projection_roles, expected_roles
        ));
    }

    let expected_classes = expected_class_role_keys();
    let mut class_roles = BTreeSet::new();
    for rule in &manifest.class_roles {
        if !projection_roles.contains(role_name(&rule.visual_role)) {
            return Err(format!(
                "class role references VisualRole `{}` without a projection",
                role_name(&rule.visual_role)
            ));
        }
        let key = class_role_key(&rule.token_kind, rule.lexical_class.as_ref())?;
        if !class_roles.insert(key.clone()) {
            return Err(format!("duplicate class role for `{key}`"));
        }
    }
    if class_roles != expected_classes {
        return Err(format!(
            "class roles {:?} do not match expected {:?}",
            class_roles, expected_classes
        ));
    }

    Ok(())
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
    for rule in &manifest().class_roles {
        if &rule.token_kind == token_kind && rule.lexical_class.as_ref() == lexical_class {
            return rule.visual_role.clone();
        }
    }
    panic!(
        "colorful.vocabulary/v1 manifest lacks a class role for `{}` / `{:?}`",
        token_kind_name(token_kind),
        lexical_class.map(lexical_class_name)
    );
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
    manifest()
        .role_projections
        .iter()
        .find(|p| &p.visual_role == role)
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

fn all_role_names() -> BTreeSet<&'static str> {
    [
        "STRUCTURAL_KEYWORD",
        "TYPE_LIKE",
        "LITERAL",
        "QUOTED",
        "MUTED",
        "UNSTYLED",
    ]
    .into_iter()
    .collect()
}

fn expected_class_role_keys() -> BTreeSet<String> {
    [
        "WORD/FUNCTION",
        "WORD/CONTENT",
        "WORD/PROPER_NOUN_CANDIDATE",
        "NUMBER/<none>",
        "PUNCTUATION/<none>",
        "QUOTE/<none>",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn class_role_key(
    token_kind: &TokenKind,
    lexical_class: Option<&LexicalClass>,
) -> Result<String, String> {
    match (token_kind, lexical_class) {
        (TokenKind::Word, Some(class)) => Ok(format!(
            "{}/{}",
            token_kind_name(token_kind),
            lexical_class_name(class)
        )),
        (TokenKind::Word, None) => Err("WORD class role must declare lexicalClass".to_string()),
        (_, Some(class)) => Err(format!(
            "{} class role must not declare lexicalClass `{}`",
            token_kind_name(token_kind),
            lexical_class_name(class)
        )),
        (_, None) => Ok(format!("{}/<none>", token_kind_name(token_kind))),
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

    fn manifest_value() -> serde_json::Value {
        serde_json::from_str(MANIFEST_JSON).expect("manifest fixture parses as JSON")
    }

    fn manifest_string(value: &serde_json::Value) -> String {
        serde_json::to_string(value).expect("manifest fixture serializes")
    }

    #[test]
    fn manifest_rejects_wrong_version() {
        let mut value = manifest_value();
        value["version"] = serde_json::Value::String("colorful.vocabulary/v2".to_string());
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("manifest version"), "{err}");
    }

    #[test]
    fn manifest_rejects_unknown_role_names() {
        let mut value = manifest_value();
        value["classRoles"][0]["visualRole"] =
            serde_json::Value::String("STRUCTURAL_KEYWROD".to_string());
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("invalid JSON shape"), "{err}");
    }

    #[test]
    fn manifest_rejects_missing_projection_coverage() {
        let mut value = manifest_value();
        value["roleProjections"]
            .as_array_mut()
            .expect("roleProjections is an array")
            .pop();
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("projection roles"), "{err}");
    }

    #[test]
    fn manifest_rejects_duplicate_class_rules() {
        let mut value = manifest_value();
        let duplicate = value["classRoles"][0].clone();
        value["classRoles"]
            .as_array_mut()
            .expect("classRoles is an array")
            .push(duplicate);
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("duplicate class role"), "{err}");
    }

    #[test]
    fn manifest_rejects_missing_word_lexical_class() {
        let mut value = manifest_value();
        value["classRoles"][0]["lexicalClass"] = serde_json::Value::Null;
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("WORD class role"), "{err}");
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
