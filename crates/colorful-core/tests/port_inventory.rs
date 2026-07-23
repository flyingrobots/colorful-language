//! Keeps `README.md`'s "Architecture" port list in sync with `colorful-core`'s
//! actual public traits: if a `pub trait` is added, renamed, or removed there
//! without updating the README, this test fails instead of the docs quietly
//! drifting from the real port inventory.
//!
//! Cited as a self-consistency check in `docs/README.md`.

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

/// Every port name documented as a `- \`Name\` — ...` bullet directly under
/// `architecture_section`. Only a real bullet counts -- a name merely
/// mentioned in surrounding prose does not, so deleting a bullet (even while
/// prose elsewhere still says the word) is detected.
fn documented_port_names(architecture_section: &str) -> BTreeSet<&str> {
    architecture_section
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- `"))
        .filter_map(|rest| rest.split('`').next())
        .collect()
}

#[test]
fn readme_architecture_names_every_public_port_trait() {
    let core_source = include_str!("../src/lib.rs");

    // This checks the *workspace* README against colorful-core's own source,
    // so it only makes sense from a full checkout. `scripts/package-witness.sh`
    // test-compiles this crate extracted standalone via `cargo package`, where
    // the workspace README isn't present (and can't be: `cargo package`
    // refuses to include paths outside the crate directory) -- read at
    // runtime and skip gracefully there instead of failing to compile on an
    // irrelevant environment difference.
    let readme_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../README.md");
    let Ok(readme) = std::fs::read_to_string(readme_path) else {
        eprintln!("skipping: {readme_path} not found (not a full workspace checkout)");
        return;
    };

    let architecture_section = readme
        .split("## Architecture")
        .nth(1)
        .expect("README.md has an ## Architecture section");
    // Stop at the next top-level heading so a bullet from an unrelated
    // section can't be picked up.
    let architecture_section = architecture_section
        .split("\n## ")
        .next()
        .unwrap_or(architecture_section);

    let documented = documented_port_names(architecture_section);
    let actual = trait_names(core_source);

    assert!(
        !actual.is_empty(),
        "expected to find at least one `pub trait` in colorful-core/src/lib.rs"
    );
    // Exact, bidirectional equality: a trait missing from the README bullets
    // fails (drift the old version of this test caught), and so does a
    // README bullet naming a trait that no longer exists (drift it did not).
    assert_eq!(
        documented, actual,
        "README.md's Architecture port bullets and colorful-core's `pub trait`s \
         must match exactly -- left is documented, right is actual"
    );
}
