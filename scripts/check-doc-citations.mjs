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
import { fileURLToPath } from "node:url";
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

const ROOT_FILE_PREFIXES = ["cargo", "license", "readme", "roadmap", "changelog", "agents", "contributing", "gitignore"];

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

// Paths this corpus writes as schematic placeholders, not real citations
function isPlaceholderPath(span) {
  return span.includes("<") || span.includes(">") || span.includes("vX.Y.Z");
}

// A `..` range between two real paths is not itself a filesystem path.
function isRangeCitation(span) {
  return span.includes("..");
}

function looksLikeCitedPath(span) {
  if (/\s/.test(span)) return false; // a shell command or prose fragment, not a bare path
  if (isPlaceholderPath(span) || isRangeCitation(span)) return false;
  
  if (span.includes("/")) {
    const firstSegment = span.split("/")[0];
    return KNOWN_ROOTS.has(firstSegment);
  }
  
  const lower = span.toLowerCase();
  if (KNOWN_ROOTS.has(span)) return true;
  if (!span.includes(".")) return false;
  for (const prefix of ROOT_FILE_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

// docs/audits/** and docs/goalposts/** are explicitly historical
function isHistoricalSnapshot(repoRootRelativePath) {
  return repoRootRelativePath.startsWith("docs/audits/") || repoRootRelativePath.startsWith("docs/goalposts/");
}

// A simple, single-level `prefix{a,b,c}suffix` brace expansion
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

function globMatch(repoRoot, pattern) {
  const segments = pattern.split("/");
  
  const matchSegment = (dir, index) => {
    if (index === segments.length) {
      return existsSync(dir);
    }
    
    const segment = segments[index];
    if (segment.includes("*")) {
      if (!existsSync(dir)) return false;
      const regex = wildcardToRegExp(segment);
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (regex.test(entry)) {
            const nextDir = join(dir, entry);
            if (matchSegment(nextDir, index + 1)) {
              return true;
            }
          }
        }
      } catch {
        return false;
      }
      return false;
    } else {
      return matchSegment(join(dir, segment), index + 1);
    }
  };
  
  return matchSegment(repoRoot, 0);
}

function pathExists(repoRoot, rawPath) {
  let cleaned = rawPath.replace(/^`|`$/g, "");
  cleaned = cleaned.replace(/[.,;:)]+$/, "");
  cleaned = cleaned.replace(/:\d+(-\d+)?$/, "");

  if (cleaned.includes("*")) {
    return globMatch(repoRoot, cleaned);
  }

  return existsSync(resolve(repoRoot, cleaned));
}

// checkFile: the one entry point both the real run and the self-test use.
function checkFile(repoRoot, mdPath) {
  const failures = [];
  const label = relative(repoRoot, mdPath) || mdPath;
  if (isHistoricalSnapshot(label)) return failures;

  const markdown = readFileSync(mdPath, "utf8");
  const lines = markdown.split("\n");
  
  const blocks = [];
  let currentBlock = null;
  
  for (const line of lines) {
    if (/^\s*[-*]\s+\*\*[^*]+\*\*/.test(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        isCase: true,
        lines: [line],
      };
    } else {
      if (currentBlock) {
        currentBlock.lines.push(line);
      } else {
        blocks.push({
          isCase: false,
          lines: [line],
        });
      }
    }
  }
  if (currentBlock) {
    blocks.push(currentBlock);
  }
  
  for (const block of blocks) {
    const blockText = block.lines.join("\n");
    if (block.isCase) {
      const isPlannedOrBlocked = /\*Status:\*\s*(planned|blocked)/i.test(blockText) || /Status:\s*(planned|blocked)/i.test(blockText);
      if (isPlannedOrBlocked) {
        continue;
      }
    }
    
    for (const span of extractInlineCodeSpans(blockText)) {
      if (!looksLikeCitedPath(span)) continue;

      for (const candidate of expandBraces(span)) {
        if (!pathExists(repoRoot, candidate)) {
          failures.push(`${label}: cited path does not exist: \`${candidate}\` (from \`${span}\`)`);
        }
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
        "- **CASE-1** — *Evidence:* `crates/colorful-ir/src/planned_nonexistent.rs`. *Status:* planned.",
        "- **CASE-2** — *Evidence:* `crates/colorful-ir/src/does_not_exist_in_impl.rs`. *Status:* implemented.",
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
    
    assert.ok(!messages.includes("planned_nonexistent.rs"), "a path in a planned case must not be flagged");
    assert.ok(messages.includes("does_not_exist_in_impl.rs"), "a broken citation in an implemented case must be flagged");

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

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
