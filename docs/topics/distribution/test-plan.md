# Distribution test plan

Verification for install paths and published artifacts.

## Requirements

- **DIST-1** All publishable crates compile from packaged tarballs, not only from
  the workspace checkout.
- **DIST-2** The release workflow publishes crates in dependency order.
- **DIST-3** The release workflow builds `colorful` and `colorful-lsp` on the
  reviewed Linux x86-64, Apple Silicon, and Windows x86-64 native matrix,
  packages checksums, and publishes provenance for the exact archives.
- **DIST-4** The local install script installs `colorful` into a stable user
  prefix and explains the required `PATH` update.
- **DIST-5** Future Homebrew distribution must be tracked as its own packaging
  slice.
- **DIST-6** Homebrew distribution must use reviewed release assets, support a
  clean installation, and remain absent from current-reference installation
  claims until the formula or tap exists.
- **DIST-7** Published editor and server artifacts must have public registry or
  release URLs, integrity evidence, clean-machine installation evidence, and
  rollback instructions.
- **DIST-8** The repository-controlled Homebrew formula must be generated from
  exact reviewed native-archive identities, install the synchronized CLI and
  LSP binaries together, and fail closed before public tap publication.

## Cases

- **DIST-1a** — *Requirement:* DIST-1. *Behavior:* each crate is packaged,
  extracted into a temporary workspace, patched to local package paths, and
  checked with Cargo. *Oracle:* script exits zero. *Evidence:*
  `scripts/package-witness.sh`; CI `Cargo package witness` job. *Status:*
  implemented.
- **DIST-2a** — *Requirement:* DIST-2. *Behavior:* crates publish in dependency
  order after a `v*` tag on `main`; the release profile and workflow agree, and
  every internal normal, build, or dev dependency precedes its dependent.
  *Oracle:* deterministic metadata-derived policy check, release workflow
  source, and release witness. *Evidence:*
  `scripts/check-release-publish-order.mjs`;
  `scripts/check-release-publish-order.test.mjs`;
  `.github/workflows/release.yml`; `docs/RELEASING.md`. *Status:* implemented
  in workflow and PR CI.
- **DIST-3a** — *Requirement:* DIST-3. *Behavior:* native jobs build the CLI and
  LSP on `ubuntu-24.04` / `x86_64-unknown-linux-gnu`, `macos-15` /
  `aarch64-apple-darwin`, and `windows-2025` /
  `x86_64-pc-windows-msvc`, only after final profile, editor compatibility,
  Rust, build, and package admission; every archive carries the same release
  metadata, one SHA-256 sidecar, and GitHub/Sigstore provenance. *Oracle:*
  profile and workflow mutations reject late validation, target drift, missing
  package members, absent checksums, or unsigned archives. *Evidence:*
  `.continuum/release.yml`; `.github/workflows/release.yml`;
  `scripts/check-release-distribution.mjs`;
  `scripts/check-release-distribution.test.mjs`
  `requires final validation before native provenance`. *Status:* implemented
  in workflow; public release evidence remains planned.
- **DIST-4a** — *Requirement:* DIST-4. *Behavior:* `scripts/install-local.sh`
  installs `colorful` under `$COLORFUL_HOME/bin`, defaulting to
  `$HOME/.colorful-language/bin`; a smoke test installs into a fresh
  temporary `COLORFUL_HOME`, verifies `bin/colorful --version`, reruns
  against the same `COLORFUL_HOME` to prove the documented "re-run to
  upgrade" path is idempotent (`--force`), and asserts the real
  `$HOME/.colorful-language` is never touched. *Oracle:* script exit code;
  version-string equality across the two runs; before/after equality of the
  real install directory's state. *Evidence:*
  `scripts/smoke-test-install-local.sh`; CI job `install-local-smoke`;
  `scripts/release-prep.sh`. *Status:* implemented.
- **DIST-5a** — *Requirement:* DIST-5. *Behavior:* Homebrew is not documented as
  an install path until a formula or tap exists. *Oracle:* documentation review.
  *Evidence:* `README.md`; `docs/topics/distribution/README.md`. *Status:*
  implemented as a documentation boundary.
- **DIST-6a** — *Requirement:* DIST-6. *Behavior:* a Homebrew formula or tap
  installs `colorful` from the reviewed platform asset on a clean machine,
  verifies the binary, and documents upgrade and rollback. *Oracle:* package
  install, version, checksum/signature, upgrade, and rollback commands all exit
  with the expected status; current-reference claims appear only after the
  public URL resolves. *Evidence type:* package recipe, clean-machine smoke
  script, and release witness. *Tracking:*
  [#37](https://github.com/flyingrobots/colorful-language/issues/37).
  *Status:* planned.
- **DIST-7a** — *Requirement:* DIST-7. *Behavior:* signed VS Code/Open VSX and
  Zed packages plus the reviewed platform server matrix install from public
  destinations and can be rolled back to the previous compatible version.
  *Oracle:* public URL resolution, integrity verification, clean-install
  activation, binary version, and rollback result equality. *Evidence type:*
  release-matrix witness and clean-machine process tests. *Tracking:*
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Status:* planned.
- **DIST-8a** — *Requirement:* DIST-8. *Behavior:* an exact release version,
  Linux x86-64 and Apple Silicon archive URLs, and their SHA-256 sidecars
  deterministically produce one Homebrew formula that installs `colorful` and
  `colorful-lsp`; malformed versions, checksums, missing platforms, and archive
  name drift fail before formula output. The formula tests the supported
  `colorful --version` contract and executable presence for `colorful-lsp`
  without inventing a server version flag. *Oracle:* fixed inputs produce exact
  formula bytes; one mutation per refused input produces a stable error
  category; workflow-order evidence proves formula generation consumes the
  already-built native artifacts rather than rebuilding them. *Evidence type:*
  deterministic generator, archive-integrity, and release-policy mutation
  tests. *Tracking:*
  [#251](https://github.com/flyingrobots/colorful-language/issues/251).
  *Evidence:* `scripts/generate-homebrew-formula.mjs`;
  `scripts/generate-homebrew-formula.test.mjs`
  `renders exact synchronized Homebrew formula bytes`,
  `rejects missing native archives even when a sidecar exists`,
  `rejects native bytes that do not match their sidecar`, and
  `the CLI emits the verified formula on stdout only`;
  `scripts/check-release-distribution.test.mjs`
  `rejects every Homebrew policy mutation` and
  `derives and attests Homebrew formulae from downloaded native assets`;
  `.github/workflows/release.yml`; `.github/workflows/ci.yml`;
  `scripts/release-prep.sh`. *Status:* implemented for generation, syntax, and
  release attachment; public tap audit/install/upgrade/rollback evidence
  remains planned in DIST-6a.

## Open verification gaps

- crates.io install smoke tests are not part of PR CI because they depend on
  already-published versions.
- Homebrew remains unavailable until DIST-6a lands.
- Publicly verified native matrix and signed editor releases remain unavailable
  until DIST-7a lands.
