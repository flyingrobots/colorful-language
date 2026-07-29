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

#[test]
fn output_parser_has_one_typed_deserialization_owner() {
    let source = adapter_source("output.rs");
    assert!(!source.contains("serde_json::Value"));
    assert!(!source.contains("serde_json::from_value"));
    assert_eq!(
        source.matches("serde_json::from_str").count(),
        1,
        "Vale output must be deserialized exactly once"
    );
}

#[test]
fn output_parser_indexes_lines_once_per_response() {
    let source = adapter_source("output.rs");
    assert_eq!(
        source
            .matches("let line_index = LineIndex::new(source);")
            .count(),
        1,
        "the response parser must build exactly one document line index"
    );
    assert!(
        source.contains("normalize_alert(&line_index, alert)"),
        "every alert must reuse the response line index"
    );
    assert!(
        !source.contains("fn line_bounds(source: &str"),
        "alert normalization must not retain a source-rescanning helper"
    );
}

#[test]
fn process_deadline_precedes_completed_io_acceptance() {
    let source = adapter_source("process.rs");
    let loop_start = source
        .find("let process_result = loop")
        .expect("process lifecycle loop");
    let loop_end = source[loop_start..]
        .find("let input_result")
        .map(|offset| loop_start + offset)
        .expect("process lifecycle loop end");
    let lifecycle = &source[loop_start..loop_end];
    let deadline = lifecycle
        .find("if started.elapsed() >= timeout")
        .expect("deadline check");
    let completed = lifecycle
        .find("if let Some(status)")
        .expect("completed I/O acceptance");

    assert!(
        deadline < completed,
        "the global deadline must be checked before completed I/O is accepted"
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
fn workspace_dependency_entries_have_actual_consumers() {
    let workspace = manifest("Cargo.toml");
    let workspace_dependencies = workspace["workspace"]["dependencies"]
        .as_table()
        .expect("workspace dependencies");
    assert!(!workspace_dependencies.contains_key("colorful-vale"));
    for dependency in ["colorful-cli", "colorful-lsp"] {
        assert!(
            workspace_dependencies.contains_key(dependency),
            "{dependency} must be workspace-managed"
        );
    }

    let adapter = manifest("crates/colorful-vale/Cargo.toml");
    let development_dependencies = adapter["dev-dependencies"]
        .as_table()
        .expect("adapter development dependencies");
    for dependency in ["colorful-cli", "colorful-lsp"] {
        assert_eq!(
            development_dependencies[dependency]["workspace"].as_bool(),
            Some(true),
            "{dependency} must not duplicate the workspace version"
        );
    }
}
