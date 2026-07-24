<!-- Keep the contract honest: code, docs, and evidence should agree on `main`. -->

## What changed

<!-- One or two sentences. Link the slice issue here: Closes #NN
     This is the one place that should close the issue — commits in this
     branch should use `Refs #NN`, not a closing keyword. See CONTRIBUTING.md
     "Commits and Pull Requests". -->

## Evidence

<!-- The deterministic, executable proof: test names, fixture paths, doctests.
     "Current truth" docs were updated only for behavior that now exists. -->

## Checklist

- [ ] Living references (`README` / `docs/topics/<topic>/README.md`) describe
      only what is true on `main`.
- [ ] Planned cases in the relevant `test-plan.md` are marked implemented with
      their evidence, or new gaps are recorded.
- [ ] `CHANGELOG.md` / `ROADMAP.md` updated if this is release-visible.
- [ ] `cargo fmt`, `cargo clippy -D warnings`, and `cargo test` pass locally
      (once crates exist).
