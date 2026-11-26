# colorful-language v0.4.1 — Release Packet

## Release thesis

`v0.4.1` delivers the reviewed `v0.4.0` scope to users for the first time.
The annotated `v0.4.0` tag was pushed on 2026-11-24, but its publish workflow
failed at admission validation, so `v0.4.0` was tagged and never published:
no crate, archive, VSIX, Zed source archive, Homebrew formula, or GitHub
Release exists for it. The tag is kept, not moved and not rerun, and the same
work is released forward as `v0.4.1`.

`v0.4.1` carries the `v0.4.0` source unchanged, plus the release-process
fixes that let a tag run admit its own commit and that record the abandoned
`v0.4.0` honestly. For users, it is the upgrade from `v0.3.0`: the hardened
public boundaries, responsive editor analysis, reproducible evidence, and
signed distribution described in the
[v0.4.0 release packet](../v0.4.0/release.md), including that release's
breaking API changes.

## Version decision

Release `0.4.1` after `v0.4.0`. Measured against the `v0.4.0` tag, which is
the baseline for scope reconciliation, the change is a patch: only release
tooling, witnesses, and documentation changed, and no file under `crates/`,
`contracts/`, `consumers/`, `editors/`, or `fuzz/` changed except the version
lines. The version cannot be `0.4.0`, because that tag is public and
immutable.

