# Releasing

This repository follows the Continuum release lifecycle adapted for
`colorful-language`. The shared doctrine is: plan deliberately, publish
immutably, verify publicly, and learn immediately.

A release is not a version bump. A release is a visible promise: source,
metadata, docs, package artifacts, GitHub Release, registry state, verification,
and retrospective evidence must agree.

## Repo profile

Repo-local release mechanics are declared in
[`../.continuum/release.yml`](../.continuum/release.yml). The profile carries the
boring facts automation can check:

- fixed SemVer versioning from `Cargo.toml`'s `workspace.package.version`;
- tag format `v{version}`;
- release branch format `release/v{version}`;
- milestone format `v{version}`;
- the seven crates published to crates.io;
- release signposts such as `CHANGELOG.md`, `README.md`, `ROADMAP.md`,
  `docs/topics/`, `docs/workflows/`, and maintainer docs;
- validation entrypoints in `scripts/release-profile-check.sh`,
  `scripts/release-prep.sh`, and `scripts/release-preflight.sh`;
- current publication by pushing a `v*` tag, which triggers
  [`.github/workflows/release.yml`](../.github/workflows/release.yml).

The profile is enforced by CI and by the release workflow through:

```bash
bash scripts/release-profile-check.sh
```

## Current release shape

Colorful currently uses:

```text
release branch -> PR -> merge to main -> manual annotated tag -> tag workflow
-> crates.io publish -> GitHub Release -> public verification -> retrospective
```

There is no autotag workflow yet. Manual tagging is the normal path for now, but
it must not bypass failed gates. The tag must point at the reviewed `main` commit
that passed release prep.

## Non-negotiables

- No planned release without a release thesis.
- No version targeting through labels; use GitHub milestones.
- No release-prep PR without scope reconciliation against the previous public
  tag.
- No tag that does not point at the reviewed `main` commit.
- No moving public tags. Patch forward.
- No publishing from untagged or moving source.
- No silent registry, package, or channel mismatch.
- No release without public verification.
- No planned release train after publication without a retrospective.

## Required artifacts

| Artifact | Purpose |
| --- | --- |
| `docs/goalposts/vX.Y.Z/release.md` | Release packet: thesis, scope, version justification, non-claims, acceptance. |
| `docs/goalposts/vX.Y.Z/verification.md` | Witness: commands, results, tag/commit SHAs, workflow URL, registry evidence, release URL. |
| `CHANGELOG.md` | Historical ledger of externally meaningful change. |
| Git tag `vX.Y.Z` | Immutable public source anchor. |
| GitHub Release | Public release surface and binary archive. |
| Retrospective | Plan-versus-actual record, fallout issues, next recommendation. |

`README.md` may link to durable release surfaces, but it must not become a
per-version release log.

## Lifecycle

Colorful planned releases move through this lifecycle:

```text
planned -> active -> release-prep -> merged -> tagged -> published
-> verified -> retrospectived -> closed
```

### planned

A planned release exists when the milestone exists, the release thesis exists,
must-ship / may-slip / not-included scope is recorded, two to five goalposts are
defined, and acceptance evidence is clear.

### active

A release is active when the milestone is the current version train, at least one
scoped issue is in progress, and exactly one slice, tracking issue, or workstream
is marked active unless the maintainer explicitly allows parallel release lanes.

### release-prep

Release prep begins after implementation scope is reconciled. The release branch
format is:

```text
release/vX.Y.Z
```

The branch should contain only release-prep work unless the release owner
explicitly approves a narrow late fix.

### merged

The release-prep PR is merged only after review, green CI, and local or CI
release-prep validation. The merge commit becomes the candidate release commit.

### tagged

The release is tagged when final preflight passes from aligned `main` and an
annotated tag is created at the candidate commit:

```bash
git tag -a vX.Y.Z -m "release: vX.Y.Z"
```

Public tags are immutable. If a pushed tag is wrong, do not move it; patch
forward.

