# Documentation Standards

**Status:** Current project policy for new and substantially changed
documentation.
**Applies to:** User, editor, CLI, LSP, IR, release, and contributor
documentation in `colorful-language`.
**Normative terms:** **MUST**, **SHOULD**, and **MAY** indicate requirement
strength.

This standard adapts the reader-task documentation standard to Colorful's
existing contract-graph discipline. It does not require a mass rewrite of
existing pages. Apply it when creating documentation, changing behavior, or
touching a page enough that leaving it below this bar would create new debt.

## 1. Purpose

Documentation is part of the product contract. A Colorful page should help a
specific reader do one of these jobs:

- learn the product through a guided first success;
- complete a real task in their own environment;
- look up exact facts while working;
- understand a concept, boundary, or design choice;
- troubleshoot an observable failure;
- change the implementation safely and verify the result.

A page MUST have one primary job. Do not force a README, topic page, or release
packet to behave as a tutorial, reference manual, roadmap, and architecture
guide at the same time.

## 2. Corpus map

Colorful keeps its durable truth in a small set of known places.

| Location | Job |
| --- | --- |
| `README.md` | Public front door: what Colorful is, how to try it, install paths, current project status, and links to deeper docs. |
| `docs/README.md` | Documentation spine and routing index. Add new durable pages here. |
| `docs/topics/<topic>/README.md` | Living reference for current behavior on `main`. |
| `docs/topics/<topic>/test-plan.md` | Requirements, planned and implemented cases, exact oracles, evidence, and known gaps. |
| `docs/topics/<topic>/architecture.md` | Optional current architecture for larger topics. |
| `docs/topics/<topic>/rationale.md` | Optional still-relevant tradeoffs and rejected alternatives. |
| `docs/design/` | Historical proposal-era design records. They explain why; they do not pose as current truth. |
| `docs/goalposts/` | Release packets and verification witnesses. |
| `docs/RELEASING.md` | Release runbook and pre-tag checklist. |
| `editors/` | Current editor-integration instructions and source-extension notes. |
| `ROADMAP.md` | Release train and milestone/issue anchors. |
| `CHANGELOG.md` | Release-visible historical ledger. |

The current topic/test-plan model stays authoritative. Add tutorials, how-to
guides, reference pages, or troubleshooting pages when a reader need is not well
served by a topic reference.

Recommended additions as the docs grow:

```text
docs/
  tutorials/
  how-to/
  reference/
  troubleshooting/
```

Do not create empty placeholder directories. Add each page when it has a real
reader job.

## 3. Page types

### 3.1 Topic reference

A topic reference describes current behavior for a durable concept such as
parsing, lexicon lookup, coloring, linting, or IR.

A topic reference MUST:

- describe only behavior that exists on `main`;
- state public contracts, invariants, and supported usage;
- link to its test plan;
- distinguish current behavior from known gaps;
- avoid roadmap promises except as explicitly labeled limitations or links.

It MUST NOT become the only user-facing guide for a workflow that needs
step-by-step help.

### 3.2 Test plan

A topic test plan is the contract ledger for behavior. It MUST identify:

- stable requirement IDs;
- planned or implemented cases;
- the exact behavior or invariant under test;
- the oracle;
- the evidence type;
- the status;
- the concrete test, fixture, script, or doctest when implemented.

Planned work is not evidence. A gap should be marked as a gap and tied to active
ownership or tracking when it matters.

### 3.3 Tutorial

A tutorial is a guided learning path. Use it when a newcomer needs a controlled
first success, such as "color your first file" or "lint prose in an editor."

A tutorial MUST:

- state prerequisites and starting state;
- use a known-good path;
- provide actions in tested order;
- show expected intermediate and final results;
- end with what the reader learned and where to go next.

### 3.4 How-to guide

A how-to guide helps a competent reader complete a real task, such as
"configure Colorful in Neovim" or "run `colorful lint` in CI."

A how-to guide MUST:

- be titled as a goal, preferably starting with a verb;
- state the expected result;
- identify blocking prerequisites;
- give the shortest safe route to the result;
- include exact commands, settings, controls, or API calls;
- explain how to verify success;
- link to reference or explanation instead of reproducing it.

### 3.5 Reference

Reference pages support exact lookup. Add or generate them for public surfaces:

- CLI commands and options;
- `colorful-lsp` behavior, settings, semantic-token legend, and diagnostics;
- IR contracts and validation errors;
- editor extension settings;
- exit statuses and error identifiers.

Reference MUST state exact names, syntax, fields, defaults, constraints,
compatibility behavior, output, errors, and examples. When the underlying
surface is machine-readable, the reference SHOULD be generated or coverage
checked.

### 3.6 Explanation

Explanation develops a mental model: why Colorful uses closed-class words, why
core ports stay separate, why IR is a wire boundary, or why lint rules are
shallow and deterministic.

Explanation SHOULD describe mechanisms, relationships, tradeoffs, alternatives,
and limits. It MUST NOT become an unstructured code tour.

### 3.7 Troubleshooting

Troubleshooting starts with a symptom a user or operator can observe, such as:

