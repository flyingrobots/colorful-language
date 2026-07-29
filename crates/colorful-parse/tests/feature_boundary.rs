//! Source-policy evidence for the optional Markdown adapter boundary.

fn manifest(source: &str) -> toml::Value {
    toml::from_str(source).expect("manifest must parse")
}

#[test]
fn markdown_feature_is_opt_in() {
    let parser = manifest(include_str!("../Cargo.toml"));
    let features = parser["features"].as_table().expect("feature table");
    assert!(features["default"]
        .as_array()
        .expect("default features")
        .is_empty());
    assert_eq!(
        features["markdown"]
            .as_array()
            .expect("Markdown feature dependencies")
            .iter()
            .map(|feature| feature.as_str().expect("feature name"))
            .collect::<Vec<_>>(),
        ["dep:pulldown-cmark"]
    );
    let dependency = parser["dependencies"]["pulldown-cmark"]
        .as_table()
        .expect("pulldown-cmark dependency");
    assert_eq!(dependency["optional"].as_bool(), Some(true));
}
