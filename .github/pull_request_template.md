<!-- Keep the contract honest: code, docs, and evidence should agree on `main`. -->

## What changed

<!-- One or two sentences. Link the slice issue: Closes #NN -->

## Evidence

<!-- The deterministic, executable proof: test names, fixture paths, doctests.
     "Current truth" docs were updated only for behavior that now exists. -->

<!-- Name which commits in this branch are the planned-case / failing-evidence
     / passing-implementation trio (see CONTRIBUTING.md "Commit Shape: Planned,
     Failing, Passing"), or say this is a tiny, indivisible fix and why. Either
     way, commits are append-only: fixes land as new commits, never an amend,
     rebase, or squash. -->

## Checklist

- [ ] Living references (`README` / `docs/topics/<topic>/README.md`) describe
      only what is true on `main`.
- [ ] Planned cases in the relevant `test-plan.md` are marked implemented with
      their evidence, or new gaps are recorded.
- [ ] `CHANGELOG.md` / `ROADMAP.md` updated if this is release-visible.
- [ ] `cargo fmt`, `cargo clippy -D warnings`, and `cargo test` pass locally
      (once crates exist).
