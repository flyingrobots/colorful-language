# PR size reporting test plan

Verification for PR size analysis, line exclusion logic, and self-test harness.

## Requirements

- **PRS-1** PR diff size is reported as an advisory, non-blocking signal in CI for pull requests.
- **PRS-2** Certain generated files, lockfiles, and release packet directories are excluded from the line count diff.
- **PRS-3** The report script must never block merge or fail the build (always exits 0).
- **PRS-4** The reporter has an executable self-test (`--self-test`) that runs in CI to verify line counting and exclusions on a mock git repository.

## Cases

- **PRS-1a** — *Requirement:* PRS-1. *Behavior:* a PR size notice annotation is printed if a PR diff exceeds the advisory line threshold. *Oracle:* workflow execution and output review. *Evidence type:* workflow log check. *Evidence:* `.github/workflows/ci.yml`. *Status:* implemented.
- **PRS-2a** — *Requirement:* PRS-2. *Behavior:* the diff calculation excludes generated IR types, lockfiles, and release packets. *Oracle:* script source review and self-test assertions. *Evidence type:* executable script. *Evidence:* `scripts/pr-size-report.sh`. *Status:* implemented.
- **PRS-3a** — *Requirement:* PRS-3. *Behavior:* the reporter exits 0 regardless of whether the line count is above or below the threshold. *Oracle:* script review and run exit code verification. *Evidence type:* executable script. *Evidence:* `scripts/pr-size-report.sh`. *Status:* implemented.
- **PRS-4a** — *Requirement:* PRS-4. *Behavior:* the `--self-test` suite initializes a mock git repo, simulates commits with both real and generated changes, and asserts correct diff filtering and annotation. *Oracle:* script execution. *Evidence type:* integration test run in CI. *Evidence:* `scripts/pr-size-report.sh` via the CI `pr-size` job. *Status:* implemented.
