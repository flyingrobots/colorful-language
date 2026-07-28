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
    let dependencies = adapter["dependencies"]
        .as_table()
        .expect("adapter dependencies");
    let mut dependency_names: Vec<_> = dependencies.keys().map(String::as_str).collect();
    dependency_names.sort_unstable();
    assert_eq!(
        dependency_names,
        ["colorful-core", "serde", "serde_json"],
        "prototype maintenance cost changed: review the adapter decision"
    );
    assert_eq!(
        adapter["package"]["publish"].as_bool(),
        Some(false),
        "the prototype must not silently become a release surface"
    );

    let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut source_modules: Vec<_> = fs::read_dir(source_root)
        .expect("read adapter source directory")
        .map(|entry| {
            entry
                .expect("source entry")
                .file_name()
                .into_string()
                .expect("UTF-8 source name")
        })
        .collect();
    source_modules.sort_unstable();
    assert_eq!(
        source_modules,
        [
            "config.rs",
            "error.rs",
            "lib.rs",
            "output.rs",
            "prepared.rs",
            "process.rs",
        ],
        "prototype maintenance surface changed: review the adapter decision"
    );

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
