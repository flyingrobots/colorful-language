# Contributing to colorful-language

`colorful-language` is a deterministic Rust project, and the contribution
process treats documentation as part of the contract. The goal is not to collect
design notes forever. The goal is to keep a reader, a reviewer, and the test
suite looking at the same truth.

The short version is:

```text
current truth -> planned verification -> executable evidence -> historical reasoning
```

Every artifact has one job, and a pull request should leave those artifacts in
agreement.

## The Mental Model

Think of the docs as a contract graph. A feature or concept has current
behavior, requirements, planned test cases, fixtures, executable tests, and
historical design decisions. Those pieces are connected with stable names and
IDs so a maintainer can answer one question: "What claim is this code making,
and what evidence proves it?"

That means we separate four kinds of information:

| Artifact | Job |
| --- | --- |
| Current truth | Describe what is true on `main` right now. |
| Planned verification | Describe how behavior will be tested before it is implemented. |
| Executable evidence | Tests, doctests, fixtures, or golden artifacts that prove the behavior. |
| Historical reasoning | Explain why a decision was made without pretending to be the current reference. |

The most important rule: **current truth must not describe future behavior.** If
a feature is planned but not implemented, it belongs in a test plan, an issue, a
design note, a roadmap slice, or a pull request. The living reference only
changes after the behavior and its evidence exist.

This discipline fits the domain unusually well. Our v0 oracle is concrete: a
given piece of prose produces an exact, stable token stream. "This sentence
classifies these spans as these parts of speech" is a deterministic golden
fixture, not a matter of taste.

## Documentation Standard

The project-local documentation standard lives at
[`docs/DOCUMENTATION_STANDARDS.md`](docs/DOCUMENTATION_STANDARDS.md). It defines
the page types, example rules, visual accessibility requirements, writing style,
and objective/advisory checks for the corpus.

Use it for new pages and substantial edits. The existing topic/test-plan model
remains the backbone of the corpus; the standard adds reader-task routing around
that backbone rather than replacing it.

## Where Documentation Lives

Durable concepts that evolve across more than one pull request live in a topic
folder under `docs/topics/<topic>/`. The folder is the shelf for that concept,
like a chapter in a technical book.

| Path | Use it for |
| --- | --- |
| `docs/DOCUMENTATION_STANDARDS.md` | Corpus maintenance standard: page types, examples, visuals, style, and enforcement. |
| `docs/topics/<topic>/README.md` | Current behavior, invariants, public contract, supported usage. |
| `docs/topics/<topic>/test-plan.md` | Requirements, planned cases, implemented evidence, fixtures, oracles, known gaps. |
| `docs/topics/<topic>/architecture.md` | Optional structure, data flow, and module boundaries when the topic is large. |
| `docs/topics/<topic>/rationale.md` | Optional still-relevant tradeoffs and rejected alternatives. |
| `docs/design/` | Historical, proposal-era design documents. |
| `docs/goalposts/` | Delivery evidence for completed goalposts. |
| `docs/README.md` | The documentation spine and topic index. |
| `ROADMAP.md` | The release train, goalposts, and their GitHub issue anchors. |
| `CHANGELOG.md` | Release-visible changes. |

## How To Change Behavior

For a meaningful behavior change, follow this sequence:

1. Write or update a design note or rationale page if the change needs real
   design discussion.
2. Update the topic `test-plan.md` with planned cases **before** implementation.
   Each planned case should carry a stable case ID, the requirement(s) it
   covers, an explicit oracle, an evidence type, and a status.
3. Write the smallest deterministic, executable evidence that fails for the
   missing behavior.
4. Implement the behavior.
5. Update the topic `README.md` so it describes the behavior that now exists on
   `main`.
6. Mark the planned cases as implemented and record the actual test names,
   fixture paths, or doctests that are the evidence.
7. Update `CHANGELOG.md` and `ROADMAP.md` when the change is release-visible or
   shifts the project's posture.

Small fixes scale this down but keep the same shape: make the claim clear,
identify or add evidence, implement, and keep the current reference honest.

## How To Maintain The Documentation Corpus

When you create or substantially change documentation:

1. Identify the page's primary job: learn, do, look up, understand,
   troubleshoot, or contribute.
2. Use `docs/topics/<topic>/README.md` for durable current behavior and
   invariants.
3. Use `docs/topics/<topic>/test-plan.md` for requirements, planned cases,
   evidence, exact oracles, status, and known gaps.
4. Add a tutorial, how-to guide, reference page, or troubleshooting page only
   when a reader task is not served well by the topic reference.
5. Link every new durable page from `docs/README.md`.
6. Keep examples honest: runnable examples should run, illustrative examples
   should be labeled, and abridged examples should say what was omitted.
7. Separate copyable commands from expected output, and avoid shell prompts in
   copyable command blocks.
8. Place warnings before destructive, privileged, costly, or irreversible
   commands, including scope and verification guidance.
9. Give informative visuals alt text or a nearby textual equivalent, and do not
   put essential instructions only in screenshots.
10. Update `CHANGELOG.md` and `ROADMAP.md` when the documentation change reflects
    release-visible behavior or shifts project posture.

## Test Plans Are Contracts

A topic test plan is written for people and read closely in review. The prose
explains intent, edge cases, determinism obligations, fixtures, and known gaps.

Each planned or implemented case should answer:

- Which requirement does this case cover?
- What exact behavior or invariant is being checked?
- What is the oracle?
- What kind of evidence proves it?
- Is the case planned, implemented, blocked, or retired?
- If implemented, what test, fixture, or doctest is the evidence?

Good evidence asserts stable behavior: structured return values, token streams,
error kinds, canonical bytes, or stable hashes. Avoid treating implementation
details, incidental log text, or documentation prose as the oracle. Do not
regenerate golden fixtures casually — a golden change should be deliberate,
reviewable, and tied to a clear contract change.

## Architecture Expectations

The codebase is a hexagon (ports and adapters). New code should respect the
boundary:

- The domain core (`colorful-core`) stays pure: types and port traits, no I/O.
- Outside concerns (parsing, lexicon lookup, terminal output, the LSP) are
  adapters behind a port.
- Classification (`Tagger`) and structure (`Parser`) are deliberately separate
  ports. Keep them so — that separation is what makes future escalation cheap.

If a change needs a new capability, prefer adding it as a port + adapter over
threading a concrete dependency through the core.

## Commits and Pull Requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
  `fix:`, `docs:`, `refactor:`, `test:`, `chore:`…).
- Reference the slice issue a commit closes in its footer (`Closes #NN`).
- A breaking change carries a `BREAKING CHANGE:` footer and should be called out
  for a version bump.
- Keep history append-only: no force-pushes, rebases, squashes, or amends on
  shared branches.

## What Not To Do

- Do not create a second current reference for the same topic. If a concept has
  a topic folder, update that folder rather than scattering durable truth into a
  new one-off document.
- Do not update a living `README.md` to describe intended behavior before code
  and tests exist. That turns the current reference into a proposal and makes
  the docs lie on `main`.
- Do not bury durable behavior only in an issue, a pull request, or a goalpost
  note. Those are useful history, not the current contract.
- Do not leave planned or blocked test cases vague. A future maintainer should
  be able to tell what evidence would close the gap.

## Local Checks

Once crates exist, run the standard Rust gate before opening a pull request:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

For documentation changes:

```bash
markdownlint-cli2 "**/*.md"
git diff --check
```

GitHub Actions runs the same checks as the merge gate.
