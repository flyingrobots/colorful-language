//! The `colorful.vocabulary/v1` manifest: the single source of presentation
//! intent.
//!
//! Token axes (`TokenKind` + `LexicalClass` + `OpenClassKind`) map to one
//! abstract [`VisualRole`], and each `VisualRole` projects onto every surface —
//! terminal ANSI, LSP token type, graft class. That mapping is authored **once** in
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

use crate::generated::vocabulary_validator_v1::{
    class_role_key, visual_role_name, EXPECTED_CLASS_ROLE_KEYS, VISUAL_ROLE_NAMES,
};
use crate::sha256_hex;
use crate::syntax_v1::{LexicalClass, OpenClassKind, TokenKind};
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
    open_class_kind: Option<OpenClassKind>,
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
        let role = visual_role_name(&projection.visual_role);
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
        if !projection_roles.contains(visual_role_name(&rule.visual_role)) {
            return Err(format!(
                "class role references VisualRole `{}` without a projection",
                visual_role_name(&rule.visual_role)
            ));
        }
        let key = class_role_key(
            &rule.token_kind,
            rule.lexical_class.as_ref(),
            rule.open_class_kind.as_ref(),
        )?;
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
/// disambiguated by its [`LexicalClass`] and, for content words, an optional
/// [`OpenClassKind`]; every other [`TokenKind`] carries neither. Returns `None`
/// when caller-supplied axes have no authored mapping. This fallible return
/// type is part of the v0.4 public API: callers decide how an uncovered
/// combination degrades instead of this boundary panicking on their behalf.
#[must_use]
pub fn visual_role(
    token_kind: &TokenKind,
    lexical_class: Option<&LexicalClass>,
    open_class_kind: Option<&OpenClassKind>,
) -> Option<VisualRole> {
    manifest()
        .class_roles
        .iter()
        .find(|rule| {
            &rule.token_kind == token_kind
                && rule.lexical_class.as_ref() == lexical_class
                && rule.open_class_kind.as_ref() == open_class_kind
        })
        .map(|rule| rule.visual_role.clone())
}

/// The [`VisualRole`] for a `colorful-core` [`PosClass`], via the same token axes
/// the IR projection uses — the bridge every surface calls. The validated
/// embedded manifest covers every current `PosClass`, so all current inputs map
/// to `Some`; callers must nevertheless handle this v0.4 `Option` signature.
#[must_use]
pub fn visual_role_for(class: PosClass) -> Option<VisualRole> {
    let (token_kind, lexical_class, _function_kind, open_class_kind) = crate::token_axes(class);
    visual_role(
        &token_kind,
        lexical_class.as_ref(),
        open_class_kind.as_ref(),
    )
}

/// The per-surface [`RoleProjection`] for a [`VisualRole`]. Manifest validation
/// requires complete coverage of the current generated enum, so every current
/// role maps to `Some`; callers must nevertheless handle this v0.4 `Option`
/// signature.
#[must_use]
pub fn projection(role: &VisualRole) -> Option<&'static RoleProjection> {
    manifest()
        .role_projections
        .iter()
        .find(|p| &p.visual_role == role)
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

fn all_role_names() -> BTreeSet<&'static str> {
    VISUAL_ROLE_NAMES.iter().copied().collect()
}

