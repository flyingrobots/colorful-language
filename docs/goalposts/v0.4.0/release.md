# colorful-language v0.4.0 — Release Packet

## Release thesis

`v0.4.0` turns Colorful's post-`v0.3.0` hardening campaign into one coherent
public promise: a deterministic prose-analysis core whose public adapters fail
closed on malformed coordinates and contracts, whose LSP remains fresh under
reviewed document loads, and whose native and editor artifacts can be built,
checked, attested, installed, and rolled back through a documented release
path.

The release favors evidenced product maturity over speculative depth. It
retains the moonshot architecture and compatibility boundaries, while shipping
the validation, measurement, editor, optional-analyzer, and distribution work
needed for people to use today's product with confidence.

## Version decision

Release `0.4.0` after `v0.3.0`. This is a pre-1.0 minor release because the
queued line contains deliberate public API changes and new compatible
capabilities:

- classification and IR projection now return typed validation errors for
  invalid public adapter data;
- the IR validator exposes structured, path-addressed failures and stronger
  graph, range, identity, and derivation invariants;
- vocabulary lookup gains explicit fallible APIs while preserving documented
  compatibility wrappers;
- the CLI, LSP, generated contract consumers, optional analyzer boundary, and
  editor/distribution surfaces gain new public behavior.

A patch release would understate those compatibility obligations. The
`v0.3.0` wire generation remains admitted through the versioned compatibility
manifest and migration evidence; new `v0.4.0` bytes are not presented as a
silent patch to an older public contract.

## Scope

### Must ship

