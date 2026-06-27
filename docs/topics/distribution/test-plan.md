# Distribution test plan

Verification for install paths and published artifacts.

## Requirements

- **DIST-1** All publishable crates compile from packaged tarballs, not only from
  the workspace checkout.
- **DIST-2** The release workflow publishes crates in dependency order.
- **DIST-3** The release workflow builds one Linux `x86_64-unknown-linux-gnu`
  binary archive containing `colorful` and `colorful-lsp`.
- **DIST-4** The local install script installs `colorful` into a stable user
  prefix and explains the required `PATH` update.
- **DIST-5** Future Homebrew distribution must be tracked as its own packaging
  slice.

## Cases

- **DIST-1a** — *Requirement:* DIST-1. *Behavior:* each crate is packaged,
  extracted into a temporary workspace, patched to local package paths, and
  checked with Cargo. *Oracle:* script exits zero. *Evidence:*
  `scripts/package-witness.sh`; CI `Cargo package witness` job. *Status:*
  implemented.
- **DIST-2a** — *Requirement:* DIST-2. *Behavior:* crates publish in dependency
  order after a `v*` tag on `main`. *Oracle:* release workflow source and release
  witness. *Evidence:* `.github/workflows/release.yml`;
  `docs/RELEASING.md`. *Status:* implemented in workflow.
- **DIST-3a** — *Requirement:* DIST-3. *Behavior:* the release archive includes
  the CLI and LSP binaries plus release metadata and checksum files. *Oracle:*
  release workflow source and release witness. *Evidence:*
  `.github/workflows/release.yml`; `docs/goalposts/*/verification.md`. *Status:*
  implemented in workflow.
- **DIST-4a** — *Requirement:* DIST-4. *Behavior:* `scripts/install-local.sh`
  installs `colorful` under `$COLORFUL_HOME/bin`, defaulting to
  `$HOME/.colorful-language/bin`. *Oracle:* script review. *Evidence:*
  `scripts/install-local.sh`. *Status:* implemented.
- **DIST-5a** — *Requirement:* DIST-5. *Behavior:* Homebrew is not documented as
  an install path until a formula or tap exists. *Oracle:* documentation review.
  *Evidence:* `README.md`; `docs/topics/distribution/README.md`. *Status:*
  implemented as a documentation boundary.

## Open verification gaps

- crates.io install smoke tests are not part of PR CI because they depend on
  already-published versions.
- A Homebrew formula needs its own issue, release asset contract, and smoke test.
- Native macOS and Windows binary archives need their own artifact contract and
  install smoke tests.
