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
   output-size limit;
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