- Fail-closed public classification, projection, and IR admission with typed,
  path-addressed evidence
  ([#126](https://github.com/flyingrobots/colorful-language/issues/126),
  [#142](https://github.com/flyingrobots/colorful-language/issues/142),
  [#144](https://github.com/flyingrobots/colorful-language/issues/144),
  [#145](https://github.com/flyingrobots/colorful-language/issues/145),
  [#148](https://github.com/flyingrobots/colorful-language/issues/148), and
  [#156](https://github.com/flyingrobots/colorful-language/issues/156)).
- Generation-aware LSP analysis, a measured service envelope, synchronized
  adapter compatibility, packaged editor lifecycle evidence, and
  coordinate-preserving Markdown analysis
  ([#121](https://github.com/flyingrobots/colorful-language/issues/121),
  [#122](https://github.com/flyingrobots/colorful-language/issues/122),
  [#136](https://github.com/flyingrobots/colorful-language/issues/136),
  [#141](https://github.com/flyingrobots/colorful-language/issues/141), and
  [#241](https://github.com/flyingrobots/colorful-language/issues/241)).
- More trustworthy deterministic findings, shared numeric recognition, and an
  optional, isolated Vale v3 analyzer comparison
  ([#138](https://github.com/flyingrobots/colorful-language/issues/138),
  [#139](https://github.com/flyingrobots/colorful-language/issues/139),
  [#143](https://github.com/flyingrobots/colorful-language/issues/143), and
  [#157](https://github.com/flyingrobots/colorful-language/issues/157)).
- Reproducible property, fuzz, mutation, benchmark, doctest, coverage, and
  repository-maintenance evidence
  ([#81](https://github.com/flyingrobots/colorful-language/issues/81),
  [#82](https://github.com/flyingrobots/colorful-language/issues/82),
  [#134](https://github.com/flyingrobots/colorful-language/issues/134),
  [#135](https://github.com/flyingrobots/colorful-language/issues/135),
  [#137](https://github.com/flyingrobots/colorful-language/issues/137),
  [#140](https://github.com/flyingrobots/colorful-language/issues/140),
  [#147](https://github.com/flyingrobots/colorful-language/issues/147), and
  [#152](https://github.com/flyingrobots/colorful-language/issues/152)).
- A reviewed release packet and the repository-controlled signed native,
  editor, and Homebrew-formula artifact machinery, followed by public
  publication and verification
  ([#280](https://github.com/flyingrobots/colorful-language/issues/280),
  [#245](https://github.com/flyingrobots/colorful-language/issues/245),
  [#251](https://github.com/flyingrobots/colorful-language/issues/251), and
  [#154](https://github.com/flyingrobots/colorful-language/issues/154)).

### May slip

- A public first-party Homebrew tap, including clean-machine upgrade and
  rollback evidence, may follow the initial tagged artifact release
  ([#37](https://github.com/flyingrobots/colorful-language/issues/37)).
- External Zed registry acceptance may complete after the immutable source
  archive and maintainer submission exist; that timing does not change the
  tagged Colorful bytes
  ([#154](https://github.com/flyingrobots/colorful-language/issues/154)).

### Not included

- Comparative market validation and the 15-user discovery study remain the
  evidence gate after distribution
  ([#155](https://github.com/flyingrobots/colorful-language/issues/155) and
  [#158](https://github.com/flyingrobots/colorful-language/issues/158)).
- Contract English and Intent English remain future moonshot phases
  ([#13](https://github.com/flyingrobots/colorful-language/issues/13) and
  [#14](https://github.com/flyingrobots/colorful-language/issues/14)).
- No new provenance, controlled-natural-language, or Edict layer is introduced
  by this release.

## Goalposts

- **Boundary integrity:** public classification, IR, generated-validator, and
  independent-consumer paths reject malformed data deterministically while
  preserving admitted `v0.3.0` artifacts
  ([#126](https://github.com/flyingrobots/colorful-language/issues/126) and
  [#156](https://github.com/flyingrobots/colorful-language/issues/156)).
- **Responsive editor behavior:** the real LSP, VS Code package, Zed source,
  and Markdown adapter share coordinate-correct analysis and remain inside the
  reviewed service envelope
  ([#122](https://github.com/flyingrobots/colorful-language/issues/122) and
  [#241](https://github.com/flyingrobots/colorful-language/issues/241)).
- **Reachable distribution:** one immutable tag produces checksummed,
  attested native/editor/formula artifacts; public channels are verified
  without claiming a Homebrew tap before it exists
  ([#154](https://github.com/flyingrobots/colorful-language/issues/154) and
  [#37](https://github.com/flyingrobots/colorful-language/issues/37)).
- **Reproducible evidence:** bounded correctness suites and advisory performance
  reports remain rerunnable on the pinned toolchains
  ([#134](https://github.com/flyingrobots/colorful-language/issues/134) and
  [#137](https://github.com/flyingrobots/colorful-language/issues/137)).

## Scoped slices

| Disposition | Slices |
| --- | --- |
| Boundary integrity | [#126](https://github.com/flyingrobots/colorful-language/issues/126), [#142](https://github.com/flyingrobots/colorful-language/issues/142), [#144](https://github.com/flyingrobots/colorful-language/issues/144), [#145](https://github.com/flyingrobots/colorful-language/issues/145), [#148](https://github.com/flyingrobots/colorful-language/issues/148), [#156](https://github.com/flyingrobots/colorful-language/issues/156) |
| Responsive analysis and editors | [#121](https://github.com/flyingrobots/colorful-language/issues/121), [#122](https://github.com/flyingrobots/colorful-language/issues/122), [#136](https://github.com/flyingrobots/colorful-language/issues/136), [#141](https://github.com/flyingrobots/colorful-language/issues/141), [#241](https://github.com/flyingrobots/colorful-language/issues/241) |
| Findings and analyzers | [#138](https://github.com/flyingrobots/colorful-language/issues/138), [#139](https://github.com/flyingrobots/colorful-language/issues/139), [#143](https://github.com/flyingrobots/colorful-language/issues/143), [#157](https://github.com/flyingrobots/colorful-language/issues/157) |
| Reproducible evidence | [#81](https://github.com/flyingrobots/colorful-language/issues/81), [#82](https://github.com/flyingrobots/colorful-language/issues/82), [#134](https://github.com/flyingrobots/colorful-language/issues/134), [#135](https://github.com/flyingrobots/colorful-language/issues/135), [#137](https://github.com/flyingrobots/colorful-language/issues/137), [#140](https://github.com/flyingrobots/colorful-language/issues/140), [#147](https://github.com/flyingrobots/colorful-language/issues/147), [#152](https://github.com/flyingrobots/colorful-language/issues/152) |
| Release preparation and publication | [#280](https://github.com/flyingrobots/colorful-language/issues/280), [#245](https://github.com/flyingrobots/colorful-language/issues/245), [#251](https://github.com/flyingrobots/colorful-language/issues/251), [#154](https://github.com/flyingrobots/colorful-language/issues/154), [#37](https://github.com/flyingrobots/colorful-language/issues/37) |
| Explicitly excluded evidence phases | [#155](https://github.com/flyingrobots/colorful-language/issues/155), [#158](https://github.com/flyingrobots/colorful-language/issues/158), [#13](https://github.com/flyingrobots/colorful-language/issues/13), [#14](https://github.com/flyingrobots/colorful-language/issues/14) |

`CHANGELOG.md` remains the exhaustive release-visible ledger. This packet
groups the slices that define the release thesis and acceptance gates; it does
not replace per-issue history.

## Explicit non-claims

- The packet does not mean `v0.4.0` has been tagged, published, or publicly
  verified.
- Marketplace, Open VSX, Zed registry, Homebrew tap, and platform-install URLs
  are absent until the corresponding public bytes resolve.
- The Vale adapter is optional comparison evidence; no external process,
  network service, or ambient configuration becomes mandatory for the default
  CLI or LSP.
- The measured 5 MiB LSP envelope is not an unbounded performance guarantee.
  Documents above the reviewed limit fail fast with a stable diagnostic.
- The portable IR remains a shallow, versioned interchange contract. It is not
  a grammar, a replay log, or proof-carrying execution.
- This release does not select a primary market or user job; #155 and #158 own
  that evidence after real distribution.
- Controlled English, Edict, echo provenance, and Ouroboros remain preserved
  roadmap directions rather than `v0.4.0` features.

## Risks and rollback

- **Partial registry publication:** the tag is immutable. Rerun the release
  workflow only where its duplicate-byte checks prove equivalence; otherwise
  patch forward with a new version.
- **Editor registry mismatch:** compare downloaded public VSIX bytes with the
  smoke-tested witness before admitting success. Do not overwrite an existing
  version with different bytes.
- **Native artifact defect:** retain checksums and GitHub attestations, withdraw
  claims for the affected channel, and patch forward without moving the tag.
- **Zed acceptance delay:** the versioned source archive and submission remain
  auditable even if the external registry merges later.
- **Homebrew tap delay:** the attested formula remains a GitHub Release asset;
  no `brew install` claim appears until #37 records a real tap, install,
  upgrade, and rollback witness.
- **Contract regression:** preserve all registered wire generations and
  migration fixtures; an incompatible repair requires an explicit new
  generation or contract version.

Publication and rollback owner: `@flyingrobots`.

## Acceptance evidence

- The packet-policy self-test rejects missing identity, scope, goalpost,
  evidence, and gate-wiring invariants, and the live packet check passes.
- `bash scripts/release-profile-check.sh` and
  `node scripts/check-editor-version-policy.mjs` agree on synchronized
  `0.4.0` release sources and `colorful-lsp >=0.4.0 <0.5.0`.
- `mise exec node@22.23.1 -- bash scripts/release-prep.sh` passes on the
  reviewed preparation branch.
- Pull-request CI is green and every review thread is resolved before the
  packet lands.
- After the packet lands, `[release] v0.4.0` is created from these reviewed
  bytes and becomes the single release-train tracker without moving slice
  goalpost milestones.
- Final preflight passes from clean, aligned `main`; the annotated `v0.4.0`
  tag points at that reviewed commit and does not already exist.
- The tag workflow publishes the exact admitted crates, native archives,
  checksums, attestations, VSIX, Zed source, and Homebrew formula.
- Public verification records registry URLs, byte or checksum parity,
  clean-machine installation, version/LSP compatibility, first-highlight
  timing, rollback evidence, and the Zed/Homebrew follow-up state.
- The release retrospective records plan-versus-actual scope and fallout
  before the release tracker closes.

See [`verification.md`](verification.md) for the staged witness.
