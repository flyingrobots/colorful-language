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
  downloads and verifies every native archive and checksum, it derives one
  deterministic Homebrew formula for the supported Linux x86-64 and Apple
  Silicon archives, subjects the formula to release policy and available-host
  Homebrew checks, and attaches it to the same immutable GitHub Release. The
  formula installs the CLI and LSP from those archives; public tap publication
  and clean-machine rollback proof remain separate authority. *Oracle:* workflow
  mutations reject generation before native download, missing or mismatched
  checksum inputs, rebuilt binaries, unsupported platform claims, an unpinned
  or drifted formula-syntax Ruby, and a formula omitted from release assets.
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

## Open verification gaps

- The tag workflow is only exercised on release tags.
- The repo does not yet have an autotag workflow; manual annotated tag creation
  remains the current preflighted path.
- Issue and milestone hygiene are still verified manually rather than by a
  profile-aware release gate.
- GitHub Release asset recovery is still a manual inspection path when a release
  exists but assets are missing.
- Native platform archives, editor-registry publication, and signed provenance
  are implemented in the tag workflow but remain unverified on a public tag.
  Zed registry submission and public distribution rollback evidence remain
  planned in REL-12a through REL-15a.
