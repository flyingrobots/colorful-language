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
- **DIST-6** Homebrew distribution must use reviewed release assets, support a
  clean installation, and remain absent from current-reference installation
  claims until the formula or tap exists.
- **DIST-7** Published editor and server artifacts must have public registry or
  release URLs, integrity evidence, clean-machine installation evidence, and
  rollback instructions.

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

## Open verification gaps

- crates.io install smoke tests are not part of PR CI because they depend on
  already-published versions.
- Homebrew remains unavailable until DIST-6a lands.
- Signed editor releases and the native server artifact matrix remain
  unavailable until DIST-7a lands.
