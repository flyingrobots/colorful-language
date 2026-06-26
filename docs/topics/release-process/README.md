# Release process

The release process turns a completed goalpost into a versioned public artifact.
It is documented as a current operational contract because release mistakes are
expensive and externally visible.

## Current behavior

Releases are prepared on a branch, reviewed through a pull request, merged to
`main`, and published by pushing an annotated `vX.Y.Z` tag on `main`.

The durable runbook is [`docs/RELEASING.md`](../../RELEASING.md). It defines:

- required release artifacts;
- discovery and guard checks;
- version bump and changelog steps;
- local validation commands;
- tag and publish steps;
- crates.io ownership and publish constraints.

Each release also has a packet under `docs/goalposts/vX.Y.Z/`:

- `release.md` states what is shipping, why the version is correct, what is not
  claimed, and how the release is accepted.
- `verification.md` records commands, results, tag SHAs, publish status, and
  release URLs.

## Automation

The tag-triggered release workflow runs when a `v*` tag is pushed. It verifies
that the tag is on `main`, reruns the Rust and package guards, publishes the
crates in dependency order, builds the Linux binary archive, writes a checksum,
and creates the GitHub Release.

The workflow relies on the pre-merge gate for checks that are not repeated on
tag pushes. Pull-request CI covers Markdown lint, whitespace checks, the IR
witness, and editor integration compile. Workflow lint is part of the local
release gate in [`docs/RELEASING.md`](../../RELEASING.md) until an `actionlint`
step is added to CI.

## Boundaries

The release process topic describes how this repository releases. It is not a
changelog and should not duplicate per-version notes from `CHANGELOG.md` or the
goalpost packets.

See the [test plan](test-plan.md) for the cases that pin this behavior.
