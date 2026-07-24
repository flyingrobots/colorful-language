#!/usr/bin/env node
// Cited file-path existence checker: scans committed Markdown for inline-code
// spans that look like a repo-relative file path (the pattern this corpus's
// test plans already use everywhere, e.g. `crates/colorful-ir/src/lib.rs`)
// and fails if the cited path does not exist. Deterministic and offline --
// no network calls, no attempt to verify a cited symbol/test *name* inside a
// file (that's a known gap; see docs/DOCUMENTATION_STANDARDS.md).
//
// Run: node scripts/check-doc-citations.mjs
// Self-test: node scripts/check-doc-citations.mjs --self-test

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  ".obsidian",
  ".continuum",
  ".graft",
]);

// Top-level directories (or dotfiles) this repo actually cites paths under.
// An inline-code span with a leading segment outside this set is assumed to
// be something else entirely (a crate name, a flag, a hash) and is not
// treated as a citation.
const KNOWN_ROOTS = new Set([
  "crates",
  "scripts",
  "docs",
  "contracts",
  "consumers",
  "editors",
  "witness",
  ".github",
  ".continuum",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "ROADMAP.md",
]);

function findMarkdownFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const stat = entry.isSymbolicLink() ? null : entry;
      if (stat?.isDirectory()) {
        walk(full);
      } else if (stat?.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;

function extractInlineCodeSpans(markdown) {
  const spans = [];
  let match;
  while ((match = INLINE_CODE_PATTERN.exec(markdown)) !== null) {
    spans.push(match[1]);
  }
  return spans;
}

// Paths this corpus writes as schematic placeholders, not real citations:
// `<topic>`/`<workflow>`/`<tag>` template segments, and the literal
// `vX.Y.Z` version placeholder used throughout release docs.
function isPlaceholderPath(span) {
  return span.includes("<") || span.includes(">") || span.includes("vX.Y.Z");
}

// A `..` range between two real paths (e.g. `docs/goalposts/v0.1.0..v0.3.0`)
// is not itself a filesystem path.
function isRangeCitation(span) {
  return span.includes("..");
}

function looksLikeCitedPath(span) {
  if (/\s/.test(span)) return false; // a shell command or prose fragment, not a bare path
  if (isPlaceholderPath(span) || isRangeCitation(span)) return false;
  if (!span.includes("/") && !KNOWN_ROOTS.has(span)) return false;
  const firstSegment = span.split("/")[0];
  return KNOWN_ROOTS.has(firstSegment);
}

// docs/audits/** and docs/goalposts/** are explicitly historical, point-in-
// time snapshots (docs/README.md: "historical snapshots, not living
// references"). A citation there -- an old branch name that happens to look
// like a path, a line number from when the snapshot was taken -- is not
// held to the same "must still resolve today" bar a living topic/workflow
// reference is.
function isHistoricalSnapshot(repoRootRelativePath) {
  return repoRootRelativePath.startsWith("docs/audits/") || repoRootRelativePath.startsWith("docs/goalposts/");
}

// A simple, single-level `prefix{a,b,c}suffix` brace expansion -- the only
// shape this corpus's docs actually use (e.g.
// `crates/colorful-ir/{src/generated,ts}/`). Returns [span] unchanged if
// there's no brace group.
function expandBraces(span) {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(span);
  if (!match) return [span];
  const [, prefix, options, suffix] = match;
  return options.split(",").map((opt) => `${prefix}${opt}${suffix}`);
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function pathExists(repoRoot, rawPath) {
  let cleaned = rawPath.replace(/^`|`$/g, "");
  cleaned = cleaned.replace(/[.,;:)]+$/, "");
  // A trailing `:123` or `:123-130` line reference, e.g.
  // `crates/colorful-cli/src/lib.rs:124-130` -- check the file, not a
  // literal path ending in a colon and digits.
  cleaned = cleaned.replace(/:\d+(-\d+)?$/, "");

  if (cleaned.includes("*")) {
    const segments = cleaned.split("/");
    const wildcardIndex = segments.findIndex((segment) => segment.includes("*"));
    if (wildcardIndex === -1) return existsSync(resolve(repoRoot, cleaned));

    if (wildcardIndex === segments.length - 1) {
      // The wildcard is the final segment: check the parent directory
      // exists and at least one entry matches the pattern.
      const dir = segments.slice(0, -1).join("/") || ".";
      const resolvedDir = resolve(repoRoot, dir);
      if (!existsSync(resolvedDir)) return false;
      const regex = wildcardToRegExp(segments[wildcardIndex]);
      return readdirSync(resolvedDir).some((entry) => regex.test(entry));
    }

    // The wildcard is a middle segment (e.g. `docs/goalposts/*/verification.md`):
    // multi-segment glob matching isn't worth the complexity here, so just
    // confirm the concrete prefix directory before the wildcard exists.
    const prefix = segments.slice(0, wildcardIndex).join("/");
    return existsSync(resolve(repoRoot, prefix));
  }

  return existsSync(resolve(repoRoot, cleaned));
}

// checkFile: the one entry point both the real run and the self-test use.
function checkFile(repoRoot, mdPath) {
  const failures = [];
  const label = relative(repoRoot, mdPath) || mdPath;
  if (isHistoricalSnapshot(label)) return failures;

  const markdown = readFileSync(mdPath, "utf8");

  for (const span of extractInlineCodeSpans(markdown)) {
    if (!looksLikeCitedPath(span)) continue;

    for (const candidate of expandBraces(span)) {
      if (!pathExists(repoRoot, candidate)) {
        failures.push(`${label}: cited path does not exist: \`${candidate}\` (from \`${span}\`)`);
      }
    }
  }

  return failures;
}

function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "colorful-citation-check-"));
  try {
    mkdirSync(join(dir, "crates", "colorful-ir", "src", "generated"), { recursive: true });
    mkdirSync(join(dir, "crates", "colorful-ir", "ts"), { recursive: true });
    writeFileSync(join(dir, "crates", "colorful-ir", "src", "lib.rs"), "// real file\n");
    writeFileSync(join(dir, "crates", "colorful-ir", "src", "generated", "syntax_v1.rs"), "// generated\n");

    const docPath = join(dir, "topic.md");
    writeFileSync(
      docPath,
      [
        "# Topic",
        "",
        "See `crates/colorful-ir/src/lib.rs` for the real implementation.",
        "Generated types live in `crates/colorful-ir/{src/generated,ts}/`.",
        "A glob citation: `crates/colorful-ir/src/generated/*.rs`.",
        "A broken citation: `crates/colorful-ir/src/does_not_exist.rs`.",
        "Not a path at all: `colorful-core`, `--version`, `cargo test -p colorful-ir`.",
        "",
      ].join("\n"),
    );

    const failures = checkFile(dir, docPath);
    const messages = failures.join("\n");

    assert.ok(!messages.includes("src/lib.rs"), "an existing plain path must not be flagged");
    assert.ok(!messages.includes("{src/generated,ts}"), "a valid brace-expanded citation must not be flagged");
    assert.ok(!messages.includes("generated/*.rs"), "a valid glob citation must not be flagged");
    assert.ok(messages.includes("does_not_exist.rs"), "a broken citation must be flagged");
    assert.ok(!messages.includes("colorful-core"), "a bare crate name (no slash, unknown root) must not be flagged");
    assert.ok(!messages.includes("--version"), "a CLI flag must not be flagged");
    assert.ok(!messages.includes("cargo test"), "a shell command must not be flagged");

    console.log("check-doc-citations: self-test passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const files = findMarkdownFiles(repoRoot);
  const failures = files.flatMap((f) => checkFile(repoRoot, f));

  if (failures.length > 0) {
    console.error(`check-doc-citations: ${failures.length} cited path(s) that do not exist:\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log(`check-doc-citations: ${files.length} Markdown file(s) checked, every cited path exists.`);
}

main();
