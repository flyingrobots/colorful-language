# Release process test plan

Verification for release preparation, tag automation, and release witnesses.

## Requirements

- **REL-1** A release has a packet, verification witness, changelog entry, tag,
  and GitHub Release.
- **REL-2** A release tag must point to a commit reachable from `origin/main`.
- **REL-3** The release workflow reruns profile, editor compatibility, Rust,
  build, and package guards before any provenance-producing job.
- **REL-4** Crates publish in dependency order.
- **REL-5** The release runbook remains the canonical operational checklist.
- **REL-6** The repo declares release mechanics in a machine-checkable profile.
- **REL-7** Release-prep and final preflight gates are executable.
- **REL-8** The current lifecycle records verification and retrospective duties.
- **REL-9** The tag workflow validates metadata and is safe to rerun after
  crates are already available in the crates.io registry index.
- **REL-10** Release preparation fails when a `colorful.syntax/v1` schema or
  vocabulary identity lacks an explicit compatibility decision and migration
  evidence.
- **REL-11** Every editor adapter released from the repository tag must share
  the workspace version and declare a deterministic `colorful-lsp`
  compatibility rule.
- **REL-12** A release tag must build `colorful` and `colorful-lsp` for the
  reviewed native platform matrix, publish checksums, and attach signed
  provenance to the exact archives created from that tag.
- **REL-13** One clean-install-tested VSIX must be the sole input to both VS
  Code Marketplace and Open VSX publication, with credentials verified before
  immutable publication and duplicate-version retries handled explicitly.
- **REL-14** The Zed registry source path must carry the complete accepted
  inventory and license required by the external registry PR.
- **REL-15** Distribution verification and rollback must name an owner, public
  URL and integrity oracle for every channel; observational startup timing must
  remain separate from deterministic correctness gates.
- **REL-16** Homebrew formula generation must consume the reviewed native
  archives and checksums after they are built, without rebuilding or
  repackaging release binaries.
- **REL-17** GitHub milestones must remain goalposts while each release train
  uses one versioned tracking issue and packet, so a slice never loses its
  product/architecture owner merely to join a release.
- **REL-18** A release packet must define its thesis, version decision, complete
  scope buckets, bounded goalposts, acceptance evidence, non-claims, risks, and
  rollback posture before its versioned release tracker can be created; its
  verification witness must distinguish pre-publication proof from public
  release evidence that does not yet exist.

## Cases

- **REL-1a** — *Requirement:* REL-1. *Behavior:* each completed release has a
  packet and witness under `docs/goalposts/vX.Y.Z/`. *Oracle:* documentation
  review. *Evidence:* `docs/goalposts/v0.1.0/`;
  `docs/goalposts/v0.2.0/`; `docs/goalposts/v0.2.1/`;
  `docs/goalposts/v0.3.0/`. *Status:* implemented.
- **REL-2a** — *Requirement:* REL-2. *Behavior:* the workflow rejects a tag that
  is not an ancestor of `origin/main`. *Oracle:* workflow source review.
  *Evidence:* `.github/workflows/release.yml`. *Status:* implemented.
- **REL-3a** — *Requirement:* REL-3. *Behavior:* the release workflow reruns
  release-profile and editor-compatibility validation, `cargo fmt`,
  `cargo clippy`, `cargo test`, `cargo build --release`, and the package
  witness in the read-only admission job that every provenance-producing
  native job requires. *Oracle:* workflow source and distribution-policy
  mutation review. *Evidence:* `.github/workflows/release.yml`;
  `scripts/check-release-distribution.test.mjs`
  `requires final validation before native provenance`. *Status:* implemented.
- **REL-4a** — *Requirement:* REL-4. *Behavior:* crates publish from leaf
  dependencies to dependents. *Oracle:* workflow source review. *Evidence:*
  `.github/workflows/release.yml`; `docs/RELEASING.md`. *Status:* implemented.
- **REL-4b** — *Requirement:* REL-4. *Behavior:* the release profile and tag
  workflow declare the same complete, duplicate-free publishable-workspace
  list, and every internal normal, build, or dev dependency precedes its
  dependent. This
  includes the versioned lexicon-before-parse and LSP-before-CLI dev-dependency
  edges. *Oracle:* a deterministic checker derives internal edges from
  `cargo metadata`, parses both declared orders, and rejects reordered,
  duplicated, missing, or drifted packages in synthetic self-tests. *Evidence
  type:* release-policy script and mutation self-test. *Evidence:*
  `scripts/check-release-publish-order.mjs` and
  `scripts/check-release-publish-order.test.mjs`; CI `Docs & whitespace` and
  `Rust (fmt, clippy, test)` jobs; `scripts/release-prep.sh`. *Status:*
  implemented.
