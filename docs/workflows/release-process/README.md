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
-> crates.io publish -> GitHub Release -> public verification -> retrospective
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

Release-prep validation is executable:

```bash
bash scripts/release-prep.sh
```

Final manual tag preflight is executable from clean, aligned `main`:

```bash
bash scripts/release-preflight.sh vX.Y.Z
```

The tag-triggered release workflow runs when a `v*` tag is pushed. It verifies
the profile, verifies that release metadata matches the tag, verifies that the
tag is on `main`, reruns the Rust and package guards, publishes the crates in
dependency order, builds one
`x86_64-unknown-linux-gnu` archive containing the `colorful` and `colorful-lsp`
binaries, writes a checksum, and creates the GitHub Release.

The crates.io publish step skips crate versions that are already available in
the crates.io registry index, so rerunning the workflow after a partial publish
can continue without moving the tag. The release job timeout is sized for the
aggregate index-readiness polling window across all seven crates.

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