- no color appears in the terminal;
- the editor does not start `colorful-lsp`;
- semantic tokens appear but lint diagnostics do not;
- `colorful lint` exits non-zero in CI;
- IR validation rejects a document.

A troubleshooting page MUST list discriminating checks first, map signals to
likely causes, give concrete recovery actions, and show how to verify the fix.

### 3.8 Contributor guide

Contributor docs explain how to change the implementation safely. They SHOULD
explain the system model before listing files. Source links support an
explanation; they do not replace one.

## 4. Maintenance loop

For a meaningful behavior change:

1. Update or add design/rationale only if the change needs design discussion.
2. Update the relevant `docs/topics/<topic>/test-plan.md` before implementation.
3. Add the smallest deterministic executable evidence that fails for the missing
   behavior.
4. Implement the behavior.
5. Update the living topic reference after the behavior exists.
6. Mark planned cases implemented and record the actual evidence.
7. Update `README.md`, `docs/README.md`, `CHANGELOG.md`, and `ROADMAP.md` when
   the public surface, documentation routing, release status, or project posture
   changes.

Small fixes may scale this down, but they still need a clear claim, evidence
when behavior changes, and honest current truth.

## 5. Examples and executable truth

Examples are part of the contract.

User-facing examples MUST:

- be syntactically valid;
- use supported behavior;
- include enough context to run or interpret them;
- use least-privileged and safe defaults;
- identify destructive or privileged actions clearly;
- show an observable result when one exists.

Examples SHOULD be extracted from tested files or executed in CI when practical.

### 5.1 Runnable, illustrative, and abridged examples

A runnable example uses supported behavior and includes required context. Test
or execute it automatically when practical.

An illustrative example may omit setup or nonessential detail, but it MUST be
labeled as illustrative and MUST NOT be presented as directly runnable.

An abridged example may shorten large input or output, but it MUST identify the
omitted material and preserve the behavior relevant to the explanation.

### 5.2 Code blocks and terminal examples

Every fenced block SHOULD declare its language or content type where supported:

- `bash` or `sh` for copyable shell commands;
- `json`, `yaml`, `toml`, `rust`, `typescript`, or the relevant language for
  structured input;
- `text` for expected output;
- `console` only for a transcript that deliberately includes prompts and output.

Do not include `$` or `>` prompts in a block intended for copy and paste.
Present commands and output separately.

Run:

```bash
colorful lint sample.txt
```

Expected output:

```text
sample.txt:1:1: info [weak-word]: weak word 'really'
```

When output is nondeterministic, say which parts vary. Label output as exact,
representative, or abridged when that distinction matters. Never fabricate
output merely to make an example look complete.

### 5.3 Placeholders

Use clearly fictional and context-safe values.

| Context | Preferred placeholder |
| --- | --- |
| Copyable shell command | `sample.txt`, `example-target`, or `$COLORFUL_FILE` |
| Configuration value | `"colorful-lsp"` or `"sample.txt"` |
| Hostname | `example.com` |
| Formal syntax notation | `<file>` |
| Secret or credential | an explicitly fake token such as `test_token_example` |

Do not use `<your-file>` inside a copyable shell command because angle brackets
have shell meaning.

### 5.4 Dangerous commands

For destructive, privileged, costly, or irreversible actions:

1. Place the warning before the command.
2. State the exact consequence and scope.
3. Provide a dry-run or safer alternative when available.
4. State required permissions.
5. Include backup or rollback guidance when applicable.
6. Explain how to verify the result.

## 6. Visuals and accessibility

Visual products must be shown visually. User-facing documentation for the CLI,
LSP, editor extensions, or diagnostics SHOULD include enough visual material for
a reader to recognize the interface and important states.

Use screenshots, terminal captures, annotated examples, or short recordings when
they answer a reader question. Do not add diagrams or screenshots as ornaments.

Every nontrivial visual MUST:

- answer a stated or obvious reader question;
- have meaningful labels or adjacent explanation;
- include alt text or a concise textual equivalent where the publishing system
  supports it;
- distinguish conceptual simplification from exact implementation when needed;
- omit or redact secrets, personal data, production identifiers, and sensitive
  operational details.

Informative images MUST have alt text or a textual equivalent. Decorative images
SHOULD have empty alt text where supported. Complex diagrams SHOULD have
adjacent explanatory prose instead of relying on a long alt attribute.

Visuals MUST NOT rely on color, position, animation, or shape alone to
communicate essential meaning. Use labels, patterns, icons, or text where the
distinction matters.

Screenshots and recordings MUST NOT be the only place where essential
instructions, code, or error details appear.

## 7. Writing, style, and terminology

Write like a competent teammate: direct, precise, and approachable.

- Use `you` for actions the reader performs.
- Use `colorful`, `colorful-lsp`, the command, editor, or component name for
  actions the system performs.
- Use imperative verbs for procedures.
- Prefer active voice when it clarifies who is responsible.
- Use passive voice when the actor is unknown, irrelevant, or less important
  than the result.
- Use present tense for current behavior.
- Avoid hype, marketing claims, vague reassurance, unnecessary apology, and
  excessive exclamation.
- Avoid `we` unless referring to an explicit project decision or policy.

