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

Download prebuilt release archives from the
[GitHub Releases](https://github.com/flyingrobots/colorful-language/releases)
page.

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

The workspace publishes seven crates in lock-step:

- `colorful-core`
- `colorful-lexicon`
- `colorful-parse`
- `colorful-ir`
- `colorful-lint`
- `colorful-cli`
- `colorful-lsp`

`colorful-cli` provides the `colorful` command. `colorful-lsp` provides the
language server. Library crates are internal building blocks but still publish as
ordinary crates.io packages.

## Known gaps

There is no Homebrew formula or tap yet. That belongs to a separate packaging
slice because it needs release assets, install docs, and smoke tests for a
different distribution channel.

See the [test plan](test-plan.md) for the cases that pin this behavior.
