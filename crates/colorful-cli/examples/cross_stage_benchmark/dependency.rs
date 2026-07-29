pub fn resolved_package_identity(
    metadata_source: &str,
    package_name: &str,
) -> Result<String, String> {
    let metadata: serde_json::Value = serde_json::from_str(metadata_source)
        .map_err(|_| "Cargo metadata must be valid JSON".to_owned())?;
    let packages = metadata
        .get("packages")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Cargo metadata packages must be an array".to_owned())?;
    let matches = packages
        .iter()
        .filter(|package| {
            package.get("name").and_then(serde_json::Value::as_str) == Some(package_name)
        })
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(format!(
            "Cargo metadata must resolve exactly one {package_name} package; found {}",
            matches.len()
        ));
    }
    let version = matches[0]
        .get("version")
        .and_then(serde_json::Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| format!("resolved {package_name} version must be a non-empty string"))?;
    Ok(format!("{package_name} {version}"))
}
