//! Keeps `README.md`'s "Architecture" port list in sync with `colorful-core`'s
//! actual public traits: if a `pub trait` is added, renamed, or removed there
//! without updating the README, this test fails instead of the docs quietly
//! drifting from the real port inventory.

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
    // Stop at the next top-level heading so a port name mentioned elsewhere
    // in the README can't produce a false pass.
    let architecture_section = architecture_section
        .split("\n## ")
        .next()
        .unwrap_or(architecture_section);

    let mut port_traits_found = 0;
    for line in core_source.lines() {
        let Some(rest) = line.trim().strip_prefix("pub trait ") else {
            continue;
        };
        let name = rest
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .next()
            .filter(|s| !s.is_empty())
            .expect("a trait name follows `pub trait `");
        port_traits_found += 1;
        assert!(
            architecture_section.contains(name),
            "colorful-core exports `pub trait {name}` but README.md's \
             Architecture section doesn't mention it -- update the port list"
        );
    }

    assert!(
        port_traits_found > 0,
        "expected to find at least one `pub trait` in colorful-core/src/lib.rs"
    );
}