### published

Publication happens from the tag. In this repo, pushing `vX.Y.Z` triggers
`.github/workflows/release.yml`, which checks out the tag, verifies it is on
`main`, reruns final Rust/package guards, publishes crates, packages the Linux
binaries, and creates the GitHub Release.

### verified

A release is verified only after public availability is confirmed: crates.io
versions are visible, the GitHub Release exists, release assets are attached, and
install / CLI / import or equivalent smoke checks pass.

### retrospectived

A planned release is retrospectived when released work, unreleased work,
plan-versus-actual scope, repeatable wins, improvement mitigations, fallout
issues, and the next release recommendation are recorded.

### closed

A release is closed when the milestone is closed, all scoped work is closed,
moved, or explicitly cut, fallout issues are triaged, and the next release thesis
or patch posture is clear.

## Version selection

Colorful uses SemVer. Because the project is still pre-1.0, breaking public API
changes bump the minor version.

- Use PATCH for compatible bug fixes, packaging fixes, dependency updates
  without public behavior change, docs corrections, and narrow operator workflow
  fixes.
- Use MINOR for new compatible capabilities, additive APIs, new public commands,
  new supported workflows, new configuration with safe defaults, or pre-1.0
  breaking public API changes.
- Use MAJOR only once the project reaches a stable 1.x line and makes a breaking
  change across that line.
- Use prerelease versions only when maintainers intentionally want artifacts
  without stable guarantees. Prerelease artifacts must not be treated as the
  stable release.

## Milestones and labels

Use GitHub milestones as release buckets: `v0.3.0`, `v0.3.1`, `v0.4.0`. Do not
use version labels as release buckets.

Labels are query axes. Live issue axes should include exactly one label from
each required family when that family exists in the repo:

- `type:*`
- `priority:*`
- `status:*`
- `area:*`

A release should not tag while unrelated open `priority:asap` issues exist
unless the release owner records why they do not block the release.

## Release thesis and scope

Every planned release needs a short thesis before implementation work starts
against that milestone.

```markdown
## Release thesis

This release advances <capability boundary> for <primary user/operator> by
<main outcome>. It focuses on <included scope> and deliberately excludes
<not included scope>, which remains in <future milestone/backlog/research>.
```

Record three scope buckets:

- **Must-ship**: work that defines the release.
- **May-slip**: valuable work that may move without invalidating the thesis.
- **Explicitly not included**: plausible assumptions the release does not claim.

Each planned release should have two to five goalposts. Each goalpost must have
observable acceptance evidence: command output, test result, workflow run,
screenshot, registry lookup, release URL, smoke test, closed issue, or merged PR.

## Scope reconciliation

Before opening a release-prep branch, fetch tags and inspect the diff from the
previous public release:

```bash
git fetch origin --tags
git diff --stat vPREVIOUS..HEAD
git diff --name-status vPREVIOUS..HEAD
git log --oneline vPREVIOUS..HEAD
```

Use the diff to answer:

- What behavior changed?
- What public API changed?
- What CLI behavior changed?
- What docs truth changed?
- What operator workflow changed?
- What architecture boundary changed?
- What dependency or package posture changed?
- What release tooling changed?
- What intended work slipped?
- What accidentally expanded?

Then update every signpost whose truth changed.

## Signposts

The profile lists this repo's release signposts. In practice, audit at least:

