# colorful-language v0.2.1 — Release Packet

## Summary

`v0.2.1` is the public recovery release for Goalpost 1, "prose linter." It
ships the same user-facing scope intended for `v0.2.0`: deterministic prose
diagnostics in the CLI and LSP, the first public `colorful.syntax/v1` surface IR,
the `colorful.vocabulary/v1` presentation manifest, and source editor
integrations.

The `v0.2.0` tag workflow published `colorful-core`, `colorful-lexicon`, and
`colorful-parse`, then failed while verifying the `colorful-ir` crate package.
`v0.2.1` fixes that package boundary and adds a CI package witness so this class
of release failure is caught before crates are published.

## Included scope

- Everything listed in the [`v0.2.0` release packet](../v0.2.0/release.md).
- `colorful-ir` now embeds package-local copies of the GraphQL and vocabulary
  contract inputs it hashes and validates.
- `scripts/gen-ir.sh` refreshes the package-local `colorful-ir` contract copies
  whenever the Wesley-generated DTOs are regenerated.
- CI now runs `scripts/package-witness.sh`, which packages all publishable
  crates, extracts the tarballs, and checks the extracted package workspace.
- The tag-triggered `Release` workflow runs the same package witness before
  `cargo publish`, so future package-tarball failures stop before any crate is
  uploaded.

## Version justification

`0.2.1` is a pre-1.0 patch release. The intended public API and behavior are the
same as `0.2.0`, but the `v0.2.0` crates.io publish was incomplete and crate
versions are immutable once uploaded. A patch version is required to publish a
complete, coherent release train.

## Explicit non-claims

- **Not a new feature release beyond `v0.2.0`.** The patch fixes packaging and
  release verification.
- **Not a grammar checker.** The linter reports deterministic candidates for
  shallow issues. It does not understand author intent or rewrite prose.
- **Not contextual POS disambiguation.** Open-class noun/verb/adjective/adverb
  disambiguation remains Goalpost 2.
- **Not replayable provenance.** `colorful.syntax/v1` carries source digests and
  derivation trace seed data, but it does not yet claim echo replay or witnessed
  provenance.
- **IR consumers remain open.** The core IR and graft reference consumer ship in
  this release, but the tracked graft and jedit consumer slices remain open.
- **Editor marketplace packages are not published.** VS Code and Zed source
  integrations build in CI and can be installed from source; registry/marketplace
  publishing is a later task.
- **Controlled English is not shipped.** Contract English, Intent English, and
  proof-carrying execution remain roadmap phases.

## Acceptance

- The full `v0.2.0` acceptance set still applies.
- `colorful-ir` package contents are checked by `scripts/package-witness.sh`.
- The package witness is part of pull-request CI.
- The tag-triggered `Release` workflow runs the package witness before publish.

See [`verification.md`](verification.md) for the release witness.
