# Release process test plan

Verification for release preparation, tag automation, and release witnesses.

## Requirements

- **REL-1** A release has a packet, verification witness, changelog entry, tag,
  and GitHub Release.
- **REL-2** A release tag must point to a commit reachable from `origin/main`.
- **REL-3** The release workflow reruns Rust and package guards before publish.
- **REL-4** Crates publish in dependency order.
- **REL-5** The release runbook remains the canonical operational checklist.

## Cases

- **REL-1a** — *Requirement:* REL-1. *Behavior:* each completed release has a
  packet and witness under `docs/goalposts/vX.Y.Z/`. *Oracle:* documentation
  review. *Evidence:* `docs/goalposts/v0.1.0/`;
  `docs/goalposts/v0.2.0/`; `docs/goalposts/v0.2.1/`. *Status:* implemented.
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
  `docs/topics/release-process/README.md`. *Status:* implemented.

## Open verification gaps

- The tag workflow is only exercised on release tags. Release-prep changes run
  `actionlint` through the local release gate, but PR CI does not currently run
  workflow lint or publish.
