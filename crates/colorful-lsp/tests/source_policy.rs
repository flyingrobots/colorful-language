//! Source-policy evidence for the LSP's Markdown adapter opt-in.

#[test]
fn lsp_enables_the_markdown_parser_adapter() {
    let manifest: toml::Value =
        toml::from_str(include_str!("../Cargo.toml")).expect("LSP manifest must parse");
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
        "colorful-lsp must enable colorful-parse/markdown"
    );
}
