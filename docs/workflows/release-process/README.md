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
release branch -> PR -> merge to main -> final preflight -> release dry run
-> manual annotated tag -> tag workflow
-> final read-only admission -> native/editor build and attestation
-> crates.io + editor publication
-> GitHub Release -> Zed registry PR -> public verification -> retrospective
```

There is no autotag workflow yet. Manual tagging is the current supported path,
but it must run final preflight and must not bypass failed gates.

Releases are prepared on a branch, reviewed through a pull request, merged to
`main`, and published by pushing an annotated `vX.Y.Z` tag on `main`.
GitHub milestones are goalposts. Release trains use one versioned tracking
issue; slice issues keep their goalpost milestone. The tracking issue owns the
release thesis and scope links without becoming a second product milestone.
The current cross-cutting tracker command selects the existing `area:core`
query axis alongside its `documentation` and `slice` roles. The maintenance
gate rejects missing, duplicate, or substituted labels in that worked command.

The durable runbook is [`docs/RELEASING.md`](../../RELEASING.md). It defines:

- the release doctrine and lifecycle;
- the repo profile and release signposts;
- required release artifacts;
- thesis, scope, release-tracking issue, and signpost discipline;
- release-prep and preflight validation commands;
- tag, publish, verification, failure handling, and retrospective steps;
- crates.io ownership and publish constraints.

Each release also has a packet under `docs/goalposts/vX.Y.Z/`:

- `release.md` states what is shipping, why the version is correct, what is not
  claimed, and how the release is accepted.
- `verification.md` records commands, results, tag SHAs, publish status, and
  release URLs.

The workspace version selects the packet, and fetched release tags reachable
from the current history select the previous public release. A predecessor
from v0.1.0 through v0.3.0 must have a non-empty retrospective with one
explicit completed status before a new train is admitted. A later predecessor
witness must pass the same phase matrix as a current witness, checked against
its own version, its own previous public tag, and the commit its annotated tag
resolves to, and must be at `retrospected`, the only phase that admits a
successor; a contradictory witness or any earlier phase fails with
`E_RELEASE_PACKET_EVIDENCE`. CI, release preparation, and tag admission fail closed
unless both versions have corresponding packets, the planned packet contains a
concrete thesis and an exact target/previous-tag decision, every scope bucket is
non-empty, and two to five uniquely labeled goalposts are defined. Each
goalpost must have a same-label acceptance item with an inline command or
non-issue URL as its observable oracle. Inline and reference-style issue links
share one exhaustive slice inventory; non-claims and rollback posture are also
required. A workspace version behind the latest reachable public tag is
rejected instead of being treated as a new release.
Before the tag, the verification witness must name the exact target,
previous tag, and unavailable target tag; leave registry, public-install, and
retrospective sections with exactly one explicit unavailable or pending
`Evidence state:`; and contain no completed claim hidden in ordinary prose,
commit identifiers, literal code or HTML blocks, or inline or reference-style
link destinations.
The same witness advances through a fail-closed phase matrix:

| Release phase | Target tag | Publication | Public verification | Retrospective |
| --- | --- | --- | --- | --- |
| `pre-publication` | unavailable | unavailable | unavailable | unavailable |
| `tagged` | available | unavailable | unavailable | unavailable |
| `published` | available | completed | unavailable | unavailable |
| `verified` | available | completed | completed | unavailable |
| `retrospected` | available | completed | completed | completed |

`pre-publication` is admitted while the target tag does not resolve and on
the exact commit the annotated target tag resolves to, which is the commit the
tag workflow validates. On any later commit a resolving target tag rejects
`pre-publication`. `tagged` records that the annotated tag exists and
publication has not completed; it is admitted only while the annotated target
tag resolves from the checked history, so an absent, lightweight, or
unreachable tag rejects it.
A completed publication records the full commit behind the annotated target
tag, one immutable GitHub Actions run URL, and the exact GitHub Release tag URL.
Completed public verification records dated passed verification and rollback or
patch-forward results. A completed retrospective records one completed status
plus plan-versus-actual, fallout, repeatable-wins, and next-recommendation
entries. Every opened gate rejects unavailable placeholders, and every
unopened gate rejects completed or public evidence. The current phase policy
compares the active witness with its `origin/main` merge-base witness, so a
later branch cannot rewrite the file backward to an earlier phase. A missing
remote-tracking ref or a packet absent from that base is portable baseline
absence; once the ref and packet exist, merge-base and witness-read failures
fail closed. Historical v0.1.0 through v0.3.0 witnesses remain readable in their
original shapes; when one of them is the immediate predecessor it keeps the
narrower completed-retrospective admission check.
The packet parser registers the exact-pinned GFM table grammar, so tables are
validated as rows and cells rather than accidental paragraph text.

## Automation

The release profile is checked by CI and by the tag-triggered release workflow:

```bash
bash scripts/release-profile-check.sh
```

The packet policy has a deterministic mutation suite and a live repository
check. Run the self-test first so a broken policy implementation cannot admit
its own packet:

```bash
node --test scripts/check-release-packet.test.mjs
node scripts/check-release-packet.mjs
```

The same checker parses workflow jobs and shell command structure. The self-test
and live check must remain an ordered, unconditional, fail-closed executable
sequence in one CI job, the tag workflow's `validate-release` job, and the top
level of `scripts/release-prep.sh`. Every other tag-workflow job must depend on
`validate-release` transitively, so publication cannot run beside rather than
behind packet admission. Comments, workflow data, conditional or
failure-tolerant steps, unreachable branches, and commands after shell
termination do not satisfy the gate. Local commands inside operator-guarded
brace or subshell groups are not treated as top-level preparation evidence.

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
GitHub/Sigstore provenance, derives one Homebrew formula from the verified
Linux x86-64 and Apple Silicon archives without rebuilding them, requires one
clean-install-tested VSIX as the required GitHub Release editor asset, rejects
marketplace credentials and publisher commands from the required tag path, and
keeps observational startup timing outside correctness gates.
The tag workflow reruns its profile, editor compatibility, Rust, release-build,
and package-witness guards in `validate-release`; native jobs cannot build,
attest, or upload artifacts until that read-only admission job passes.
The release job installs Ruby 3.4.10 through a reviewed full-SHA
`ruby/setup-ruby` action before it parses the generated Homebrew formula, so
formula syntax evidence does not depend on the runner's ambient Ruby.

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

After preflight passes, a green release workflow dry run on that commit comes
before the tag. A manual `workflow_dispatch` run of the release workflow on
`main` is a dry run: the event selects the mode, and the workflow has no
dispatch inputs. It runs admission, the three native builds, SBOM generation,
Homebrew formula generation, and editor packaging and smoke, and uploads only
artifacts of the run itself. Exactly the steps with an effect outside the
run carry `if: github.event_name == 'push'`: native and editor attestation,
crates.io publication, GitHub Release creation, and the public VSIX check.
Admission refuses a dry run on any ref other than `main`, derives the release
tag from the workspace version instead of a pushed tag, and passes it to the
later jobs as `RELEASE_TAG`, which names every artifact. The distribution
policy pins the triggers, the guard on exactly those steps, unconditional jobs
and other steps, and exact job permission grants. No repository secret
reaches a step a dry run can run, and no dry-run step is passed the job token
explicitly. `actions/checkout`, `actions/setup-node`, and `ruby/setup-ruby`
still receive the job token through their default inputs, to fetch the
repository and download toolchains; every checkout sets
`persist-credentials: false`. A dry run's native and release jobs still hold
their reviewed write grants, because job permissions cannot vary by event.
The runbook lists what a dry run does not cover.

The tag run of the release workflow runs when a `v*` tag is pushed. It verifies
the profile, verifies that release metadata matches the tag, verifies that the
tag is on `main`, and reruns the Rust and package guards. Native matrix jobs
build `colorful` and `colorful-lsp` for Linux x86-64, Apple Silicon, and
Windows x86-64, then publish checksummed archives with GitHub/Sigstore
provenance. The release job verifies the downloaded Linux and Apple Silicon
archive bytes against their sidecars, generates and syntax-checks the
`colorful.rb` release formula with the workflow-pinned Ruby 3.4.10 runtime,
clean-installs one exact VSIX, copies those bytes and their checksum into the
release asset set, packages the byte-validated Zed source tree, publishes
crates in dependency order, attaches every reviewed asset to the GitHub
Release, and then downloads the public VSIX to prove byte equality.

The generated formula is an attested GitHub Release asset, not a public tap.
The release profile records that boundary explicitly; public Homebrew
installation, upgrade, and rollback evidence remains tracked by #37.

Zed registry publication remains an owner-submitted pull request to
`zed-industries/extensions`; the release workflow supplies the versioned,
licensed source archive and provenance but cannot merge into the external
registry. The GitHub Release asset is the required VS Code distribution
channel; VS Code Marketplace, Open VSX, and the Zed registry are optional
discovery channels whose accounts or acceptance cannot block the tag workflow.

The crates.io publish step skips crate versions that are already available in
the crates.io registry index, so rerunning the workflow after a partial publish
can continue without moving the tag. The release job timeout is sized for the
aggregate index-readiness polling window across all eight crates.

VSIX packaging normalizes archive timestamps to the immutable source commit
time, so rerunning the same tag reproduces the same package bytes. The workflow
attests the `dist/` copy that becomes the release asset, creates the GitHub
Release without marketplace secrets, and then downloads the public URL. The
public digest must match the smoke witness before the tag workflow is green.

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
