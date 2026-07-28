# ADR-0005: Prototype Vale through a prepared analyzer snapshot

- Status: Accepted for prototype
- Date: 2026-07-28

## Context

The pure `Analyzer` port is synchronous and returns deterministic
`Finding`s. An external editorial engine has a different operational contract:
its executable or configuration may be absent, its version may be incompatible,
its process may time out or fail, its output may be malformed, and in-flight
work must be cancellable. Returning an empty finding list for any of those
failures would silently change semantics. Teaching `colorful-core` about
processes, timeouts, or JSON would violate the hexagonal boundary.

The prototype can use either Harper or Vale. Vale v3 is selected because its
documented CLI already provides the exact comparison seam this experiment
needs: `--version`, explicit `--config`, `--no-global`, stdin input with
`--ext`, built-in JSON output, and a distinct runtime-error exit code. Vale
styles also cover the external editorial-rule proposition without taking
ownership of Colorful's structural/POS visualization or canonical IR. The
prototype targets the documented v3 contract; a later Vale major requires an
explicit compatibility decision.

Sources:

- [Vale CLI options and return codes](https://vale.sh/docs/cli)
- [Vale JSON output](https://vale.sh/docs/templates)
- [Vale configuration search and global configuration](https://vale.sh/docs/vale-ini)

## Decision

Add a `colorful-vale` outer adapter crate. It depends on `colorful-core`;
neither the core nor the production CLI/LSP binaries depend on it.

Use a two-stage boundary:

1. process discovery validates an explicit configuration and a supported Vale
   v3 executable;
2. process execution owns stdin/stdout/stderr, timeout, cancellation, and an
   output-size limit; on Unix it also owns a dedicated process group so wrapper
   descendants cannot retain capture pipes after termination;
3. structural parsing and coordinate validation either return a typed adapter
   error or produce a document-bound normalized snapshot; and
4. only that successful, I/O-free snapshot implements the existing `Analyzer`
   port for the same source identity.

The adapter invokes no network operation and never runs `vale sync`. It removes
ambient Vale configuration overrides, disables global configuration, and uses
only the caller's explicit configuration. Missing, incompatible, timed-out,
cancelled, failed, oversized, or malformed executions are adapter errors; none
becomes an empty finding list or a fallback to `ProseLinter`.

External check identities become validated, namespaced diagnostic rule codes.
Vale suggestions map to Colorful `Info`; Vale warnings and errors map to
Colorful `Warning`. Findings sort by complete source range, rule code, severity,
and message, independent of Vale's object or alert order. Vale findings remain
editorial diagnostics only: they do not alter parser output, token
classification, semantic tokens, or canonical IR.

## Prototype result

The implemented comparison boundary has six production source modules and
four production dependencies: `colorful-core`, Unix-only `rustix`, `serde`,
and `serde_json`. A manifest/source-inventory test makes those maintenance
measures reviewed changes rather than prose-only counts. The adapter crate is
non-publishable and is absent from the production dependency tables of the
core, CLI, and LSP.

The deterministic suite covers version/config discovery, ambient-config
isolation, stdin arguments, relative-path resolution, pre-start and in-flight
cancellation, Unix wrapper-descendant cleanup, timeout, process failure, output
bounds, UTF-8, JSON/alert shape, Unicode/CRLF coordinates, source identity,
total finding order, CLI/LSP parity, and semantic-token/canonical-IR
non-interference. A checksum-verified one-off
probe against the official Vale 3.14.2 macOS arm64 archive on 2026-07-28
(`vale_3.14.2_macOS_arm64.tar.gz`, SHA-256
`14305f4e5e0756351ffd4ff8dd1e561c5d49f6a27360834238d832d9e64ac70f`)
confirmed the real CLI accepts the selected flags and emits the modeled JSON
shape; that output is retained as an executable fixture.

This is useful substitution evidence, but it does not yet justify making Vale a
supported user-facing engine. Configuration/style ownership, external binary
installation, and process latency remain costs the built-in analyzer does not
have. The prototype therefore stays optional and outside both production
binaries.

## Consequences

- The built-in analyzer remains deterministic, offline, and self-contained.
- A successful external result can exercise the same CLI and LSP projection
  seams without making process failure part of the pure port.
- The prepared analyzer is document-bound. Reusing it for a different source is
  a typed source-identity error before it reaches either surface.
- Vale configuration and style installation remain user-owned prerequisites;
  Colorful neither downloads nor silently repairs them.
- The prototype measures substitution utility and maintenance cost before Vale
  becomes a supported product surface. A green prototype does not make Vale
  mandatory or authorize Harper/Vale-specific concepts in canonical IR.
