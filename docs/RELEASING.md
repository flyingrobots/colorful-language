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
- synchronized VS Code and Zed adapter versions with stable
  same-pre-1.0-minor `colorful-lsp` compatibility;
- tag format `v{version}`;
- release branch format `release/v{version}`;
- milestone format `v{version}`;
- the eight crates published to crates.io;
- native Linux x86-64, Apple Silicon, and Windows x86-64 server/CLI
  distribution targets;
- the one-smoke-tested-VSIX policy for VS Code Marketplace and Open VSX;
- GitHub/Sigstore provenance, Zed registry-source packaging, and the named
  publication/rollback owner;
- release signposts such as `CHANGELOG.md`, `README.md`, `ROADMAP.md`,
  `docs/topics/`, `docs/workflows/`, and maintainer docs;
- validation entrypoints in `scripts/release-profile-check.sh`,
  `scripts/check-editor-version-policy.mjs`,
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
-> native/editor build and attestation -> crates.io + editor publication
-> GitHub Release -> Zed registry PR -> public verification -> retrospective
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
| GitHub Release | Public release surface for checksummed native archives, the exact smoke-tested VSIX, and Zed registry source. |
| Homebrew formula | Attested GitHub Release asset derived from the exact Linux x86-64 and Apple Silicon archives; not a public tap claim. |
| GitHub attestations | Sigstore-backed provenance for every native archive, the VSIX, and the Zed source archive. |
| Editor registry records | Public VS Code Marketplace, Open VSX, and Zed extension entries for the synchronized version. |
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
`main`, and completes the release-profile, editor-compatibility, Rust, build,
and package-witness admission gates before any provenance-producing native job
starts. It then builds and attests the native matrix, clean-installs one VSIX,
publishes those exact VSIX bytes to both editor registries, publishes crates,
and creates the GitHub Release. The workflow also packages and attests the
exact Zed registry-source tree; submission to
`zed-industries/extensions` remains a maintainer pull request because that
registry owns publication. The workflow derives and attests `colorful.rb` from
the verified native archives; public tap publication remains a separate
maintainer-owned channel.

### verified

A release is verified only after public availability is confirmed: crates.io
versions are available through the registry index, the GitHub Release exists,
release assets are attached, and install / CLI / import or equivalent smoke
checks pass.

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

## Editor adapter versioning

The Cargo workspace, VS Code extension manifest and lockfile, Zed extension
manifest, and standalone Zed crate and lockfile share the release version. A
release-preparation version update changes them as one reviewed set.

For an adapter version `0.Y.Z`, compatible `colorful-lsp` versions are stable
releases in:

```text
>=0.Y.0 <0.(Y+1).0
```

This admits server patch releases from the same minor line. A server minor bump
is potentially breaking under the pre-1.0 policy and requires a synchronized
adapter release. Prerelease adapters and servers are unsupported; adding them
requires a deliberate profile, channel, ordering, and rollback policy change.

The release profile lists every synchronized source. Check them with:

```bash
npm ci
node scripts/check-editor-version-policy.mjs
```

The checker also requires its command in pull-request CI, release preparation,
and tag publication, with root dependencies installed first. It parses the
profile through the repository-pinned YAML implementation, so semantically
equivalent mapping indentation and field order do not change the result. Do not
align version numbers by hand without changing the workspace release version
through the release process.

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

- release profile check, including `Cargo.lock` workspace crate versions;
- synchronized editor/server compatibility and gate wiring;
- signed native/editor distribution policy and mutation self-tests;
- Homebrew formula generation, archive-integrity, and release-order self-tests;
- exact Ruby 3.4.10 formula-syntax evidence through the full-SHA-pinned
  `ruby/setup-ruby` action;
- Rust format, clippy, and tests;
- package witness;
- release build;
- IR witness, including generated TypeScript contract type-checking;
- Wesley-generated IR contract drift check (clones and compiles pinned Wesley);
- Graft reference consumer test;
- VS Code extension compile;
- Zed extension compile with locked Cargo metadata;
- Markdown lint;
- workflow lint with `actionlint`;
- pinned, offline workflow-security analysis with `zizmor`;
- whitespace / conflict marker check.

The tag-triggered `Release` workflow repeats the release profile check, verifies
release metadata matches the tag, verifies the tag is on `main`, and reruns the
editor-compatibility, Rust, build, and package final guards in the read-only
`validate-release` job. Native build, attestation, and artifact upload depend on
that admission job. The workflow does not repeat every PR-only integration
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
- VS Code Marketplace
- Open VSX
- zed-industries/extensions
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
6. `colorful-projection`
7. `colorful-lsp`
8. `colorful-cli`

