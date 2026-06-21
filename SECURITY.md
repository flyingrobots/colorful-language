# Security Policy

## Supported Versions

`colorful-language` is pre-1.0 and under active development. Security fixes are
applied to the `main` branch and the most recent tagged release. Until a 1.0
line exists, only `main` is guaranteed to receive fixes.

## Reporting a Vulnerability

Please report suspected vulnerabilities **privately**, not in a public issue.

- Preferred: open a private advisory via GitHub
  ([Security → Report a vulnerability](https://github.com/flyingrobots/colorful-language/security/advisories/new)).
- We aim to acknowledge a report within 7 days and to provide a remediation
  timeline once the issue is confirmed.

When reporting, please include the affected component (e.g. `colorful-parse`,
`colorful-lsp`), a minimal reproduction, and the impact you observed.

## Scope Notes

This project parses and classifies untrusted text. Reports that are especially
welcome:

- Inputs that cause the parser or lexer to panic, hang, or consume unbounded
  memory (e.g. pathological prose that defeats the parser's termination
  guarantees).
- LSP messages that crash or wedge the server process.

Such issues are treated as security-relevant because the tooling runs inside a
developer's editor on documents from arbitrary sources.