fn expected_class_role_keys() -> BTreeSet<String> {
    EXPECTED_CLASS_ROLE_KEYS
        .iter()
        .map(|key| (*key).to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[serde(rename_all = "camelCase")]
    struct ValidatorParityFixture {
        cases: Vec<ValidatorParityCase>,
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[serde(rename_all = "camelCase")]
    struct ValidatorParityCase {
        name: String,
        token_kind: TokenKind,
        lexical_class: Option<LexicalClass>,
        open_class_kind: Option<OpenClassKind>,
        visual_role: VisualRole,
        accepted: bool,
    }

    #[test]
    fn shared_class_role_cases_match_generated_rust_validator() {
        let fixture: ValidatorParityFixture = serde_json::from_str(include_str!(
            "../tests/fixtures/vocabulary-validator-parity.json"
        ))
        .expect("shared vocabulary validator parity fixture parses");

        assert!(
            !fixture.cases.is_empty(),
            "parity fixture must not be empty"
        );
        for case in fixture.cases {
            let _validated_role_name = visual_role_name(&case.visual_role);
            let actual = class_role_key(
                &case.token_kind,
                case.lexical_class.as_ref(),
                case.open_class_kind.as_ref(),
            )
            .is_ok();
            assert_eq!(
                actual, case.accepted,
                "generated Rust validator parity case {}",
                case.name
            );
        }
    }

    #[test]
    fn manifest_parses_and_every_role_has_a_projection() {
        let m = manifest();
        assert_eq!(m.class_roles.len(), 10);
        for role in [
            VisualRole::StructuralKeyword,
            VisualRole::TypeLike,
            VisualRole::Literal,
            VisualRole::Quoted,
            VisualRole::Muted,
            VisualRole::Unstyled,
            VisualRole::Noun,
            VisualRole::Verb,
            VisualRole::Adjective,
            VisualRole::Adverb,
        ] {
            assert!(projection(&role).is_some());
        }
    }

    fn manifest_value() -> serde_json::Value {
        serde_json::from_str(MANIFEST_JSON).expect("manifest fixture parses as JSON")
    }

    fn manifest_string(value: &serde_json::Value) -> String {
        serde_json::to_string(value).expect("manifest fixture serializes")
    }

    fn optional_string_matches(value: &serde_json::Value, expected: Option<&str>) -> bool {
        match expected {
            Some(expected) => value.as_str() == Some(expected),
            None => value.is_null(),
        }
    }

    fn class_role_mut<'a>(
        manifest: &'a mut serde_json::Value,
        token_kind: &str,
        lexical_class: Option<&str>,
        open_class_kind: Option<&str>,
    ) -> &'a mut serde_json::Value {
        manifest["classRoles"]
            .as_array_mut()
            .expect("classRoles is an array")
            .iter_mut()
            .find(|rule| {
                rule["tokenKind"].as_str() == Some(token_kind)
                    && optional_string_matches(&rule["lexicalClass"], lexical_class)
                    && optional_string_matches(&rule["openClassKind"], open_class_kind)
            })
            .expect("class role exists")
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
    fn manifest_rejects_open_class_on_non_content_axes() {
        let mut value = manifest_value();
        class_role_mut(&mut value, "WORD", Some("FUNCTION"), None)["openClassKind"] =
            serde_json::Value::String("NOUN".to_string());
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("openClassKind"), "{err}");

        let mut value = manifest_value();
        class_role_mut(&mut value, "NUMBER", None, None)["openClassKind"] =
            serde_json::Value::String("NOUN".to_string());
        let err = parse_manifest(&manifest_string(&value)).unwrap_err();
        assert!(err.contains("openClassKind"), "{err}");
    }

    #[test]
    fn visual_role_returns_none_for_uncovered_axes() {
        assert_eq!(visual_role(&TokenKind::Word, None, None), None);
    }

    #[test]
    fn public_lookup_signatures_pin_the_v04_fallible_contract() {
        type VisualRoleLookup = for<'a, 'b, 'c> fn(
            &'a TokenKind,
            Option<&'b LexicalClass>,
            Option<&'c OpenClassKind>,
        ) -> Option<VisualRole>;
        type ProjectionLookup = for<'a> fn(&'a VisualRole) -> Option<&'static RoleProjection>;

        let axes_lookup: VisualRoleLookup = visual_role;
        let class_lookup: fn(PosClass) -> Option<VisualRole> = visual_role_for;
        let projection_lookup: ProjectionLookup = projection;
        assert_eq!(axes_lookup(&TokenKind::Word, None, None), None);
        assert_eq!(class_lookup(PosClass::Content), Some(VisualRole::Unstyled));
        assert!(projection_lookup(&VisualRole::Unstyled).is_some());
    }

    #[test]
    fn pos_classes_map_to_the_expected_roles() {
        use colorful_core::FunctionKind;
        assert_eq!(
            visual_role_for(PosClass::Function(FunctionKind::Article)),
            Some(VisualRole::StructuralKeyword)
        );
        assert_eq!(
            visual_role_for(PosClass::ProperNoun),
            Some(VisualRole::TypeLike)
        );
        assert_eq!(visual_role_for(PosClass::Number), Some(VisualRole::Literal));
        assert_eq!(visual_role_for(PosClass::Quote), Some(VisualRole::Quoted));
        assert_eq!(
            visual_role_for(PosClass::Punctuation),
            Some(VisualRole::Muted)
        );
        assert_eq!(
            visual_role_for(PosClass::Content),
            Some(VisualRole::Unstyled)
        );
        assert_eq!(
            visual_role_for(PosClass::Open(colorful_core::OpenClassKind::Noun)),
            Some(VisualRole::Noun)
        );
        assert_eq!(
            visual_role_for(PosClass::Open(colorful_core::OpenClassKind::Verb)),
            Some(VisualRole::Verb)
        );
        assert_eq!(
            visual_role_for(PosClass::Open(colorful_core::OpenClassKind::Adjective)),
            Some(VisualRole::Adjective)
        );
        assert_eq!(
            visual_role_for(PosClass::Open(colorful_core::OpenClassKind::Adverb)),
            Some(VisualRole::Adverb)
        );
    }

    #[test]
    fn projections_match_the_authored_table() {
        let structural_keyword =
            projection(&VisualRole::StructuralKeyword).expect("role has a projection");
        let type_like = projection(&VisualRole::TypeLike).expect("role has a projection");
        let muted = projection(&VisualRole::Muted).expect("role has a projection");
        let unstyled = projection(&VisualRole::Unstyled).expect("role has a projection");

        assert_eq!(structural_keyword.ansi.as_deref(), Some("1;35"));
        assert_eq!(type_like.graft_class.as_deref(), Some("type"));
        assert_eq!(muted.ansi.as_deref(), Some("90"));
        assert_eq!(muted.lsp_token_type.as_deref(), None);
        assert_eq!(unstyled.ansi.as_deref(), None);
    }

    #[test]
    fn lsp_legend_is_keyword_class_number_string_in_order() {
        assert_eq!(
            lsp_legend(),
            [
                "keyword",
                "class",
                "number",
                "string",
                "noun",
                "verb",
                "adjective",
                "adverb"
            ]
        );
    }

    #[test]
    fn hash_is_prefixed_and_stable() {
        let h = hash();
        assert!(h.starts_with("sha256:"));
        assert_eq!(h, hash());
    }
}
