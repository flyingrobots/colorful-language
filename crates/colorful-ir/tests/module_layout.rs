use colorful_core::{PassIdentity, Token, Tree, ValidatedClassification};
use colorful_ir::syntax_v1::DocumentAnalysis;
use colorful_ir::{
    canonical_json, from_classification, from_validated_classification, sha256_hex,
    syntax_schema_hash, validate_document, vocabulary_hash, vocabulary_schema_hash, Path,
    PathSegment, ProjectionError, ValidationError, ValidationErrors, CONTRACT_VERSION,
    WESLEY_VERSION,
};

const FACADE: &str = include_str!("../src/lib.rs");
const HASHING: &str = include_str!("../src/hashing.rs");
const PATH: &str = include_str!("../src/path.rs");
const PROJECTION: &str = include_str!("../src/projection.rs");
const VALIDATION: &str = include_str!("../src/validation.rs");

fn assert_source_owner(
    symbol: &str,
    owner_name: &str,
    owner: &str,
    other_modules: &[(&str, &str)],
) {
    assert!(owner.contains(symbol), "{owner_name} must own {symbol}");
    assert!(
        !FACADE.contains(symbol),
        "the crate facade must not implement {symbol}"
    );
    for (name, source) in other_modules {
        assert!(
            !source.contains(symbol),
            "{name} must not duplicate {symbol} from {owner_name}"
        );
    }
}

#[test]
fn implementation_responsibilities_have_exactly_one_module_owner() {
    let modules = [
        ("hashing.rs", HASHING),
        ("path.rs", PATH),
        ("projection.rs", PROJECTION),
        ("validation.rs", VALIDATION),
    ];

    for (symbol, owner_name, owner) in [
        ("pub fn canonical_json", "hashing.rs", HASHING),
        ("pub fn sha256_hex", "hashing.rs", HASHING),
        ("pub fn syntax_schema_hash", "hashing.rs", HASHING),
        ("pub struct Path", "path.rs", PATH),
        ("pub enum ProjectionError", "projection.rs", PROJECTION),
        ("pub fn from_classification", "projection.rs", PROJECTION),
        ("pub enum ValidationError", "validation.rs", VALIDATION),
        ("pub fn validate_document", "validation.rs", VALIDATION),
    ] {
        let others = modules
            .iter()
            .copied()
            .filter(|(name, _)| *name != owner_name)
            .collect::<Vec<_>>();
        assert_source_owner(symbol, owner_name, owner, &others);
    }

    for declaration in [
        "mod hashing;",
        "mod path;",
        "mod projection;",
        "mod validation;",
    ] {
        assert!(
            FACADE.contains(declaration),
            "the crate facade must declare {declaration}"
        );
    }
}

#[test]
fn existing_public_facade_remains_importable() {
    type RawProjection = fn(
        &str,
        &str,
        &Tree,
        &[Token],
        PassIdentity,
        PassIdentity,
    ) -> Result<DocumentAnalysis, ProjectionError>;
    type ValidatedProjection = for<'a> fn(
        &str,
        &ValidatedClassification<'a>,
        PassIdentity,
        PassIdentity,
    ) -> Result<DocumentAnalysis, ProjectionError>;
    type Validator = fn(&DocumentAnalysis, Option<&[u8]>) -> Result<(), ValidationErrors>;

    let _: RawProjection = from_classification;
    let _: ValidatedProjection = from_validated_classification;
    let _: Validator = validate_document;
    let _: fn(&ValidationError) -> &'static str = ValidationError::code;

    let path = Path::root().field("tokens").index(0);
    assert_eq!(
        path.segments(),
        &[PathSegment::Field("tokens"), PathSegment::Index(0),]
    );
    assert_eq!(canonical_json(&path.to_string()).unwrap(), "\"tokens[0]\"");
    assert!(sha256_hex(b"facade").starts_with("sha256:"));
    assert!(syntax_schema_hash().starts_with("sha256:"));
    assert_eq!(vocabulary_schema_hash(), vocabulary_hash());
    assert_eq!(CONTRACT_VERSION, "colorful.syntax/v1");
    assert!(!WESLEY_VERSION.is_empty());
}