Cargo requires every versioned dependency, including a dev-dependency, to
resolve from the registry at publication time. Two test-evidence edges
therefore constrain the order:

- `colorful-lexicon` publishes before `colorful-parse`, whose numeric parity
  integration test carries a versioned lexicon dev-dependency.
- `colorful-lsp` publishes before `colorful-cli`, whose lint parity integration
  test carries a versioned LSP dev-dependency.

Neither dependency is reversed, so these edges introduce no cycle. PR CI and
release preparation run `scripts/check-release-publish-order.mjs`, which
derives every internal normal, build, and dev edge from `cargo metadata`,
requires the release profile and tag workflow to declare the same order, and
rejects missing, duplicate, non-publishable, or misordered packages.

Three native jobs build `colorful` and `colorful-lsp` on the reviewed host and
target pairs:

| Hosted runner | Rust target | Release use |
| --- | --- | --- |
| `ubuntu-24.04` | `x86_64-unknown-linux-gnu` | Linux x86-64 |
| `macos-15` | `aarch64-apple-darwin` | Apple Silicon |
| `windows-2025` | `x86_64-pc-windows-msvc` | Windows x86-64 |

Each job packages both binaries with `README.md`, `LICENSE`, `NOTICE`, and
`CHANGELOG.md`, writes a SHA-256 sidecar, and publishes GitHub/Sigstore
provenance for the archive. The release job downloads those exact archives
instead of rebuilding them for the GitHub Release.

After download, the release job runs
`scripts/generate-homebrew-formula.mjs` against the Linux x86-64 and Apple
Silicon archives. The generator requires canonical archive and sidecar names,
streams both archives to verify their SHA-256 values, emits deterministic
`colorful.rb` bytes, and checks syntax with workflow-pinned Ruby 3.4.10. The
formula installs `colorful` and `colorful-lsp` together, tests
`colorful --version`, and checks that the server is executable without
inventing a `colorful-lsp --version` interface. The workflow attests the
formula and attaches it to the GitHub Release.

The generated formula is not a public tap. `.continuum/release.yml` records the
current authority as a GitHub Release asset and leaves the tap unset. Issue #37
owns any future tap, clean-machine `brew install`, upgrade, and rollback proof;
do not add a Homebrew install claim until that public evidence exists.

The release job runs the packaged editor smoke once. That smoke builds,
clean-installs, and exercises one exact VSIX, then stages and compiles the Zed
registry source. The workflow publishes the smoke witness's VSIX bytes to VS
Code Marketplace and Open VSX with duplicate-version retries treated as a
verification path. It attaches the VSIX and Zed source archive plus checksums to
the GitHub Release and publishes provenance for both. It does not build a
second marketplace artifact.

The crates.io publish step is rerun-safe for already-published crate versions:
it checks the crates.io registry index before each crate and continues when that
exact version is already available. It must not move tags or publish from a
different commit.

## crates.io prerequisites

The eight crates publish under flat crates.io names. crates.io has no scoped
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

## Editor publication prerequisites

Publication and rollback owner: `@flyingrobots`.

The tag workflow fails before any crate or editor package is published unless
both editor identities authenticate. After publication or a duplicate-version
skip, it downloads that exact version from both registries and requires each
SHA-256 digest to equal the smoke-tested VSIX before crates are published:

- `VSCE_PAT` is a repository secret with publish rights for the
  `flyingrobots` VS Code publisher. Microsoft Entra authentication can replace
  this secret only through a separately reviewed workflow change.
- `OVSX_PAT` is a repository secret with publish rights for the
  `flyingrobots` Open VSX namespace.

Validate the identities with the exact lockfile-backed tools before tagging:

```bash
npm --prefix editors/vscode exec -- vsce verify-pat flyingrobots
npm --prefix editors/vscode exec -- ovsx verify-pat flyingrobots
```

Zed publication is not token-driven from this repository. The owner submits a
pull request to `zed-industries/extensions` that adds this repository as a
submodule and selects `path = "editors/zed"`. The selected directory carries
its own byte-identical `LICENSE`, manifest, lockfile, source, and README.

## Post-publication verification

After the workflow succeeds, verify public availability:

```bash
gh release view vX.Y.Z --json url,tagName,name,publishedAt,assets
gh release download vX.Y.Z
shasum -a 256 -c ./*.sha256
for artifact in colorful-language-vX.Y.Z-*.tar.gz colorful-language-X.Y.Z.vsix; do
  gh attestation verify "$artifact" --repo flyingrobots/colorful-language
done
ruby -c colorful.rb
gh attestation verify colorful.rb --repo flyingrobots/colorful-language
node scripts/verify-editor-publication.mjs \
  --vsix colorful-language-X.Y.Z.vsix \
  --version X.Y.Z
cargo info colorful-core@X.Y.Z
cargo info colorful-cli@X.Y.Z
cargo install colorful-cli --version X.Y.Z --locked
colorful --version
colorful diagnose --json crates/colorful-cli/fixtures/editor-smoke-prose.txt
npm --prefix editors/vscode exec -- vsce show \
  flyingrobots.colorful-language --json
npm --prefix editors/vscode exec -- ovsx get \
  flyingrobots.colorful-language --versionRange X.Y.Z --metadata
gh api repos/zed-industries/extensions/contents/extensions/colorful-language
```

Download every release archive and its sidecar, recompute SHA-256, and run
`colorful --version` on the matching clean Linux, macOS, or Windows host.
Verify the LSP version through `initialize` response `serverInfo.version`; the
server does not expose a CLI version flag. Syntax-check and attest
`colorful.rb`, but do not record a Homebrew install result until a public
channel exists. Download the release VSIX, verify its attestation, install it
into an isolated VS Code profile, and rerun the packaged Plain Text, Markdown,
diagnostics, semantic-token, incremental-edit, shutdown, and missing-server
oracles. Zed is verified only after the external registry entry resolves and a
clean Zed profile activates the synchronized extension/server pair.

The packaged editor witness records an
`installation-to-first-highlight` measurement from immediately before isolated
VSIX installation through the first Plain Text diagnostic and semantic-token
response. It records OS, architecture, CPU, logical CPU count, memory, Node,
Rust, VS Code, extension, and server versions. This field is observational:
network, host load, and editor startup make it unsuitable as a deterministic
gate. A release witness records the measured value and environment, but the
value is not a correctness threshold.

For docs-only changes, verify the deployed or published documentation surface.

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
- native archive checksums and `gh attestation verify` results;
- `vsce show`, `ovsx get`, and `zed-industries/extensions` evidence;
- clean-machine editor activation and observational timing;
- rollback rehearsal against the previous compatible set;
- known omissions or follow-up issues.

## Failure handling

- **Tag exists, no registry published:** Do not move the tag. Fix the workflow
  or credentials and rerun publication for the same tag.
- **Some crates published, another failed:** Do not move the tag. Fix the
  failing path and rerun. Already-published crates should be verified, not
  republished with different contents.
- **Editor publication partially succeeded:** Do not move the tag or rebuild
  the VSIX. If public bytes differ from the smoke-tested digest, stop: immutable
  version identity has been violated and requires a patch release plus incident
  documentation. Otherwise repair credentials or permissions and rerun the
  same tag so `--skip-duplicate` preserves the verified bytes.
- **Zed submission failed review:** keep the GitHub Release and editor registry
  records intact, correct the source extension on `main`, and patch forward.
  Do not retarget the external submodule to unreviewed or moving source.
- **GitHub Release failed:** Do not move the tag. Rerun release creation or fix
  the workflow for the same tag.
- **Homebrew formula generation failed:** Do not publish an unverified formula
  or regenerate it from different bytes. Repair the generator or native
  artifact set on `main` and patch forward; no tap currently needs rollback.
- **Published artifact is bad:** Do not move the tag. Cut a patch release from
  `main`; yank only when safe and appropriate.
- **Wrong commit tagged locally:** if the tag has not left the machine, fix it
  locally.
- **Wrong commit pushed:** treat it as public and patch forward unless
  maintainers can prove nobody could observe it.
- **Credentials or provenance failed:** stop publication, fix identity or
  permissions, and rerun from the same tag.
- **Security issue discovered:** stop normal flow and switch to security release
  handling.

Rollback means reinstalling the previous compatible, publicly verified server
archive and editor package while a patch-forward release is prepared. Record
the previous tag, archive and VSIX digests, registry versions, clean-profile
activation result, and restored first-highlight behavior. Do not move the tag,
replace registry bytes, overwrite an attestation, or point users at an
unreleased branch.

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
