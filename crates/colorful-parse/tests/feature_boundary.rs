//! Source-policy evidence for the optional Markdown adapter boundary.

fn manifest(source: &str) -> toml::Value {
    toml::from_str(source).expect("manifest must parse")
}

#[test]
fn markdown_feature_is_opt_in_and_drivers_enable_it() {
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
    assert_eq!(dependency["workspace"].as_bool(), Some(true));
    assert_eq!(dependency["optional"].as_bool(), Some(true));

    for (name, source) in [
        (
            "colorful-cli",
            include_str!("../../colorful-cli/Cargo.toml"),
        ),
        (
            "colorful-lsp",
            include_str!("../../colorful-lsp/Cargo.toml"),
        ),
    ] {
        let driver = manifest(source);
        let dependency = driver["dependencies"]["colorful-parse"]
            .as_table()
            .expect("driver parser dependency");
        let enabled = dependency["features"]
            .as_array()
            .expect("driver parser features");
        assert!(
            enabled
                .iter()
                .any(|feature| feature.as_str() == Some("markdown")),
            "{name} must enable colorful-parse/markdown"
        );
    }
}
