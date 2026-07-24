//! Keeps `CONTRIBUTING.md`'s "Architecture Expectations" port bullets in sync
//! with `colorful-core`'s actual public symbols: if a port is renamed or
//! removed there without updating `CONTRIBUTING.md`, this test fails instead
//! of the contributor guide quietly citing a symbol that no longer exists
//! (the `Tagger`-vs-`Parser` drift this test was added to catch, see #98).

use std::collections::BTreeSet;

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

/// Whether `name` is declared as a `pub trait`, `pub struct`, `pub enum`, or
/// `pub fn` anywhere in `core_source`. Broad on purpose: `CONTRIBUTING.md`
/// cites port traits today, but this must not need updating just because a
/// future edit cites a public struct or function instead.
fn is_public_symbol(core_source: &str, name: &str) -> bool {
    ["pub trait ", "pub struct ", "pub enum ", "pub fn "]
        .iter()
        .any(|prefix| {
            core_source.lines().any(|line| {
                line.trim()
                    .strip_prefix(prefix)
                    .and_then(|rest| {
                        rest.split(|c: char| !c.is_alphanumeric() && c != '_')
                            .next()
                    })
                    .is_some_and(|found| found == name)
            })
        })
}

#[test]
fn contributing_architecture_names_only_real_public_symbols() {
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
    assert!(
        !documented.is_empty(),
        "expected CONTRIBUTING.md's Architecture Expectations section to list \
         at least one `- `Name`` bullet"
    );

    let missing: Vec<&str> = documented
        .iter()
        .filter(|name| !is_public_symbol(core_source, name))
        .copied()
        .collect();

    assert!(
        missing.is_empty(),
        "CONTRIBUTING.md's Architecture Expectations section names {missing:?}, \
         which is not a `pub trait`/`pub struct`/`pub enum`/`pub fn` in \
         colorful-core/src/lib.rs -- update CONTRIBUTING.md or restore the symbol"
    );
}
