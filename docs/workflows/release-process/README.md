# Release process

The release process turns a completed goalpost into a versioned public artifact.
It is documented as a contributor workflow because release mistakes are
expensive, operational, and externally visible.

## Current behavior

This repo adapts the Continuum release lifecycle through
[`../../RELEASING.md`](../../RELEASING.md) and the repo-local profile at
[`../../../.continuum/release.yml`](../../../.continuum/release.yml).

The current release path is:

```text
release branch -> PR -> merge to main -> manual annotated tag -> tag workflow
-> native/editor build and attestation -> crates.io + editor publication
-> GitHub Release -> Zed registry PR -> public verification -> retrospective
```

There is no autotag workflow yet. Manual tagging is the current supported path,
but it must run final preflight and must not bypass failed gates.

Releases are prepared on a branch, reviewed through a pull request, merged to
`main`, and published by pushing an annotated `vX.Y.Z` tag on `main`.

The durable runbook is [`docs/RELEASING.md`](../../RELEASING.md). It defines:

- the release doctrine and lifecycle;
- the repo profile and release signposts;
- required release artifacts;
- thesis, scope, milestone, and signpost discipline;
- release-prep and preflight validation commands;
- tag, publish, verification, failure handling, and retrospective steps;
- crates.io ownership and publish constraints.

Each release also has a packet under `docs/goalposts/vX.Y.Z/`:

- `release.md` states what is shipping, why the version is correct, what is not
  claimed, and how the release is accepted.
- `verification.md` records commands, results, tag SHAs, publish status, and
  release URLs.

## Automation

The release profile is checked by CI and by the tag-triggered release workflow:

```bash
bash scripts/release-profile-check.sh
```

Editor adapters follow the same fixed release version as the Cargo workspace.
For a pre-1.0 `0.Y.Z` release, each adapter accepts stable `colorful-lsp`
versions from `>=0.Y.0` through `<0.(Y+1).0`. The next minor is potentially
breaking, and prereleases are unsupported. The release profile lists the Cargo,
VS Code, and Zed version sources. CI, release preparation, and tag publication
enforce them with:

```bash
npm ci
node scripts/check-editor-version-policy.mjs
```

The dependency install must precede the checker because the checker parses the
release profile with the repository-pinned YAML implementation.

Release-prep validation is executable:

```bash
bash scripts/release-prep.sh
```

The prep gate runs the deterministic distribution policy and mutation suite.
That policy pins the three native host/target pairs, requires checksums and
GitHub/Sigstore provenance, requires one clean-install-tested VSIX for both
editor registries, verifies publisher credentials before immutable
publication, and keeps observational startup timing outside correctness gates.

That gate validates the canonical
`contracts/colorful/syntax-compatibility.v1.json` authority before packaging.
For `colorful.syntax/v1`, description-only SDL edits preserve the current
generation; additive nullable fields, vocabulary changes, and schema-hash
algorithm changes require a new explicit generation with migration evidence.
Required fields, removals, reinterpretations, and existing-enum changes require
a deliberately versioned contract. A release must not infer compatibility from
its tag or publish an unregistered identity tuple.

Final manual tag preflight is executable from clean, aligned `main`:

```bash
bash scripts/release-preflight.sh vX.Y.Z
```

The tag-triggered release workflow runs when a `v*` tag is pushed. It verifies
the profile, verifies that release metadata matches the tag, verifies that the
tag is on `main`, and reruns the Rust and package guards. Native matrix jobs
build `colorful` and `colorful-lsp` for Linux x86-64, Apple Silicon, and
Windows x86-64, then publish checksummed archives with GitHub/Sigstore
provenance. The release job clean-installs one exact VSIX, publishes those bytes
to VS Code Marketplace and Open VSX, packages the byte-validated Zed source
tree, publishes crates in dependency order, and attaches every reviewed asset
to the GitHub Release.

Zed registry publication remains an owner-submitted pull request to
`zed-industries/extensions`; the release workflow supplies the versioned,
licensed source archive and provenance but cannot merge into the external
registry. Current-reference marketplace URLs remain absent until the public
entries resolve.

The crates.io publish step skips crate versions that are already available in
the crates.io registry index, so rerunning the workflow after a partial publish
can continue without moving the tag. The release job timeout is sized for the
aggregate index-readiness polling window across all eight crates.

Editor publication is also rerun-safe: both publishers receive the exact
smoke-tested VSIX with duplicate-version handling enabled. The workflow then
downloads the exact public version from both registries and requires both
SHA-256 digests to match the smoke witness before publishing crates. Credential
checks run before crates or editor packages are published, so a missing
publisher identity fails closed before the workflow creates a partial
multi-registry release.

PR CI and release preparation derive internal normal, build, and dev
dependencies from `cargo metadata`, require the release profile and tag
workflow to declare the same complete publish order, and reject any dependency
that does not precede its dependent.

The workflow relies on the pre-merge gate for checks that are not repeated on
tag pushes. Pull-request CI covers Markdown lint, whitespace checks, the IR
witness, editor integration compile, and release profile validation. Workflow
lint is part of the local release-prep gate in
[`docs/RELEASING.md`](../../RELEASING.md).

## Boundaries

The release process workflow describes how this repository releases. It is not a
product topic, changelog, or per-version note. Do not duplicate per-version
notes from `CHANGELOG.md` or the goalpost packets here.

See the [test plan](test-plan.md) for the cases that pin this behavior.