- **REL-5a** — *Requirement:* REL-5. *Behavior:* release instructions live in
  `docs/RELEASING.md`; the topic points to it instead of duplicating the full
  runbook. *Oracle:* documentation review. *Evidence:*
  `docs/workflows/release-process/README.md`. *Status:* implemented.
- **REL-6a** — *Requirement:* REL-6. *Behavior:* `.continuum/release.yml`
  declares version sources, signposts, validation commands, workflows, crates,
  and artifacts for this repo, and the profile check rejects stale workspace
  crate versions in `Cargo.lock`. *Oracle:* profile validation. *Evidence:*
  `.continuum/release.yml`; `scripts/release-profile-check.sh`; CI `Docs &
  whitespace` job. *Status:* implemented.
- **REL-7a** — *Requirement:* REL-7. *Behavior:* release prep is a single
  executable gate that runs profile, Rust, package, IR with generated TypeScript
  type-checking and Wesley-generated IR contract drift check, downstream, editor,
  Markdown, workflow, and whitespace checks; the Zed wasm build uses locked
  Cargo metadata. *Oracle:* script review and local execution. *Evidence:*
  `scripts/release-prep.sh`. *Status:* implemented.
- **REL-7b** — *Requirement:* REL-7. *Behavior:* final tag preflight requires
  clean aligned `main`, absent local/remote tag, matching workspace version,
  changelog entry, release packet, witness, and the full prep gate. *Oracle:*
  script review. *Evidence:* `scripts/release-preflight.sh`. *Status:*
  implemented.
- **REL-8a** — *Requirement:* REL-8. *Behavior:* the runbook requires public
  registry / release verification and a release retrospective before the next
  planned train starts. *Oracle:* documentation review. *Evidence:*
  `docs/RELEASING.md`. *Status:* implemented.
- **REL-9a** — *Requirement:* REL-9. *Behavior:* the tag workflow fails if the
  tag version does not match workspace metadata, changelog, or release packet
  paths. *Oracle:* workflow source review. *Evidence:*
  `.github/workflows/release.yml`. *Status:* implemented.
- **REL-9b** — *Requirement:* REL-9. *Behavior:* the crates.io publish loop
  checks whether each crate version is already available in the registry index
  before publishing, so a rerun can continue after a partial publish without
  moving the tag; the job timeout covers the aggregate index-readiness polling
  budget. *Oracle:* workflow source review. *Evidence:*
  `.github/workflows/release.yml`. *Status:* implemented.
