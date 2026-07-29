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

fn adapter_source(file: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file))
        .unwrap_or_else(|error| panic!("read adapter source {file}: {error}"))
}

fn adapter_test_source(file: &str) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join(file),
    )
    .unwrap_or_else(|error| panic!("read adapter test source {file}: {error}"))
}

fn workspace_flag(dependencies: &toml::value::Table, dependency: &str) -> Option<bool> {
    dependencies
        .get(dependency)
        .and_then(|entry| entry.get("workspace"))
        .and_then(toml::Value::as_bool)
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
        ["colorful-core", "rustix", "serde", "serde_json"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        "prototype maintenance cost changed: review the adapter decision"
    );
    assert_eq!(
        adapter
            .get("package")
            .and_then(toml::Value::as_table)
            .and_then(|package| package.get("publish"))
            .and_then(toml::Value::as_bool),
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

#[test]
fn linting_reference_resolves_an_absolute_vale_executable() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root");
    let reference = fs::read_to_string(root.join("docs/topics/linting/README.md"))
        .expect("read linting reference");

    assert!(
        !reference.contains("ValeConfig::new(\"vale\","),
        "the isolated child cannot portably resolve a bare executable"
    );
    assert!(
        reference.contains(".filter(|path| path.is_absolute())")
            && reference.contains("VALE_BIN must name an absolute Vale executable"),
        "the example must validate its caller-selected executable before discovery"
    );
}

#[test]
fn adapter_process_tests_do_not_mutate_global_environment() {
    let source = adapter_test_source("vale_adapter.rs");
    assert!(!source.contains("std::env::set_var"));
    assert!(!source.contains("std::env::remove_var"));
    assert!(!source.contains("ENVIRONMENT_LOCK"));

    let process = adapter_source("process.rs");
    assert!(
        process.contains("const ISOLATED_PATH"),
        "the minimal child search path needs one documented owner"
    );
}

#[test]
fn delayed_pid_evidence_uses_a_reaped_child() {
    let source = adapter_test_source("vale_adapter.rs");
    assert!(
        !source.contains("u32::MAX"),
        "PID evidence must not use a value that can narrow to process-group semantics"
    );
    assert!(
        source.contains("Command::new(\"/bin/sleep\")")
            && source.contains("delayed worker must be reaped"),
        "delayed PID evidence must own and reap a real short-lived child"
    );
}

#[test]
fn workspace_dependency_entry_requires_a_workspace_flag() {
    let manifest = toml::from_str::<toml::Value>(
        r#"
[dev-dependencies]
colorful-cli = "0.4.0"
"#,
    )
    .expect("parse scalar dependency fixture");
    let dependencies = manifest
        .get("dev-dependencies")
        .and_then(toml::Value::as_table)
        .expect("fixture dependencies");

    let result = std::panic::catch_unwind(|| workspace_flag(dependencies, "colorful-cli"));
    assert!(
        matches!(result, Ok(None)),
        "a scalar dependency must reach the explicit workspace assertion"
    );
}

#[test]
fn maintenance_reference_names_the_workspace_acceptance_floor() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root");
    let reference =
        fs::read_to_string(root.join("docs/workflows/repository-maintenance/README.md"))
            .expect("read maintenance reference");

    assert!(reference.contains("The 92% workspace acceptance floor"));
    assert!(!reference.contains("The 92% workspace percentage"));
}

#[test]
fn workspace_dependency_entries_have_actual_consumers() {
    let workspace = manifest("Cargo.toml");
    let workspace_dependencies = workspace
        .get("workspace")
        .and_then(toml::Value::as_table)
        .and_then(|workspace| workspace.get("dependencies"))
        .and_then(toml::Value::as_table)
        .expect("workspace dependencies");
    assert!(!workspace_dependencies.contains_key("colorful-vale"));
    for dependency in ["colorful-cli", "colorful-lsp"] {
        assert!(
            workspace_dependencies.contains_key(dependency),
            "{dependency} must be workspace-managed"
        );
    }

    let adapter = manifest("crates/colorful-vale/Cargo.toml");
    let development_dependencies = adapter
        .get("dev-dependencies")
        .and_then(toml::Value::as_table)
        .expect("adapter development dependencies");
    for dependency in ["colorful-cli", "colorful-lsp"] {
        assert_eq!(
            workspace_flag(development_dependencies, dependency),
            Some(true),
            "{dependency} must not duplicate the workspace version"
        );
    }
}
