# Working Agreement for Agents

This file tells an automated contributor (any coding agent) how to work in
`colorful-language` so that its changes satisfy [`CONTRIBUTING.md`](CONTRIBUTING.md).

`CONTRIBUTING.md` is the authority. This file is the operational translation:
the concrete things to do, in order, on every change. When the two disagree,
`CONTRIBUTING.md` wins — and you should fix this file.

## Prime Directive

**Living references describe only what is true on `main`.** Never write a
`README.md` or a `docs/topics/<topic>/README.md` to describe behavior that does
not yet exist in committed, tested code. Plans live in test plans, the roadmap,
issues, and pull requests — never in the current reference.

The four artifacts and their one job each:

| Artifact | Job |
| --- | --- |
| Current truth (`README`, `docs/topics/<topic>/README.md`) | What is true on `main` now. |
| Planned verification (`docs/topics/<topic>/test-plan.md`) | How behavior will be proven, written before it exists. |
| Executable evidence (tests, doctests, fixtures, goldens) | Proof the behavior is real. |
| Historical reasoning (`docs/design/`, `rationale.md`) | Why a decision was made, without posing as the current reference. |

## Documentation Corpus Standard

[`docs/DOCUMENTATION_STANDARDS.md`](docs/DOCUMENTATION_STANDARDS.md) is the
project-local standard for maintaining the documentation corpus. Follow it for
new and substantially changed docs.

Operational rules:

- Give every page one primary reader job: learn, do, look up, understand,
  troubleshoot, or contribute.
- Keep durable current behavior in `docs/topics/<topic>/README.md`; keep planned
  verification and known gaps in `docs/topics/<topic>/test-plan.md`.
- Add tutorials, how-to guides, reference pages, or troubleshooting pages only
  when the topic reference does not serve the reader's task.
- Link any new durable documentation page from `docs/README.md`.
- Use runnable examples when practical; separate copyable commands from expected
  output; do not use shell prompts in copyable command blocks.
- Put warnings before destructive, privileged, costly, or irreversible commands.
- Give informative visuals useful alt text or a nearby textual equivalent; never
  put essential instructions only in a screenshot.
- Treat prose metrics as editorial signals, not universal merge gates. Hard
  gates are facts: links, examples, generated reference, evidence, Markdown,
  whitespace, and contract coverage.

## The Delivery Loop

For any meaningful behavior change, do these in order:

1. If the change needs design discussion, write or update a design note
   (`docs/design/`) or a topic `rationale.md`.
2. Update the topic `test-plan.md` with planned cases **before** writing code.
   Each case carries a stable ID, the requirement(s) it covers, an explicit
   oracle, an evidence type, and a status.
3. Write the smallest deterministic, executable evidence that **fails** for the
   missing behavior. Tests are the spec — write the failing test first.
4. Implement until the test passes. Do not alter, skip, or weaken a test to go
   green; fix the code. If a test seems wrong, stop and raise it.
5. Update the topic `README.md` so it describes the behavior that now exists.
6. Mark the planned cases implemented and record the real test names / fixture
   paths / doctests that are the evidence.
7. Update `CHANGELOG.md` and `ROADMAP.md` when the change is release-visible or
   shifts project posture.

Small fixes scale this down but keep the same shape: clear claim, evidence,
implementation, honest current reference.

## Architecture Rules (the hexagon)

- `colorful-core` stays pure: domain types and port traits, **no I/O**.
- Everything outside (parsing, lexicon lookup, terminal output, the LSP) is an
  adapter behind a port.
- `Parser` (structure), `Lexicon` (context-free word lookup), and `Annotator`
  (context-aware classification) are **separate ports**. Keep them separate —
  that seam is what makes future goalposts cheap.
- Need a new capability? Add a port + adapter. Do not thread a concrete
  outside dependency through the core.

## Commits and Branches

- One logical change per commit. Use
  [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Reference the slice issue in the footer: `Closes #NN`.
- A breaking change carries a `BREAKING CHANGE:` footer and warrants a version
  bump.
- History is append-only: **no** force-push, rebase, squash, or amend on shared
  branches. Make a new commit instead.
- Do not delete or unstage files you did not create without explicit approval.
- Feature work happens on a branch and lands via pull request. Do not commit
  feature work directly to `main`.
- Stage with `git add -A`; a well-kept `.gitignore` is the safeguard, not
  selective staging.

## Roadmap Mechanics

- **Milestones = goalposts**, **issues = slices**. A slice's work closes its
  issue; keep `ROADMAP.md` anchors in sync.
- Do not describe an unbuilt goalpost as if it exists, in `ROADMAP.md` or
  anywhere else. The "Horizon" section is for directions, not commitments.

## Before You Say "Done"

Run the local gate and confirm it is clean. Once crates exist:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

For documentation changes:

```bash
markdownlint-cli2 "**/*.md"
git diff --check "$(git hash-object -t tree /dev/null)" HEAD
```

If you touch a GitHub Actions workflow, validate it before pushing — a bad
workflow fails with zero useful logs:

```bash
actionlint .github/workflows/*.yml
```

GitHub Actions runs the same checks as the merge gate. Zero tolerance for
errors and warnings: fix what you find, including pre-existing issues in code
you touch.

## Hard Don'ts

- Do not create a second current reference for a topic that already has a folder.
- Do not put durable behavior only in an issue, PR, or goalpost note.
- Do not leave planned or blocked test cases vague.
- Do not regenerate golden fixtures casually — golden changes are deliberate,
  reviewable, and tied to a contract change.
- Do not claim something is verified that you did not run. Report failures with
  their output.
