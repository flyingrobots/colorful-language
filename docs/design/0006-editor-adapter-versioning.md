# ADR-0006: Synchronize editor adapters with the server release

- Status: Accepted
- Date: 2026-07-28

## Context

The Rust workspace is preparing version 0.4.0 while the VS Code and Zed
manifests still carry 0.2.1. The repository publishes Rust crates and server
binaries from one `vX.Y.Z` tag, and the planned editor-publication slice will
package the adapters from that same reviewed source. No independent adapter
release workflow, compatibility manifest, or rollback authority exists.

The adapters are deliberately thin. They start a user-resolvable
`colorful-lsp` binary and delegate analysis, diagnostics, and semantic tokens
to it. They do not currently negotiate an extension-specific protocol or carry
their own analysis behavior. A version policy therefore needs to identify both
the release set and the server versions that an adapter may start.

Colorful is pre-1.0. The release policy reserves a minor version bump for a
breaking public change and a patch version for a compatible correction.
Prerelease publication is unsupported.

## Decision

Use one synchronized release version for:

1. the Cargo workspace and its published crates;
2. the VS Code extension manifest and lockfile root;
3. the Zed extension manifest; and
4. the standalone Zed build crate and its lockfile package entry.

The repo-local release profile lists every version source. One deterministic
policy checker reads those sources and fails when any value differs from the
workspace release version.

For an adapter released as `0.Y.Z`, the compatible `colorful-lsp` range is the
same pre-1.0 minor line:

```text
>=0.Y.0 <0.(Y+1).0
```

This admits compatible server patch releases and rejects the next minor as
potentially breaking. The policy checker derives this range; adapter manifests
do not repeat a hand-maintained range in fields their packaging formats do not
standardize.

Stable releases only are admitted. A prerelease in any synchronized version
source fails closed until the release profile, packaging channels, and
compatibility policy deliberately add prerelease semantics.

## Consequences

- A release-preparation version update changes the workspace and both editor
  adapters as one reviewed set.
- Editor packages can state one exact release identity while accepting a newer
  compatible patch server from the same minor line.
- A server minor bump requires adapters to move with the release and starts a
  new compatibility line; it cannot silently pass the previous adapter policy.
- Independent adapter releases remain possible only through a future policy
  change that first adds distinct version sources, release workflows,
  compatibility declarations, and rollback ownership.
- Runtime server-version refusal is not introduced here. Packaged smoke tests
  and publication evidence remain responsible for proving the declared
  compatible set.
