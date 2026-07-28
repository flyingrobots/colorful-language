use std::collections::BTreeSet;
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

fn production_dependencies(manifest: &toml::Value) -> BTreeSet<String> {
    let mut dependencies: BTreeSet<String> = manifest
        .get("dependencies")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|dependencies| dependencies.keys().cloned())
        .collect();
    for target in manifest
        .get("target")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|targets| targets.values())
    {
        dependencies.extend(
            target
                .get("dependencies")
                .and_then(toml::Value::as_table)
                .into_iter()
                .flat_map(|target_dependencies| target_dependencies.keys().cloned()),
        );
    }
    dependencies
}

#[test]
fn adapter_dependency_direction_preserves_pure_core_and_default_binaries() {
    let adapter = manifest("crates/colorful-vale/Cargo.toml");
    let adapter_dependencies = production_dependencies(&adapter);
    assert!(adapter_dependencies.contains("colorful-core"));
    assert!(!adapter_dependencies.contains("colorful-cli"));
    assert!(!adapter_dependencies.contains("colorful-lsp"));
    assert_eq!(
        adapter_dependencies,
        ["colorful-core", "serde", "serde_json"]
            .into_iter()
            .map(str::to_string)
            .collect(),
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
            !production_dependencies(&manifest(consumer)).contains("colorful-vale"),
            "{consumer} must not acquire a production Vale dependency"
        );
    }
}

#[test]
fn boundary_inventory_includes_target_specific_production_dependencies() {
    let manifest: toml::Value = toml::from_str(
        r#"
[target.'cfg(unix)'.dependencies]
colorful-vale = { path = "../colorful-vale" }
"#,
    )
    .expect("parse target-specific dependency");
    assert!(
        production_dependencies(&manifest).contains("colorful-vale"),
        "target-specific dependencies must not bypass the production boundary"
    );
}
