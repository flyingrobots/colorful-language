use std::fs;
use std::path::Path;

fn manifest(relative: &str) -> toml::Value {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root");
    toml::from_str(
        &fs::read_to_string(root.join(relative))
            .unwrap_or_else(|error| panic!("read {relative}: {error}")),
    )
    .unwrap_or_else(|error| panic!("parse {relative}: {error}"))
}

fn normal_dependency(manifest: &toml::Value, dependency: &str) -> bool {
    manifest
        .get("dependencies")
        .and_then(toml::Value::as_table)
        .is_some_and(|dependencies| dependencies.contains_key(dependency))
}

#[test]
fn adapter_dependency_direction_preserves_pure_core_and_default_binaries() {
    let adapter = manifest("crates/colorful-vale/Cargo.toml");
    assert!(normal_dependency(&adapter, "colorful-core"));
    assert!(!normal_dependency(&adapter, "colorful-cli"));
    assert!(!normal_dependency(&adapter, "colorful-lsp"));

    for consumer in [
        "crates/colorful-core/Cargo.toml",
        "crates/colorful-cli/Cargo.toml",
        "crates/colorful-lsp/Cargo.toml",
    ] {
        assert!(
            !normal_dependency(&manifest(consumer), "colorful-vale"),
            "{consumer} must not acquire a production Vale dependency"
        );
    }
}
