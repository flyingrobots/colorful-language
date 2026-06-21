<!-- Keep the contract honest: code, docs, and evidence should agree on `main`. -->

## What changed

<!-- One or two sentences. Link the slice issue: Closes #NN -->

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