Measured against `v0.3.0`, the last published release and the baseline for
the user-facing notes, `0.4.1` is the first installable release of the 0.4
line and carries the pre-1.0 breaking API changes that the `v0.4.0` packet
decided as a minor release. Staying on the 0.4 line keeps those changes where
the changelog records them, under `0.4.0`, and keeps the synchronized editor
adapters on the same `colorful-lsp` range, `>=0.4.0 <0.5.0`. The split
baseline is the owner's decision on
[#380](https://github.com/flyingrobots/colorful-language/issues/380).

## Upgrading from v0.3.0

Nobody could install `0.4.0`, so these notes describe the upgrade from
`v0.3.0`. `CHANGELOG.md` keeps the full ledger: the `0.4.0` section holds the
product changes, and the `0.4.1` section holds the release-process changes.

Breaking API changes for Rust callers, all recorded under `0.4.0`:

- `colorful_ir::vocabulary::{visual_role, visual_role_for, projection}` return
  `Option`; callers must handle the `None` case.
- `colorful_ir::from_classification` takes two more parameters, the parser and
  annotator `PassIdentity` values.
- `colorful_ir::ValidationError` carries a structured `path` on every variant
  in place of the old `what` and `index` fields, and renders through
  `Display`.
- `Rule` can carry an owned external diagnostic code, so it is no longer
  `Copy`, and `Rule::code` borrows from the rule.

New for users since `v0.3.0`, all recorded under `0.4.0`: Markdown analysis
that keeps source coordinates, generation-safe LSP analysis inside a measured
service envelope, one smoke-tested VSIX and a Zed source archive on the GitHub
Release, native archives for Linux x86-64, Apple Silicon, and Windows x86-64
with checksums and provenance, a Homebrew formula asset, CycloneDX bills of
materials, and an optional Vale v3 analyzer comparison. Artifacts written by
`v0.3.0` remain admitted through the versioned `colorful.syntax/v1`
compatibility manifest.

## Scope

### Must ship

- The reviewed `v0.4.0` scope, unchanged in source: every slice the
  [v0.4.0 release packet](../v0.4.0/release.md) scopes, released under the
  `0.4.1` version
  ([#388](https://github.com/flyingrobots/colorful-language/issues/388)).
- A tag run that admits its own tagged commit, and a release workflow dry run
  on `main` that runs admission, the native builds, and packaging without
  publishing, before the tag
  ([#370](https://github.com/flyingrobots/colorful-language/issues/370) and
  [#374](https://github.com/flyingrobots/colorful-language/issues/374)).
- An honest record of the abandoned `v0.4.0`: the terminal `abandoned` witness
  phase, a predecessor rule that judges the previous witness by its phase, the
  runbook path for a tag whose own tree cannot pass admission, current
  references that say what happened, and the map of what the skipped
  publication requires
  ([#387](https://github.com/flyingrobots/colorful-language/issues/387),
  [#383](https://github.com/flyingrobots/colorful-language/issues/383),
  [#384](https://github.com/flyingrobots/colorful-language/issues/384),
  [#386](https://github.com/flyingrobots/colorful-language/issues/386), and
  [#375](https://github.com/flyingrobots/colorful-language/issues/375)).
- `fuzz/Cargo.lock` checked as a release version source, and a review-bot
  label allowlist that keeps the roadmap check's `slice` label authoritative
  ([#385](https://github.com/flyingrobots/colorful-language/issues/385) and
  [#371](https://github.com/flyingrobots/colorful-language/issues/371)).

### May slip

- A public first-party Homebrew tap, with clean-machine install, upgrade, and
  rollback evidence, may follow the tagged release
  ([#37](https://github.com/flyingrobots/colorful-language/issues/37)).
- External Zed registry acceptance, and VS Code Marketplace or Open VSX
  listings, may follow as discovery channels; they do not gate the GitHub
  Release VSIX or the Zed source archive
  ([#154](https://github.com/flyingrobots/colorful-language/issues/154)).

### Not included

- No product behavior changes since `v0.4.0`. Comparative market validation
  and the user discovery study remain the evidence gate after distribution
  ([#155](https://github.com/flyingrobots/colorful-language/issues/155) and
  [#158](https://github.com/flyingrobots/colorful-language/issues/158)).
- The WebAssembly build of `colorful ir` is the intended lead for a later
  release, not part of this one
  ([#326](https://github.com/flyingrobots/colorful-language/issues/326)).
- Dependency updates held until after the tag, including the `editors/vscode`
  update group
  ([#335](https://github.com/flyingrobots/colorful-language/issues/335)).
- Contract English and Intent English remain future moonshot phases
  ([#13](https://github.com/flyingrobots/colorful-language/issues/13) and
  [#14](https://github.com/flyingrobots/colorful-language/issues/14)).

## Goalposts

- **Installable 0.4 line:** the reviewed `v0.4.0` source reaches users as
  `0.4.1`, with every release version source synchronized and no dependency
  moved
  ([#388](https://github.com/flyingrobots/colorful-language/issues/388) and
  [#385](https://github.com/flyingrobots/colorful-language/issues/385)).
- **Admissible tag run:** the tag workflow admits the commit it checks out,
  and a dry run on `main` exercises that workflow before the tag
  ([#370](https://github.com/flyingrobots/colorful-language/issues/370) and
  [#374](https://github.com/flyingrobots/colorful-language/issues/374)).
- **Honest release history:** the `v0.4.0` witness stands at `abandoned`, the
  predecessor rule admits `v0.4.1` only through that phase, and the runbook
  and current references describe the patch-forward path
  ([#387](https://github.com/flyingrobots/colorful-language/issues/387),
  [#383](https://github.com/flyingrobots/colorful-language/issues/383),
  [#384](https://github.com/flyingrobots/colorful-language/issues/384), and
  [#386](https://github.com/flyingrobots/colorful-language/issues/386)).

## Scoped slices

| Disposition | Slices |
| --- | --- |
| Installable 0.4 line | [#388](https://github.com/flyingrobots/colorful-language/issues/388), [#385](https://github.com/flyingrobots/colorful-language/issues/385) |
| Admissible tag run | [#370](https://github.com/flyingrobots/colorful-language/issues/370), [#374](https://github.com/flyingrobots/colorful-language/issues/374) |
| Honest release history | [#387](https://github.com/flyingrobots/colorful-language/issues/387), [#383](https://github.com/flyingrobots/colorful-language/issues/383), [#384](https://github.com/flyingrobots/colorful-language/issues/384), [#386](https://github.com/flyingrobots/colorful-language/issues/386), [#375](https://github.com/flyingrobots/colorful-language/issues/375) |
| Repository maintenance | [#371](https://github.com/flyingrobots/colorful-language/issues/371) |
| May slip | [#37](https://github.com/flyingrobots/colorful-language/issues/37), [#154](https://github.com/flyingrobots/colorful-language/issues/154) |
| Explicitly excluded | [#155](https://github.com/flyingrobots/colorful-language/issues/155), [#158](https://github.com/flyingrobots/colorful-language/issues/158), [#326](https://github.com/flyingrobots/colorful-language/issues/326), [#335](https://github.com/flyingrobots/colorful-language/issues/335), [#13](https://github.com/flyingrobots/colorful-language/issues/13), [#14](https://github.com/flyingrobots/colorful-language/issues/14) |

The scope is reconciled against the `v0.4.0` tag, as the version decision
records: the slices above are the work merged since that tag. The slices that define the
`v0.4.0` content stay listed in the
[v0.4.0 release packet](../v0.4.0/release.md), and `CHANGELOG.md` remains the
exhaustive release-visible ledger.

## Explicit non-claims

- The packet does not mean `v0.4.1` has been tagged, published, or publicly
  verified, and it does not mean final preflight or the release dry run has
  passed on the commit to be tagged.
- `v0.4.0` was never published. Its tag is kept as it is; nothing is
  republished from it, and its witness stays at the terminal `abandoned`
  phase.
- The `[release] v0.4.1` tracker does not exist yet. As the owner decided on
  [#381](https://github.com/flyingrobots/colorful-language/issues/381), it is
  created from this reviewed packet after merge, and the `v0.4.0` tracker
  [#283](https://github.com/flyingrobots/colorful-language/issues/283) is then
  closed as superseded with a pointer to it.
- The `colorful.syntax/v1` generation labelled `workspace-v0.4.0` in the
  compatibility manifest is to be released under the name `v0.4.1`, as the
  owner decided on
  [#382](https://github.com/flyingrobots/colorful-language/issues/382). The
  release applies that name after publication; this packet changes no wire
  identity and no generation id.
- Dependabot alert 33, medium severity, stays open in this release:
  `minimatch` 10.2.5 in `editors/vscode/package-lock.json` is affected by
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  (denial of service through glob-pattern amplification; affected
  `>=7.0.0 <11.0.1`). The extension reaches it at run time through
  `vscode-languageclient` 10.1.0, and the `@vscode/vsce` packaging tool also
  depends on it. The extension's document selectors carry no glob pattern, and
  `colorful-lsp` registers none, so the extension passes no untrusted glob
  pattern to it. The `editors/vscode` update held in
  [PR #355](https://github.com/flyingrobots/colorful-language/pull/355)
  ([#335](https://github.com/flyingrobots/colorful-language/issues/335)) is
  scheduled as the first update after publication; it moves
  `vscode-languageclient` to 11.0.1, whose `minimatch` range `^10.2.6` is
  still inside the affected range, so closing the alert needs a later
  language client or `minimatch` release.
- Dependency updates opened after the `v0.4.0` scope was reconciled, including
  Dependabot pull requests
  [#354](https://github.com/flyingrobots/colorful-language/pull/354) through
  [#358](https://github.com/flyingrobots/colorful-language/pull/358), are not
  part of `v0.4.1` and stay held until after the tag.
- The `v0.4.1` GitHub Release VSIX, Zed source, Homebrew formula, and native
  platform URLs are absent until the corresponding public bytes resolve.
- VS Code Marketplace, Open VSX, and Zed registry listings are optional
  discovery channels, not `v0.4.1` release requirements.
- The non-claims of the `v0.4.0` packet about the Vale adapter, the measured
  5 MiB LSP envelope, the portable IR, market selection, and the moonshot
  directions hold unchanged for `v0.4.1`.

## Risks and rollback

- **A rule found only at tag time:** a tag run uses the workflow and scripts
  of the tagged commit, so a defect found only there costs a version number,
  as `v0.4.0` did. A green release workflow dry run on `main` at the commit
  that passed final preflight is required before the tag.
- **Partial GitHub Release publication:** the tag is immutable. If release
  creation stops after any public side effect, compare every public asset with
  the admitted checksums and attestations before resuming; otherwise patch
  forward with a new version.
- **Editor release-asset mismatch:** compare the downloaded GitHub Release VSIX
  with the smoke-tested witness before admitting success. Do not overwrite an
  existing version with different bytes.
- **Native artifact defect:** retain checksums and GitHub attestations,
  withdraw claims for the affected channel, and patch forward without moving
  the tag.
- **No earlier compatible release to roll back to:** no version of the 0.4
  line has been published, and `v0.3.0` servers fall outside the `0.4.1`
  adapters' `colorful-lsp` range. A defect in `0.4.1` is therefore handled by
  patching forward; users who need the previous behavior reinstall the
  complete `v0.3.0` server and editor set.
- **Open advisory:** Dependabot alert 33 stays open, as the non-claims record;
  the extension passes no untrusted glob pattern to the affected package.
- **Contract regression:** preserve all registered wire generations and
  migration fixtures; an incompatible repair requires an explicit new
  generation or contract version.

Publication and rollback owner: `@flyingrobots`.

## Acceptance evidence

- **Installable 0.4 line:** `bash scripts/release-profile-check.sh`,
  `node scripts/check-editor-version-policy.mjs`, and
  `git diff --stat v0.4.0 HEAD -- crates contracts consumers editors fuzz`
  show the synchronized `0.4.1` graph with only version lines changed, and
  `mise exec node@22.23.1 -- bash scripts/release-prep.sh` passes on the
  reviewed preparation branch.
- **Admissible tag run:** `node --test scripts/check-release-packet.test.mjs`
  and `node --test scripts/check-release-distribution.test.mjs` pass, and a
  release workflow dry run started with
  `gh workflow run release.yml --repo flyingrobots/colorful-language --ref main`
  is green on the commit that passed final preflight, before the tag.
- **Honest release history:** `node scripts/check-release-packet.mjs` admits
  this packet only after validating the `v0.4.0` witness at `abandoned` as its
  predecessor.
- Pull-request CI is green and every review thread is resolved before the
  packet lands.
- After the packet lands, `[release] v0.4.1` is created from these reviewed
  bytes and becomes the single release-train tracker, and #283 is closed as
  superseded.
- Final preflight passes from clean, aligned `main`, the release workflow dry
  run is green on the same commit, and the annotated `v0.4.1` tag points at
  that reviewed commit and does not already exist.
- The tag workflow publishes the exact admitted crates, native archives,
  checksums, attestations, VSIX, Zed source, Homebrew formula, and bills of
  materials.
- Public verification records the exact GitHub Release URLs, byte or checksum
  parity, clean-machine installation, version and LSP compatibility,
  first-highlight timing, VSIX removal, the patch-forward rehearsal, and the
  optional marketplace, Zed-registry, and Homebrew-tap follow-up state.
- The release retrospective records plan-versus-actual scope and fallout
  before the release tracker closes.

See [`verification.md`](verification.md) for the staged witness.
