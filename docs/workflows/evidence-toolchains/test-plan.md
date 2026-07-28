# Evidence-toolchain test plan

Verification for deterministic Rust, Node, and TypeScript evidence toolchains,
an explicitly separate MSRV policy, and advisory forward-compatibility lanes.

Canonical issues:
[#147](https://github.com/flyingrobots/colorful-language/issues/147) and
[#151](https://github.com/flyingrobots/colorful-language/issues/151), with
bounded property/fuzz evidence tracked by
[#134](https://github.com/flyingrobots/colorful-language/issues/134).

## Requirements

- **ETC-1** A clean checkout must select one reviewed, exact Rust evidence
  toolchain with the components and targets required by the normal CI and
  release gates.
- **ETC-2** Primary CI and release automation must use that exact Rust evidence
  toolchain rather than a moving channel.
- **ETC-3** Repository JavaScript evidence must select one exact Node release
  and one exact, lockfile-backed TypeScript release without relying on a global
  compiler installation.
- **ETC-4** The minimum supported Rust version must remain a separate
  compatibility claim: either it is verified and declared, or it is explicitly
  unset with a named validation plan.
- **ETC-5** A weekly, manually runnable compatibility workflow must exercise the
  current Rust stable channel and the supported Node major line without making
  those moving versions the primary reproducibility oracle.
- **ETC-6** Maintainers must be able to detect unreviewed drift in evidence
  versions, workflow selectors, and package declarations with deterministic
  executable evidence.
- **ETC-7** The operational reference must document version ownership,
  compatibility semantics, update cadence, and the response to an advisory
  compatibility failure.
- **ETC-8** Weekly dependency automation must group GitHub Actions, the root
  Cargo workspace, the standalone Zed Cargo workspace, root Node, and VS Code
  updates by review and rollback boundary without creating competing cadences.
- **ETC-9** Deterministic policy evidence must reject floating action
  references, mutable Docker action tags, missing action-release comments, and
  dependency-update ecosystem, directory, cadence, grouping, or manual
  shared-dependency drift.
- **ETC-10** Property tests and fuzz targets must pin their dependency/tool
  versions, seeds, commands, and correctness-CI limits; time-based fuzzing stays
  an explicit maintainer action outside the deterministic merge gate.

## Cases

- **ETC-1a** — *Requirements:* ETC-1, ETC-2. *Behavior:* the repository
  toolchain file names an exact Rust release and its required components and
  targets; all primary CI and release Rust jobs select that same release.
  *Oracle:* a clean rustup-enabled checkout reports the recorded release, and a
  deterministic policy check rejects any moving or mismatched primary selector.
  *Evidence type:* toolchain manifest, workflow execution, and policy-check
  self-test. *Evidence:* `rust-toolchain.toml`, the `rust` and `editors` jobs
  in `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and
  `scripts/check-evidence-toolchains.mjs`. *Status:* implemented.
- **ETC-2a** — *Requirements:* ETC-3, ETC-6. *Behavior:* the repository names
  one exact Node release; root evidence tooling and the VS Code adapter declare
  the same exact TypeScript release in lockfile-backed manifests; the IR
  witness invokes the root-local compiler. *Oracle:* clean `npm ci`
  installations reproduce both dependency graphs, compilation and the IR
  witness pass, and the policy self-test rejects ranges, version disagreement,
  and ambient/global TypeScript installation. *Evidence type:* version file,
  package manifests and locks, executable witness, and policy-check self-test.
  *Evidence:* `.node-version`, both `package.json` / `package-lock.json` pairs,
  `scripts/ir-witness.sh`, and `scripts/check-evidence-toolchains.mjs`.
  *Status:* implemented.
- **ETC-3a** — *Requirement:* ETC-4. *Behavior:* the workspace manifest and
  contributor references explicitly distinguish the evidence compiler from
  MSRV; no lower-bound claim exists until a dedicated compatibility lane
  verifies it. *Oracle:* policy inspection rejects a `rust-version` declaration
  and requires current references to state that the evidence compiler is not
  MSRV; human review remains the oracle for broader prose claims. *Evidence
  type:* manifest, operational reference, policy check, and review. *Evidence:*
  `Cargo.toml`, `README.md`, `CONTRIBUTING.md`, and
  `scripts/check-evidence-toolchains.mjs`. *Status:* implemented.
- **ETC-4a** — *Requirements:* ETC-5, ETC-7. *Behavior:* a weekly and
  manually-dispatchable workflow runs the Rust gate on current stable and the
  JavaScript/editor gates on the supported Node major line. The workflow and
  reference name the maintainer as owner and classify failures as advisory
  compatibility signals requiring triage. *Oracle:* workflow trigger and
  selector inspection plus the first post-merge scheduled or manual execution.
  *Evidence type:* scheduled workflow, policy check, and Actions run.
  *Evidence:* `.github/workflows/compatibility.yml`,
  `docs/workflows/evidence-toolchains/README.md`, and
  `scripts/check-evidence-toolchains.mjs`. *Status:* implemented; live execution
  begins after the workflow reaches the default branch.
- **ETC-5a** — *Requirements:* ETC-6, ETC-7. *Behavior:* a deterministic
  repository policy checker validates exact primary selectors, package/lock
  agreement, the MSRV separation, and the moving compatibility selectors; its
  self-test mutates each protected condition and observes the expected stable
  failure category. *Oracle:* the self-test passes only when every mutation is
  rejected for its intended reason. *Evidence type:* executable policy checker
  and CI step. *Evidence:* `scripts/check-evidence-toolchains.mjs` and the
  `docs` job in `.github/workflows/ci.yml`. *Status:* implemented.
- **ETC-6a** — *Requirement:* ETC-8. *Behavior:* one Dependabot configuration
  schedules weekly grouped updates for GitHub Actions, the root Cargo
  workspace, the standalone Zed Cargo workspace, root Node evidence
  dependencies, and the VS Code adapter's separate Node graph. Each source has
  one named group and one cadence. *Oracle:* structural inspection finds
  exactly the expected ecosystem/directory pairs, including both Cargo
  workspaces, weekly schedules, and risk-separated group names with no
  duplicate pair or extra update source. *Evidence type:* repository
  configuration and deterministic policy test. *Evidence:*
  `.github/dependabot.yml` and
  `scripts/check-dependency-update-policy.test.mjs`. *Status:* implemented.
- **ETC-7a** — *Requirement:* ETC-9. *Behavior:* a deterministic dependency
  policy checker preserves full-SHA third-party action references with release
  comments and the exact Dependabot source/group matrix. Its mutation suite
  removes or changes each protected field independently. *Oracle:* every
  mutation is rejected with its intended stable error category, including
  removal of either npm source's manual TypeScript exclusion and legal alternate
  YAML spellings of an unsafe `uses` key, plus mutable or uncommented Docker
  action references, while the reviewed configuration passes. *Evidence type:*
  executable policy checker, mutation test, CI step, and release-preparation
  gate. *Evidence:*
  `scripts/check-dependency-update-policy.mjs`,
  `scripts/check-dependency-update-policy.test.mjs`, the `docs` job in
  `.github/workflows/ci.yml`, and `scripts/release-prep.sh`. *Status:*
  implemented.
- **ETC-8a** — *Requirement:* ETC-10. *Behavior:* the workspace lockfile pins
  the property-test dependency, the standalone fuzz workspace lockfile pins the
  fuzz runtime, and one repository script owns the exact 32-byte seed,
  256-case bound, target inventory, and commands. Normal CI runs only the
  bounded seeded corpus; documented time-based commands run each fuzz target
  manually and preserve any minimized failure as an ordinary regression.
  *Oracle:* the policy script rejects version, seed, case-count, target, command,
  or CI-wiring drift with stable categories, while the live bounded corpus
  exits zero. *Evidence type:* manifest/lockfiles, executable policy mutation
  tests, CI step, and operational reference. *Evidence:* root and `fuzz/`
  Cargo manifest/lock pairs; `scripts/check-property-fuzz-policy.mjs`;
  its 37-case mutation suite; `.github/workflows/ci.yml`;
  `scripts/release-prep.sh`; the evidence-toolchain reference. *Tracking:*
  [#134](https://github.com/flyingrobots/colorful-language/issues/134).
  *Status:* implemented.
