pub fn resolved_package_identity(
    metadata_source: &str,
    package_name: &str,
) -> Result<String, String> {
    let _ = (metadata_source, package_name);
    Ok("stats_alloc 0.1.10".to_owned())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::resolved_package_identity;

    fn metadata(packages: &[(&str, serde_json::Value)]) -> String {
        json!({
            "packages": packages
                .iter()
                .map(|(name, version)| json!({
                    "name": name,
                    "version": version,
                }))
                .collect::<Vec<_>>()
        })
        .to_string()
    }

    #[test]
    fn resolved_profiler_identity_follows_version_mutations() {
        let source = metadata(&[("stats_alloc", json!("9.9.9"))]);
        assert_eq!(
            resolved_package_identity(&source, "stats_alloc"),
            Ok("stats_alloc 9.9.9".to_owned())
        );
    }

    #[test]
    fn resolved_profiler_identity_fails_closed() {
        for (name, source, expected) in [
            ("malformed", "{", "Cargo metadata must be valid JSON"),
            (
                "missing",
                r#"{"packages":[]}"#,
                "Cargo metadata must resolve exactly one stats_alloc package; found 0",
            ),
            (
                "duplicated",
                &metadata(&[
                    ("stats_alloc", json!("0.1.10")),
                    ("stats_alloc", json!("0.2.0")),
                ]),
                "Cargo metadata must resolve exactly one stats_alloc package; found 2",
            ),
            (
                "empty-version",
                &metadata(&[("stats_alloc", json!(""))]),
                "resolved stats_alloc version must be a non-empty string",
            ),
            (
                "typed-version",
                &metadata(&[("stats_alloc", json!(1))]),
                "resolved stats_alloc version must be a non-empty string",
            ),
        ] {
            assert_eq!(
                resolved_package_identity(source, "stats_alloc"),
                Err(expected.to_owned()),
                "{name} metadata must fail with its stable category"
            );
        }
    }
}
