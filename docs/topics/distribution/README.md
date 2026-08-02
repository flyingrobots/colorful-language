# Distribution

Distribution covers how users and downstream tools get the `colorful` CLI and
the `colorful-lsp` language server.

## Current install paths

The current public release is available through crates.io and GitHub Releases.

Install from crates.io:

```bash
cargo install colorful-cli
cargo install colorful-lsp
```

Install the latest `main` from git:

```bash
cargo install --git https://github.com/flyingrobots/colorful-language.git colorful-cli
cargo install --git https://github.com/flyingrobots/colorful-language.git colorful-lsp
```

Download the current prebuilt Linux archive from the
[GitHub Releases](https://github.com/flyingrobots/colorful-language/releases)
page. The latest public release provides one
`x86_64-unknown-linux-gnu` tarball containing both `colorful` and
`colorful-lsp`, plus release metadata and a SHA-256 checksum. For macOS,
Windows, and other Linux targets, install with Cargo or build from source.

The tag workflow on `main` is prepared to replace that single-platform shape on
the next deliberate release: native jobs build Linux x86-64, Apple Silicon, and
Windows x86-64 archives, checksum each archive, and publish
GitHub/Sigstore provenance. The same tagged workflow clean-installs one exact
VSIX before using those bytes for VS Code Marketplace and Open VSX, and it
packages the licensed Zed registry source. It also generates a CycloneDX
software bill of materials from the locked dependency graph and attests it with
the same provenance as the artifacts it describes, so a consumer can audit what
a release contains without building it. These are release mechanics, not
current install claims. No macOS, Windows, VS Code Marketplace, Open VSX, or Zed
public URL is documented as available until the tagged workflow and external
registries provide verification evidence.

The same tag workflow generates `colorful.rb` only after downloading the
already-built Linux x86-64 and Apple Silicon archives. The generator requires
the canonical archive names, reads their exact SHA-256 sidecars, streams each
archive to verify its digest, emits deterministic formula bytes, checks Ruby
syntax, and includes the formula in GitHub/Sigstore provenance. The formula
installs the synchronized `colorful` and `colorful-lsp` binaries from one
archive and tests the CLI version plus server executable presence.

This is release machinery, not a public Homebrew channel. The formula is
prepared as a GitHub Release asset; no tap is declared or documented as
available. Public `brew install`, upgrade, and rollback evidence remains
tracked by [#37](https://github.com/flyingrobots/colorful-language/issues/37).

For source-checkout development, especially with Graft or jedit, install the
local CLI into a stable user directory:

```bash
scripts/install-local.sh
export PATH="$HOME/.colorful-language/bin:$PATH"
```

`scripts/install-local.sh` installs `colorful` under
`$COLORFUL_HOME/bin/colorful`; when `COLORFUL_HOME` is unset, the default is
`$HOME/.colorful-language`.

## Package boundaries

The workspace publishes eight crates in lock-step:

- `colorful-core`
- `colorful-lexicon`
- `colorful-parse`
- `colorful-ir`
- `colorful-lint`
- `colorful-projection`
- `colorful-cli`
- `colorful-lsp`

`colorful-cli` provides the `colorful` command. `colorful-lsp` provides the
language server. Library crates are internal building blocks but still publish as
ordinary crates.io packages.

## Known gaps

There is no public Homebrew tap yet. The tag workflow can generate and attest
the formula release asset, but a normal `brew install` claim still needs a
public channel, clean-machine evidence, upgrade proof, and rollback proof; the
canonical tracker is [#37](https://github.com/flyingrobots/colorful-language/issues/37).

There are no publicly verified native macOS or Windows binary archives yet.
Signed editor artifacts, public registry URLs, and clean-install/rollback
evidence are tracked by
[#154](https://github.com/flyingrobots/colorful-language/issues/154). Homebrew
remains the separate operator-install slice in #37, while both lanes may reuse
the same release assets and checksum evidence.

See the [test plan](test-plan.md) for the cases that pin this behavior.
