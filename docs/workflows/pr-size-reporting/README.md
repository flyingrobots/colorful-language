# PR size reporting

PR size reporting provides a non-blocking advisory signal to contributors about
the physical size of their pull request. This workflow exists to prompt the
splitting of large PRs along logical boundaries (such as transport, domain,
evidence, or documentation) before review.

## Current behavior

The PR size is analyzed during the pull request CI run by the `pr-size` job in
`.github/workflows/ci.yml`. This job executes the size reporting script:

```bash
bash scripts/pr-size-report.sh
```

- The script compares the head commit of the PR branch against the base branch.
- It calculates the sum of added and removed lines, excluding generated files and release packets.
- If the count exceeds the threshold (default `800` lines), it prints a GitHub Actions notice annotation to guide the developer.
- The signal is **informational and advisory only** and never blocks a merge or fails the build (the script and CI job always exit 0).

## Excluded paths

To ensure the signal reflects actual human-authored changes and does not penalize generated files or release artifacts, the following path patterns are excluded:

- `crates/colorful-ir/src/generated/**` — generated IR type mappings.
- `crates/colorful-ir/ts/**` — generated TypeScript code.
- `docs/goalposts/**` — release packets and witnesses.
- `Cargo.lock` — lockfile.
- `editors/vscode/package-lock.json` — lockfile.

## Self-test

The script has an embedded self-test that verifies its line counting and exclusion logic on a temporary git repository:

```bash
bash scripts/pr-size-report.sh --self-test
```
