# Merge gate

This workflow reference tells maintainers how to verify and recover the
default-branch merge gate. The live GitHub ruleset is the enforcement authority;
the reviewed manifest is its source-controlled desired state.

See the [merge-gate test plan](test-plan.md) for requirements and executable
evidence.

## Current contract

Ruleset `17949589`, named `mainline`, targets only the default branch. It is
active and requires:

- commits with verified signatures;
- pull requests merged with merge commits only;
- resolution of every review thread;
- protection against branch deletion and non-fast-forward updates;
- the following successful GitHub Actions checks:
  - `Docs & whitespace`;
  - `Rust (fmt, clippy, test)`;
  - `Cargo package witness`;
  - `IR cross-language round-trip witness`;
  - `Editor integrations (compile)`.

Each required check is pinned to GitHub Actions application `15368`. Strict
freshness is enabled, so GitHub requires the pull request to be tested with the
latest default-branch state. Merge `origin/main` into a behind feature branch;
do not rewrite shared history.

The existing repository-role bypass actor remains actor `5` in `always` mode.
It is a recovery capability, not the normal merge path. Changing that actor or
its mode requires explicit owner approval.

The desired state is
[`.github/rulesets/mainline.json`](../../../.github/rulesets/mainline.json).
The manifest includes every governed setting so an update cannot silently omit
an existing protection.

## Verify the contract

Run the deterministic mutation tests:

```bash
node scripts/check-main-ruleset.test.mjs
```

With an authenticated GitHub CLI session that can read the repository, compare
the live ruleset with the manifest:

```bash
gh auth status
node scripts/check-main-ruleset.mjs
```

The successful live result is:

```text
merge-gate: OK ruleset 17949589 matches the manifest
```

The `Docs & whitespace` CI job runs both checks. A live policy change that does
not update the manifest, or a manifest change that has not reached GitHub,
therefore fails the merge gate.

## Apply a reviewed ruleset change

Warning: the following command immediately changes protection for `main`. Run
it only after reviewing the complete manifest and capturing the current live
ruleset. Never remove or alter the bypass actor as part of an unrelated change.

Capture and inspect the current state:

```bash
gh api repos/flyingrobots/colorful-language/rulesets/17949589
git diff origin/main...HEAD -- .github/rulesets/mainline.json
node scripts/check-main-ruleset.test.mjs
```

Apply the reviewed manifest without its local metadata fields:

```bash
node scripts/check-main-ruleset.mjs --print-update-payload |
  gh api --method PUT \
    repos/flyingrobots/colorful-language/rulesets/17949589 \
    --input -
```

Then verify the live result:

```bash
node scripts/check-main-ruleset.mjs
```

Inspect the pull request's required checks and merge state before merging. A
normal merge requires all five contexts to pass and must not use the repository
role's bypass.

## Rename or retire a required context

Treat a check name as a wire identity. Renaming a workflow job without migrating
the ruleset leaves pull requests waiting for a context that can no longer
arrive.

For a planned rename:

1. Add the replacement job while retaining the old required job.
2. Merge that compatibility change through the existing gate.
3. Confirm a successful replacement check on `main` and verify that its source
   is GitHub Actions application `15368`.
4. Update the manifest and this reference on a new branch. Keep both workflow
   jobs in place during this ruleset-migration pull request.
5. Review the complete live-ruleset snapshot and manifest diff.
6. Apply the manifest with the command above.
7. Run the live checker and wait for all five required contexts on the migration
   pull request.
8. Merge the ruleset-migration pull request normally.
9. Remove the old compatibility job in a separate pull request after the new
   required context has passed on `main`.

For an unplanned missing context:

1. Confirm that the required context cannot be produced; do not weaken the gate
   merely because a check is slow or failing.
2. Identify the replacement context from an actual check run and verify GitHub
   Actions application `15368` as its source.
3. Capture the complete live ruleset and compare every governed field with the
   manifest.
4. Update the workflow, manifest, and reference on a branch.
5. Apply only the reviewed manifest, then run the live checker.
6. Require the replacement context and the other four checks to pass before a
   normal merge.

If the branch cannot produce either the old or replacement context, stop and
obtain explicit owner approval before using the existing bypass. Do not change
the bypass actor, disable the ruleset, or remove unrelated protections as a
shortcut. Record the recovery in the pull request and restore a normally
mergeable configuration immediately.