- `CHANGELOG.md`
- `README.md`
- `ROADMAP.md`
- `docs/topics/`
- `docs/workflows/`
- `docs/design/` and `docs/topics/ir/architecture.md` when architecture truth
  changes
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/DOCUMENTATION_STANDARDS.md`
- crate READMEs and editor READMEs, when their surface changes

Update current references only for behavior that exists on `main`. Planned
release work belongs in test plans, issues, roadmap entries, release packets, or
design notes until it lands.

## Release-prep branch

Create release-prep branches from current `main`:

```bash
git switch main
git pull --ff-only
git switch -c release/vX.Y.Z
```

Allowed release-prep changes:

- version metadata;
- lockfiles;
- changelog;
- release packet and witness skeleton;
- docs signposts;
- release guard updates;
- narrow fixes required to pass release validation.

Risky late feature work goes through normal implementation flow.

## Release-prep validation

Run the full local release-prep gate before opening or merging the release-prep
PR:

```bash
bash scripts/release-prep.sh
```

That script runs:

- release profile check;
- Rust format, clippy, and tests;
- package witness;
- release build;
- IR witness;
- Graft reference consumer test;
- VS Code extension compile;
- Zed extension compile;
- Markdown lint;
- workflow lint with `actionlint`;
- whitespace / conflict marker check.

The tag-triggered `Release` workflow repeats the release profile check, verifies
release metadata matches the tag, verifies the tag is on `main`, and reruns the
Rust and package final guards. It does not repeat every PR-only integration
witness; those must already be green on the merged release-prep PR.

## Release-prep PR

Open a normal, non-draft PR to `main`.

Default title:

```text
release: vX.Y.Z
```

The body should include:

```markdown
## Release

Version: X.Y.Z
Previous tag: vPREVIOUS
Target tag: vX.Y.Z
Release type: planned | patch | emergency | security | prerelease | docs-only
Publish channel: crates.io default stable channel

## Thesis

...

## Scope reconciliation

### Shipped

- ...

### Slipped

- ...

### Explicitly not included

- ...

## Signposts updated

- [ ] CHANGELOG.md
- [ ] README.md
- [ ] ROADMAP.md
- [ ] User docs
- [ ] Operator docs
- [ ] Contributor / maintainer docs
- [ ] Not applicable items explained

## Validation

- [ ] release prep passes
- [ ] CI green
- [ ] package dry-run passes

## Publish notes