Prefer:

> Run `colorful lint sample.txt`. The command exits with status `1` when it
> reports findings.

Avoid:

> You may encounter an issue if your prose is not quite right.

### 7.1 Sentences, paragraphs, and lists

Write for comprehension, not for a readability score.

- Put the result, decision, warning, or essential condition first.
- Give each sentence one main job.
- Keep sentences short enough to understand in one pass, but do not enforce a
  universal word limit.
- Keep each paragraph focused on one coherent idea.
- Use numbered lists for ordered procedures.
- Use bullets for parallel options, requirements, or checks.
- Use prose when relationships, causality, or tradeoffs matter.

Sentence length, paragraph length, passive voice, jargon density, and bullet
count are editorial signals. They MUST NOT become universal merge gates.

### 7.2 Markdown and typography

Use formatting to communicate type, not to manufacture emphasis.

- Use bold for exact visible UI labels such as buttons, menu items, tabs, and
  panel names.
- Use bold sparingly for warnings or genuine emphasis.
- Do not bold every concept on first mention.
- Use inline code for commands, options, filenames, paths, configuration keys,
  field names, literal values, error identifiers, and code symbols.
- Use exact casing for product labels, commands, options, fields, and errors.
- Use `<kbd>` for keyboard keys when the publishing system renders it
  accessibly; otherwise use inline code.
- Use descriptive link text that states what the destination provides.
- Do not use `here`, `this link`, or a bare filename as the entire link label.

Use tables for genuinely two-dimensional lookup, comparison, or structured
facts. Do not use them for long narrative passages or multi-step procedures.

### 7.3 Terminology

Use one canonical term for each concept. Define unfamiliar terms at first use.
Mention a common alias once when it materially improves search or recognition.

Shared Colorful vocabulary belongs in topic references or a future
`docs/glossary.md`. A glossary is a lookup aid, not a prerequisite for
understanding a page.

Use exact names consistently:

- `Parser`, `Lexicon`, `Annotator`, and `Analyzer` are separate ports.
- `colorful` is the CLI binary.
- `colorful-lsp` is the language server binary.
- `colorful.syntax/v1` and `colorful.vocabulary/v1` are versioned contracts.
- `Finding`, `Rule`, and rule codes such as `weak-word` are diagnostic terms.

### 7.4 Inclusive and accessible language

Use literal, neutral language that describes the technical condition directly.

- Use gender-neutral language when a person's gender is irrelevant.
- Avoid identity-based or stigmatizing metaphors.
- Prefer terms such as unavailable, hidden, degraded, unresponsive, excluded, or
  blocked when those are the actual conditions.
- Avoid culturally specific idioms when they make instructions harder to
  understand or translate.

### 7.5 Notes, cautions, and warnings

Use callouts consistently:

- Note — useful context that does not affect safety or correctness.
- Important — information required to complete the task correctly.
- Caution — an action may cause an undesirable or costly result.
- Warning — an action may cause data loss, a security problem, or an
  irreversible change.

Do not use a warning merely to make ordinary text look important.

## 8. Checks and enforcement

Documentation quality requires both deterministic checks and human judgment.

Run the repository documentation gate for documentation changes:

```bash
markdownlint-cli2 "**/*.md"
git diff --check "$(git hash-object -t tree /dev/null)" HEAD
```

When workflows change, also run:

```bash
actionlint .github/workflows/*.yml
```

CI SHOULD block on facts it can determine reliably:

- malformed Markdown;
- broken internal links and explicit anchors once link checking is available;
- failed examples or tutorials declared executable;
- stale generated reference;
- undocumented public commands, options, settings, fields, statuses, or errors
  when coverage is required;
- invalid diagrams present in changed pages;
- informative images without alt text or a registered textual equivalent;
- changed contract behavior without updated evidence or an approved
  `docs-impact: none` declaration;
- references to files, symbols, tests, schemas, or workflows that do not exist;
- destructive examples without a preceding warning marker;
- copied examples containing known real credentials or forbidden production
  identifiers.

The following SHOULD normally be advisory:

- page length;
- sentence length;
- paragraph length;
- passive voice;
- jargon density;
- number of bullets;
- suspected missing diagrams;
- tone and template-like phrasing;
- overuse of bold;
- table complexity;
- external-link health;
- screenshot age.

These signals are useful for editors. They are poor universal merge gates.

## 9. Review checklist

Before calling a documentation change done, check:

- The page has one primary reader job.
- Living references describe current `main` behavior only.
- Planned work lives in a test plan, roadmap, issue, design note, or PR.
- Examples use supported behavior and show observable results when possible.
- Public commands, options, settings, fields, statuses, and errors have or link
  to reference coverage.
- User-facing UI/editor behavior has a screenshot, terminal capture, or textual
  equivalent when visuals materially help.
- New durable pages are linked from `docs/README.md`.
- Release-visible changes update `CHANGELOG.md` and `ROADMAP.md`.
- Markdown and diff checks pass.

The objective is not a perfectly uniform library. The objective is a
documentation corpus where readers, reviewers, tests, and agents can find the
right authoritative page at the moment they need it.
