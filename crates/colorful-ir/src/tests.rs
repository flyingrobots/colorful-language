use super::*;

#[test]
fn logical_line_break_count_treats_crlf_as_one_break() {
    assert_eq!(logical_line_break_count(""), 0);
    assert_eq!(logical_line_break_count("\n"), 1);
    assert_eq!(logical_line_break_count("\r"), 1);
    assert_eq!(logical_line_break_count("\r\n"), 1);
    assert_eq!(logical_line_break_count("\n\n"), 2);
    assert_eq!(logical_line_break_count("\r\r"), 2);
    assert_eq!(logical_line_break_count("\r\n\r\n"), 2);
    // A lone \n immediately followed by a \r\n pair: two independent
    // break events, not three -- the \r\n is still one break.
    assert_eq!(logical_line_break_count("\n\r\n"), 2);
}

#[test]
fn is_paragraph_break_requires_only_whitespace_between_the_breaks() {
    assert!(is_paragraph_break("\n\n"));
    assert!(is_paragraph_break("\r\r"));
    assert!(is_paragraph_break("\n  \n"));
    assert!(!is_paragraph_break("\n"));
    // Two breaks with non-whitespace between them is not a blank line,
    // even though the break count alone would say otherwise.
    assert!(!is_paragraph_break("\nx\n"));
}

#[test]
fn canonical_json_sorts_keys_and_is_compact() {
    let range = syntax_v1::ByteRange {
        start_utf8: 1,
        end_utf8: 4,
    };
    // Keys sorted lexicographically ("endUtf8" < "startUtf8"), no spaces.
    assert_eq!(
        canonical_json(&range).unwrap(),
        r#"{"endUtf8":4,"startUtf8":1}"#
    );
}

#[test]
fn round_trips_in_rust() {
    let range = syntax_v1::ByteRange {
        start_utf8: 2,
        end_utf8: 9,
    };
    let a = canonical_json(&range).unwrap();
    let decoded: syntax_v1::ByteRange = serde_json::from_str(&a).unwrap();
    let c = canonical_json(&decoded).unwrap();
    assert_eq!(a, c);
}

#[test]
fn schema_hash_is_stable_and_prefixed() {
    let hash = syntax_schema_hash();
    assert!(hash.starts_with("sha256:"));
    assert_eq!(hash, syntax_schema_hash());
}

#[test]
fn packaged_compatibility_manifest_names_the_current_identity() {
    let manifest: serde_json::Value = serde_json::from_str(SYNTAX_COMPATIBILITY_V1).unwrap();
    let current = &manifest["currentIdentity"];
    assert_eq!(current["contractVersion"], CONTRACT_VERSION);
    assert_eq!(current["schemaHash"], syntax_schema_hash());
    assert_eq!(current["vocabularyHash"], vocabulary_hash());
    let matching_generations = manifest["generations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|generation| generation.get("identity") == Some(current))
        .count();
    assert_eq!(matching_generations, 1);
}

#[test]
fn legacy_vocabulary_schema_hash_alias_matches_manifest_hash() {
    assert_eq!(vocabulary_schema_hash(), vocabulary_hash());
}

#[test]
fn strip_graphql_descriptions_removes_only_description_lines() {
    let sdl = concat!(
        "\"A description.\"\n",
        "type Foo {\n",
        "  bar: Int!\n",
        "}\n",
        "\"\"\"\n",
        "A block description.\n",
        "With a second line.\n",
        "\"\"\"\n",
        "enum Choice {\n",
        "  YES\n",
        "}\n",
    );
    let stripped = strip_graphql_descriptions(sdl);
    assert!(!stripped.contains("A description."));
    assert!(!stripped.contains("A block description."));
    assert!(!stripped.contains("With a second line."));
    assert!(stripped.contains("type Foo"));
    assert!(stripped.contains("bar: Int!"));
    assert!(stripped.contains("enum Choice"));
}

#[test]
fn schema_hash_is_unchanged_by_a_description_only_edit() {
    let a = "\"Old description.\"\ntype Foo {\n  bar: Int!\n}\n";
    let b = "\"New, unrelated description.\"\ntype Foo {\n  bar: Int!\n}\n";
    assert_eq!(
        sha256_hex(strip_graphql_descriptions(a).as_bytes()),
        sha256_hex(strip_graphql_descriptions(b).as_bytes()),
        "a description-only edit must not change the normalized schema hash"
    );
}

#[test]
fn schema_hash_changes_when_shape_changes() {
    let a = "\"A description.\"\ntype Foo {\n  bar: Int!\n}\n";
    let b = "\"A description.\"\ntype Foo {\n  bar: Int!\n  baz: String!\n}\n";
    assert_ne!(
        sha256_hex(strip_graphql_descriptions(a).as_bytes()),
        sha256_hex(strip_graphql_descriptions(b).as_bytes()),
        "a real field/type edit must still change the normalized schema hash"
    );
}