Manual actor required: yes, for the public tag push
Targets:
- crates.io
- GitHub Releases
```

## Final preflight and tag

After the release-prep PR is merged, use the final preflight from clean, fetched,
aligned `main`:

```bash
git switch main
git pull --ff-only
bash scripts/release-preflight.sh vX.Y.Z
```

If preflight passes, create and push the annotated tag:

```bash
git tag -a vX.Y.Z -m "release: vX.Y.Z"
git push origin vX.Y.Z
```

The pushed tag triggers publication. The tag must point at the exact `main`
commit that passed preflight.

## Publication

Publishing must happen from the tag. The release workflow must not publish from
moving `main`, move a tag, skip failed gates, silently change package channels,
or rebuild a different artifact for an already-published version.

The current workflow publishes these crates in dependency order:

1. `colorful-core`
2. `colorful-lexicon`
3. `colorful-parse`
4. `colorful-ir`
5. `colorful-lint`
6. `colorful-cli`
7. `colorful-lsp`

It then builds one `x86_64-unknown-linux-gnu` archive containing `colorful`,
`colorful-lsp`, `README.md`, `LICENSE`, `NOTICE`, and `CHANGELOG.md`, writes a
SHA-256 checksum, and creates the GitHub Release.

The crates.io publish step is rerun-safe for already-visible crate versions: it
checks crates.io before each crate and continues when that exact version already
exists. It must not move tags or publish from a different commit.

## crates.io prerequisites

The seven crates publish under flat crates.io names. crates.io has no scoped
package names; organization identity comes from ownership and repository links.

One-time prerequisites:

- A `CARGO_REGISTRY_TOKEN` repository secret for crates.io.
- `flyingrobots` ownership on each crate after first publish.

Validate local publishability before tagging:

```bash
cargo publish --dry-run -p colorful-core --locked
```

Dependent crates can only dry-run once their dependencies are already available
on crates.io. The real release workflow handles ordered publication. crates.io
versions are immutable; a bad published version is fixed by patching forward.

## Post-publication verification

After the workflow succeeds, verify public availability:

```bash
gh release view vX.Y.Z --json url,tagName,name,publishedAt,assets
cargo search colorful-core --limit 5
cargo install colorful-cli --version X.Y.Z --locked
colorful --version
colorful diagnose --json crates/colorful-cli/fixtures/editor-smoke-prose.txt
```

Adjust smoke commands to the release surface. For editor releases, also verify
the relevant extension package or source-install path. For docs-only changes,
verify the deployed or published documentation surface.

Record evidence in `docs/goalposts/vX.Y.Z/verification.md`:

- release version;
- tag;
- commit;
- previous tag;
- release-prep PR;
- publish workflow run;
- GitHub Release URL;
- crates.io evidence;
- install / CLI / import smoke evidence;
- known omissions or follow-up issues.

## Failure handling

- **Tag exists, no registry published:** do not move the tag. Fix the workflow or
  credentials and rerun publication for the same tag.
- **Some crates published, another failed:** do not move the tag. Fix the
  failing path and rerun. Already-published crates should be verified, not
  republished with different contents.
- **GitHub Release failed:** do not move the tag. Rerun release creation or fix
  the workflow for the same tag.
- **Published artifact is bad:** do not move the tag. Cut a patch release from
  `main`; yank only when safe and appropriate.
- **Wrong commit tagged locally:** if the tag has not left the machine, fix it
  locally.
- **Wrong commit pushed:** treat it as public and patch forward unless
  maintainers can prove nobody could observe it.
- **Credentials or provenance failed:** stop publication, fix identity or
  permissions, and rerun from the same tag.
- **Security issue discovered:** stop normal flow and switch to security release
  handling.

## Release types

- **Planned release:** milestone, thesis, scoped issues, goalposts, full
  release-prep PR, full validation, publication evidence, retrospective.
- **Patch release:** short thesis, changelog entry, version metadata, validation,
  publication evidence, lightweight retrospective or release tracking update.
- **Emergency release:** abbreviated planning is allowed, but immutable tag,
  proportional validation, verification, retrospective, and fallout issues still
  apply.
- **Security release:** restricted tracking when needed, clear patched versions,
  verification evidence, and post-disclosure docs where appropriate.
- **Prerelease:** alpha, beta, or rc artifacts. They must not be treated as the
  stable release.
- **Docs-only release:** only when docs are part of the public artifact. It still
  needs validation and deployed/public docs verification.

## Retrospective

Run the retrospective immediately after tag, publication, and verification are
complete. Do not start the next planned release train until this exists.

Template:

```markdown
# Release retrospective: vX.Y.Z

Date:
Release type:
Release thesis:
Tag:
Commit:
Release PR:
Publish run:
GitHub Release:

## Released

User-facing behavior:
Runtime/API changes:
Docs changes:
Release tooling changes:
Dependency changes:
Registry evidence:

## Not released

Planned items moved forward:
Blocked items:
Intentional cuts:
Accidental omissions:

## Plan versus actual

Shipped as planned:
Slipped:
Expanded:
Changed direction:
Why:

## What went well

1. ...
2. ...
3. ...

Why these are repeatable:

## What should improve

1. Problem:
   Mitigation:
2. Problem:
   Mitigation:
3. Problem:
   Mitigation:

## Fallout issues

- ...

## Next release recommendation

Suggested next version:
Suggested thesis:
Suggested first active slice:
```

Every fallout issue should explain why it matters, cite the evidence, name the
target milestone when known, define done, and carry the repo's live issue axes.

## Adoption gaps

The Continuum target shape includes an autotag workflow and richer issue /
milestone gates. This repository does not have those yet. Until they land:

- manual annotated tags remain the release trigger;
- `scripts/release-preflight.sh` is the final manual guard;
- release owners must verify milestone and issue hygiene manually;
- release asset reruns remain conservative; if a GitHub Release exists but is
  missing assets, inspect the release before uploading replacements;
- retrospectives and fallout issues are maintainer responsibilities.
