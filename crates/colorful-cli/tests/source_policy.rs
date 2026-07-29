//! Source-policy evidence for the CLI's Markdown adapter opt-in.

#[test]
fn cli_enables_the_markdown_parser_adapter() {
    let manifest: toml::Value =
        toml::from_str(include_str!("../Cargo.toml")).expect("CLI manifest must parse");
    let dependency = manifest["dependencies"]["colorful-parse"]
        .as_table()
        .expect("colorful-parse dependency");
    let enabled = dependency["features"]
        .as_array()
        .expect("colorful-parse features");
    assert!(
        enabled
            .iter()
            .any(|feature| feature.as_str() == Some("markdown")),
        "colorful-cli must enable colorful-parse/markdown"
    );
}