- **REL-10a** — *Requirement:* REL-10. *Behavior:* the release-process reference
  defines which schema edits preserve a v1 generation, require a new explicit
  v1 generation, or require a deliberately versioned contract; release prep
  validates the canonical compatibility manifest and rejects unregistered
  identity tuples or missing migration evidence before packaging. *Oracle:*
  deterministic compatibility mutation tests and release-gate source review.
  *Evidence type:* current workflow reference, manifest validator, and release
  gate. *Evidence:* `node --test scripts/check-ir-compatibility.test.mjs`
  (`manifest validation rejects each compatibility-authority mutation` and
  `the canonical manifest records every supported wire generation`);
  `node scripts/check-ir-compatibility.mjs`;
  `docs/workflows/release-process/README.md`;
  `.github/workflows/ci.yml` job `Generated IR and vocabulary drift`; and
  `scripts/release-prep.sh`.
  *Tracking:*
  [#221](https://github.com/flyingrobots/colorful-language/issues/221).
  *Status:* implemented.
- **REL-11a** — *Requirement:* REL-11. *Behavior:* the release profile records
  the synchronized VS Code, Zed, and workspace version sources; derives
  same-pre-1.0-minor server compatibility; rejects prereleases and potentially
  breaking next-minor servers; and runs the deterministic drift check in CI,
  release preparation, and tag publication. *Oracle:* source, profile, range,
  prerelease, and gate-wiring mutations each fail with a stable category.
  *Evidence type:* release-policy checker and mutation test. *Tracking:*
  [#141](https://github.com/flyingrobots/colorful-language/issues/141).
  *Evidence:* `.continuum/release.yml`;
  `scripts/check-editor-version-policy.mjs`;
  `scripts/check-editor-version-policy.test.mjs`;
  `.github/workflows/ci.yml`; `.github/workflows/release.yml`;
  `scripts/release-profile-check.sh`; `scripts/release-prep.sh`;
  `docs/RELEASING.md`. The executable cases
  `accepts version-source mappings with reordered fields`,
  `parses release policy independently of YAML layout`, and
  `requires policy dependencies before the checker in every release gate`
  prove serialization independence and clean-environment dependency ordering.
  *Status:* implemented.
- **REL-12a** — *Requirement:* REL-12. *Behavior:* the tag workflow builds the
  two public binaries natively on `ubuntu-24.04` /
  `x86_64-unknown-linux-gnu`, `macos-15` /
  `aarch64-apple-darwin`, and `windows-2025` /
  `x86_64-pc-windows-msvc`; each archive contains the same reviewed support
  files, has one SHA-256 sidecar, and receives GitHub/Sigstore build
  provenance before release creation. *Oracle:* profile/workflow mutations
  reject a missing, duplicated, reordered, mismatched, unsigned, or
  unchecked archive entry. *Evidence type:* deterministic distribution-policy
  checker and mutation tests. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Evidence:* `.continuum/release.yml`; `.github/workflows/release.yml`;
  `scripts/check-release-distribution.mjs`;
  `scripts/check-release-distribution.test.mjs`
  `rejects every platform inventory mutation`,
  `rejects workflow matrix drift independently of the profile`,
  `requires tag admission before provenance-producing jobs`,
  `requires final validation before native provenance`,
  `binds native dispatch and release side effects to the reviewed topology`,
  and `requires signed checksummed native archives`. *Status:* implemented in
  workflow; hosted release evidence remains planned.
- **REL-13a** — *Requirement:* REL-13. *Behavior:* the tag workflow runs the
  packaged VS Code smoke once, publishes that witness's exact VSIX path to both
  registries, isolates each registry credential to its own verification and
  publication step, verifies both credentials before crates or editor packages
  are published, and treats an already-present version as a rerun-safe success
  only when both downloaded registry packages match the witness SHA-256.
  Packaging normalizes ZIP timestamps to the immutable source commit, so
  ambient time cannot change the VSIX bytes. *Oracle:* workflow and lockfile
  mutations reject shared publisher credentials, a second package command,
  different publication paths, missing credential or byte verification,
  floating publisher tooling, absent duplicate handling, a mismatched remote
  package, or time-dependent packaging. *Evidence type:* deterministic
  distribution-policy checker and mutation tests. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Evidence:* `.github/workflows/release.yml`;
  `editors/vscode/smoke/run-packaged-smoke.mjs`;
  `editors/vscode/package.json`; `editors/vscode/package-lock.json`;
  `scripts/verify-editor-publication.mjs`;
  `scripts/verify-editor-publication.test.mjs`;
  `scripts/check-release-distribution.test.mjs`
  `isolates each editor registry credential to its publisher step`,
  `requires publisher credential verification before crates`,
  `rejects credentials shared between editor publisher steps`,
  `requires one smoke-tested VSIX for both rerun-safe publishers`, and
  `requires published registry bytes to match the smoke-tested VSIX`, and
  `requires exact lockfile-backed publisher tools`;
  `scripts/check-editor-package-smoke.test.mjs`
  `VSIX packaging is reproducible across ambient build times` and
  `clean gates install editor dependencies before package policy`. *Status:*
  implemented in workflow; public registry evidence remains planned.
- **REL-14a** — *Requirement:* REL-14. *Behavior:* the repository-owned
  `editors/zed` path and its staged clean-room copy carry the same accepted
  license, synchronized manifest and crate versions, lockfile, source, and
  documentation needed by an official `zed-industries/extensions` submodule
  entry with `path = "editors/zed"`. *Oracle:* an exact inventory and
  byte-equality check fails if either source omits or drifts the license.
  *Evidence type:* deterministic package-policy test and isolated Wasm build.
  *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Evidence:* `editors/zed/LICENSE`; `scripts/stage-zed-extension.mjs`;
  `scripts/check-release-distribution.test.mjs`
  `requires the Zed registry path to retain the repository license`; packaged
  editor smoke. *Status:* implemented in source packaging; external registry
  submission remains planned.
- **REL-15a** — *Requirement:* REL-15. *Behavior:* the release runbook names
  `@flyingrobots` as publication and rollback owner; gives exact verification
  commands for GitHub attestations, registry metadata, clean installation, and
  Zed registry status; and requires patch-forward recovery without moving a
  public tag. Install-to-first-highlight measurements record their start/end
  events and environment but do not enforce a wall-clock threshold.
  *Oracle:* documentation/policy mutations reject a missing owner, channel,
  integrity command, rollback rule, or an observational measurement presented
  as a correctness gate. *Evidence type:* deterministic distribution-policy
  checker and documentation review. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Evidence:* `docs/RELEASING.md`;
  `editors/vscode/smoke/timing-witness.mjs`;
  `editors/vscode/smoke/run-packaged-smoke.mjs`;
  `scripts/check-editor-package-smoke.test.mjs`
  `installation timing is ordered observational evidence`;
  `scripts/check-release-distribution.test.mjs`
  `requires every release gate and rollback reference` and
  `keeps public byte verification after publication` and
  `downloads every release asset before integrity verification` and
  `verifies checksums and provenance for the complete release matrix`.
  *Status:* implemented in the runbook and package witness; public rollback
  rehearsal remains planned.
- **REL-16a** — *Requirement:* REL-16. *Behavior:* after the release job
  downloads the native archive and checksum set, the generator verifies the
  Linux x86-64 and Apple Silicon formula inputs and derives one deterministic
  Homebrew formula, subjects it to release policy and the workflow-pinned Ruby
  syntax check, and attaches it to the same immutable GitHub Release. The
  formula installs the CLI and LSP from those archives; public tap publication
  and clean-machine rollback proof remain separate authority. *Oracle:*
  workflow mutations reject generation before native download, missing or
  mismatched formula checksum inputs, rebuilt binaries, unsupported platform
  claims, an unpinned or drifted formula-syntax Ruby, and a formula omitted
  from release assets.
  *Evidence type:* deterministic generator and release-policy mutation tests.
  *Tracking:*
  [#251](https://github.com/flyingrobots/colorful-language/issues/251).
  *Evidence:* `.continuum/release.yml`; `.github/workflows/release.yml`;
  `scripts/generate-homebrew-formula.mjs`;
  `scripts/generate-homebrew-formula.test.mjs`;
  `scripts/check-release-distribution.mjs`;
  `scripts/check-release-distribution.test.mjs`
  `derives and attests Homebrew formulae from downloaded native assets` and
  `rejects Homebrew syntax parser runtime drift`;
  `.github/workflows/ci.yml`; `scripts/release-prep.sh`. *Status:* implemented
  for the GitHub Release formula; public tap publication remains planned under
  [#37](https://github.com/flyingrobots/colorful-language/issues/37).
- **REL-17a** — *Requirement:* REL-17. *Behavior:* repository and release
  profiles name GitHub milestones as the goalpost axis and one versioned issue
  as the release-train axis; contributor, agent, release, and workflow
  references agree, and the release profile contains no competing version-
  milestone format. *Oracle:* one mutation per axis or reference fails with a
  stable `E_DELIVERY_TRACKING` category, while reordered profile fields remain
  valid. *Evidence type:* deterministic repository-maintenance policy test and
  checked-in profile validation. *Evidence:*
  `.github/repository-profile.yml`; `.continuum/release.yml`;
  `scripts/check-repository-maintenance.mjs`;
  `scripts/check-repository-maintenance.test.mjs`
  `rejects a competing release-milestone delivery axis`,
  `rejects drift in either delivery-tracking axis`,
  `rejects a stale delivery-tracking reference`,
  `rejects an additive contradictory delivery-tracking reference`,
  `rejects an incomplete v0.4.0 tracking and prep sequence`,
  `accepts a future aligned release example without policy code edits`, and
  `accepts reordered delivery-tracking profile fields`;
  `scripts/release-profile-check.sh`; `AGENTS.md`; `CONTRIBUTING.md`;
  `docs/RELEASING.md`; and
  `docs/workflows/release-process/README.md`. *Tracking:*
  [#261](https://github.com/flyingrobots/colorful-language/issues/261).
  *Status:* implemented.
- **REL-17b — Policy-compliant release-tracker labels.** *Requirement:* REL-17.
  *Behavior:* the copy-paste release-tracker command carries exactly one
  `area:*` label from the repository's current live axis family, alongside the
  `documentation` and `slice` role labels, without coupling the check to one
  release version. *Oracle:* removing, duplicating, or substituting the
  reviewed area label fails at `docs/RELEASING.md` with the stable
  `E_DELIVERY_TRACKING` category, while one aligned future-version example
  remains valid and a label token outside the `gh issue create` command cannot
  satisfy a missing command option. The command boundary is the literal
  reviewed Bash fence, so a continued option after `--body-file` remains inside
  the validated invocation. *Evidence type:* deterministic repository-
  maintenance policy mutations and checked-in release-runbook validation.
  *Tracking:*
  [#263](https://github.com/flyingrobots/colorful-language/issues/263).
  *Evidence:* `scripts/check-repository-maintenance.test.mjs`
  `rejects a noncompliant release-tracker label set` and
  `does not accept release-tracker labels outside the command` plus
  `includes continued options after the tracker body file` plus
  `rejects an incomplete v0.4.0 tracking and prep sequence`;
  `scripts/check-repository-maintenance.mjs`; `docs/RELEASING.md`;
  `docs/workflows/release-process/README.md`; and
  `docs/workflows/repository-maintenance/README.md`. *Status:* implemented.
- **REL-18a — Complete pre-publication release packet.** *Requirement:* REL-18.
  *Behavior:* the v0.4.0 packet and verification scaffold identify the release
  version and previous public tag; define one release thesis and SemVer
  justification; contain non-empty must-ship, may-slip, and not-included scope
  buckets; declare two to five goalposts with acceptance evidence; name
  non-claims, risks, and rollback posture; link every scoped slice; and mark
  tag, registry, attestation, public-install, Zed-submission, Homebrew, and
  retrospective evidence as not yet available before publication. The witness
  status names the exact target, previous public tag, and unavailable target
  tag; completed evidence includes inline and reference-style link
  destinations; a target behind the latest reachable public tag is invalid; and
  the policy self-test and live check remain ordered, unconditional,
  fail-closed executable steps in every gate. *Oracle:* deleting or emptying
  each required section, changing status identity, claiming the target tag,
  exceeding the goalpost bound, inventing public evidence in prose or a link,
  omitting a scoped-slice link, selecting a stale target, moving commands into
  dormant workflow data or unreachable shell, or making a workflow gate
  conditional or failure-tolerant fails with a stable path-addressed category;
  the documented `not available`, `unavailable`, and `pending` states remain
  valid. *Evidence type:* deterministic release-packet policy and mutation
  tests. *Tracking:*
  [#280](https://github.com/flyingrobots/colorful-language/issues/280).
  *Evidence:* `scripts/check-release-packet.mjs`;
  `scripts/check-release-packet.test.mjs` cases `accepts a complete
  pre-publication release packet`, `rejects a release packet without a
  thesis`, `rejects packet and witness identity drift`, `rejects every missing
  or empty release section`, `rejects an empty scope bucket`, `requires exact
  scope buckets and slice inventory`, `enforces the two-to-five goalpost
  bound`, `rejects a scoped issue omitted from the slice inventory`, `rejects
  every missing verification section`, `requires exactly one release phase`,
  `rejects contradictory pre-publication status identity`, `rejects invented
  public evidence in the pre-publication phase`, `rejects linked public evidence
  in the pre-publication phase`, `rejects reference-linked public evidence in
  the pre-publication phase`, `accepts the documented unavailable
  pre-publication state`, `requires the self-test before the live check in every
  release gate`, `does not accept dormant release gate commands`, `does not
  accept release gates after shell termination`, `requires fail-closed workflow
  gate steps`, `reports a stable category when the target packet is missing`,
  `derives the previous release from public tags, not packet directories`,
  `rejects a target behind the latest public release`, `ignores release tags
  that are not reachable from HEAD`, and `the checked-in v0.4.0 release packet
  satisfies the policy`;
  `docs/goalposts/v0.4.0/release.md`;
  `docs/goalposts/v0.4.0/verification.md`; `.github/workflows/ci.yml`;
  `.github/workflows/release.yml`; and `scripts/release-prep.sh`. *Status:*
  implemented.

## Open verification gaps

- The tag workflow is only exercised on release tags.
- The repo does not yet have an autotag workflow; manual annotated tag creation
  remains the current preflighted path.
- Release-tracking issue existence and goalpost/slice scope hygiene are still
  verified manually; the ownership axes and their references are enforced by
  executable profile policy.
- GitHub Release asset recovery is still a manual inspection path when a release
  exists but assets are missing.
- Native platform archives, editor-registry publication, and signed provenance
  are implemented in the tag workflow but remain unverified on a public tag.
  Zed registry submission and public distribution rollback evidence remain
  planned in REL-12a through REL-15a.
