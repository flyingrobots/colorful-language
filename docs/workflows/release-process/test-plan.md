# Release process test plan

Verification for release preparation, tag automation, and release witnesses.

## Requirements

- **REL-1** A release has a packet, verification witness, changelog entry, tag,
  and GitHub Release.
- **REL-2** A release tag must point to a commit reachable from `origin/main`.
- **REL-3** The release workflow reruns Rust and package guards before publish.
- **REL-4** Crates publish in dependency order.
- **REL-5** The release runbook remains the canonical operational checklist.
- **REL-6** The repo declares release mechanics in a machine-checkable profile.
- **REL-7** Release-prep and final preflight gates are executable.
- **REL-8** The current lifecycle records verification and retrospective duties.
- **REL-9** The tag workflow validates metadata and is safe to rerun after
  crates are already available in the crates.io registry index.

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
  `cargo fmt`, `cargo clippy`, `cargo test`, `cargo build --release`, and the
  package witness. *Oracle:* workflow source review. *Evidence:*
  `.github/workflows/release.yml`. *Status:* implemented.
- **REL-4a** — *Requirement:* REL-4. *Behavior:* crates publish from leaf
  dependencies to dependents. *Oracle:* workflow source review. *Evidence:*
  `.github/workflows/release.yml`; `docs/RELEASING.md`. *Status:* implemented.
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
  type-checking, downstream, editor, Markdown, workflow, and whitespace checks;
  the Zed wasm build uses locked Cargo metadata. *Oracle:* script review and
  local execution. *Evidence:* `scripts/release-prep.sh`. *Status:* implemented.
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

## Open verification gaps

- The tag workflow is only exercised on release tags.
- The repo does not yet have an autotag workflow; manual annotated tag creation
  remains the current preflighted path.
- Issue and milestone hygiene are still verified manually rather than by a
  profile-aware release gate.
- GitHub Release asset recovery is still a manual inspection path when a release
  exists but assets are missing.
