//! Keeps `CONTRIBUTING.md`'s "Architecture Expectations" port bullets in sync
//! with `colorful-core`'s actual public traits: if a port trait is added,
//! renamed, or removed there without updating `CONTRIBUTING.md`, this test
//! fails instead of the contributor guide quietly citing a symbol that no
//! longer exists (the `Tagger`-vs-`Parser` drift this test was added to catch,
//! see #98).

use std::collections::BTreeSet;

/// Every `pub trait NAME` declared in `core_source`.
fn trait_names(core_source: &str) -> BTreeSet<&str> {
    core_source
        .lines()
        .filter_map(|line| line.trim().strip_prefix("pub trait "))
        .filter_map(|rest| {
            rest.split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// Every backtick-quoted name in a `- \`Name\` — ...` bullet directly under
/// `section`. Only a real bullet counts, not a name merely mentioned in
/// surrounding prose.
fn documented_symbol_names(section: &str) -> BTreeSet<&str> {
    section
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- `"))
        .filter_map(|rest| rest.split('`').next())
        .collect()
}

#[test]
fn contributing_architecture_names_match_public_port_traits() {
    let core_source = include_str!("../src/lib.rs");

    let contributing_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../CONTRIBUTING.md");
    let Ok(contributing) = std::fs::read_to_string(contributing_path) else {
        eprintln!("skipping: {contributing_path} not found (not a full workspace checkout)");
        return;
    };

    let section = contributing
        .split("## Architecture Expectations")
        .nth(1)
        .expect("CONTRIBUTING.md has an ## Architecture Expectations section");
    // Stop at the next top-level heading so a bullet from an unrelated
    // section can't be picked up.
    let section = section.split("\n## ").next().unwrap_or(section);

    let documented = documented_symbol_names(section);
    let actual = trait_names(core_source);

    assert!(
        !actual.is_empty(),
        "expected to find at least one `pub trait` in colorful-core/src/lib.rs"
    );

    // Exact, bidirectional equality: a trait missing from the contributor guide bullets
    // fails, and so does a bullet naming a trait that no longer exists or is not a pub trait.
    assert_eq!(
        documented, actual,
        "CONTRIBUTING.md's Architecture Expectations port bullets and colorful-core's `pub trait`s \
         must match exactly -- left is documented, right is actual"
    );
}
