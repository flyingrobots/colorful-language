#!/usr/bin/env node
// Deterministic, offline internal-link checker: walks every committed
// Markdown file, resolves relative links and explicit anchors against the
// real filesystem/headings, and fails on anything broken. Makes no network
// calls -- external links (http(s):, mailto:, tel:) are out of scope here
// and stay advisory (docs/DOCUMENTATION_STANDARDS.md §8), since network
// instability must never block a merge.
//
// Run: node scripts/check-internal-links.mjs
// Self-test: node scripts/check-internal-links.mjs --self-test

import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, isAbsolute } from "node:path";
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

function findMarkdownFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

// Unicode-aware GitHub-compatible heading slug
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function headingSlugsIn(markdown) {
  const slugs = new Set();
  const seen = new Map();
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const base = slugify(match[2]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

function stripCodeRegions(markdown) {
  // Strip fenced code blocks: ```...```
  let cleaned = markdown.replace(/```[\s\S]*?```/g, "");
  // Strip inline code spans: `...`
  cleaned = cleaned.replace(/`[^`\n]+`/g, "");
  return cleaned;
}

function extractLinks(markdown) {
  const links = [];
  const cleaned = stripCodeRegions(markdown);

  // Match inline links: [label](url)
  const inlinePattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = inlinePattern.exec(cleaned)) !== null) {
    links.push(match[1].trim());
  }

  // Match reference link definitions: [label]: url
  const refPattern = /^\[[^\]]+\]:\s*(\S+)/gm;
  while ((match = refPattern.exec(cleaned)) !== null) {
    links.push(match[1].trim());
  }

  return links;
}

function isExternal(target) {
  return /^([a-z][a-z0-9+.-]*:)/i.test(target) && !/^[a-z]:\\/i.test(target);
}

// checkFile: the one entry point both the real run and the self-test use.
function checkFile(repoRoot, mdPath) {
  const failures = [];
  const markdown = readFileSync(mdPath, "utf8");
  const fileDir = dirname(mdPath);
  const label = relative(repoRoot, mdPath) || mdPath;

  for (const rawTarget of extractLinks(markdown)) {
    if (isExternal(rawTarget)) continue; // out of scope; advisory elsewhere

    const [pathPart, ...anchorParts] = rawTarget.split("#");
    const anchor = anchorParts.length > 0 ? anchorParts.join("#") : null;

    if (pathPart === "") {
      // A same-file anchor, e.g. "#usage".
      if (anchor !== null && !headingSlugsIn(markdown).has(anchor)) {
        failures.push(`${label}: dangling same-file anchor "#${anchor}"`);
      }
      continue;
    }

    const resolved = resolve(fileDir, pathPart);
    
    // Check for link escaping the repository root
    const rel = relative(repoRoot, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      failures.push(`${label}: link escaping repository root: "${pathPart}"`);
      continue;
    }

    let stats;
    try {
      stats = statSync(resolved);
    } catch {
      failures.push(`${label}: broken link to "${pathPart}" (resolved: ${relative(repoRoot, resolved)})`);
      continue;
    }

    if (anchor !== null) {
      if (stats.isDirectory()) {
        failures.push(`${label}: anchor "#${anchor}" on a directory link "${pathPart}" is not checkable`);
        continue;
      }
      
      const isMarkdown = resolved.endsWith(".md");
      if (isMarkdown) {
        const targetMarkdown = readFileSync(resolved, "utf8");
        if (!headingSlugsIn(targetMarkdown).has(anchor)) {
          failures.push(`${label}: dangling anchor "#${anchor}" in "${pathPart}"`);
        }
      } else {
        // Line number validation for source/non-Markdown files
        const lineMatch = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
        if (!lineMatch) {
          failures.push(`${label}: invalid line anchor "#${anchor}" on non-Markdown file "${pathPart}"`);
          continue;
        }
        
        const fileContent = readFileSync(resolved, "utf8");
        const totalLines = fileContent.split("\n").length;
        const startLine = parseInt(lineMatch[1], 10);
        const endLine = lineMatch[2] ? parseInt(lineMatch[2], 10) : startLine;
        
        if (startLine < 1 || startLine > totalLines || endLine < startLine || endLine > totalLines) {
          failures.push(`${label}: line anchor "#${anchor}" out of bounds (file has ${totalLines} lines) for "${pathPart}"`);
        }
      }
    }
  }

  return failures;
}

function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "colorful-link-check-"));
  try {
    mkdirSync(join(dir, "docs", "topics", "widgets"), { recursive: true });

    writeFileSync(
      join(dir, "docs", "topics", "widgets", "README.md"),
      "# Widgets\n\n## Usage\n\nSome content.\n\n## Über-topic\n\nUnicode heading.\n",
    );

    writeFileSync(
      join(dir, "docs", "main.rs"),
      "fn main() {\n  println!(\"Hello\");\n}\n",
    );

    writeFileSync(
      join(dir, "docs", "README.md"),
      [
        "# Spine",
        "",
        "[widgets](topics/widgets/README.md)",
        "[widgets usage](topics/widgets/README.md#usage)",
        "[unicode anchor](topics/widgets/README.md#über-topic)",
        "[broken file](topics/does-not-exist.md)",
        "[broken anchor](topics/widgets/README.md#does-not-exist)",
        "[external](https://example.com/whatever)",
        "[same-file anchor](#spine)",
        "[broken same-file anchor](#nope)",
        "[escaping root](../../../../etc/passwd)",
        "[valid line](main.rs#L2)",
        "[invalid line](main.rs#L10)",
        "[invalid format](main.rs#foo)",
        "",
      ].join("\n"),
    );

    const failures = checkFile(dir, join(dir, "docs", "README.md"));

    // Verify specific failures are present:
    assert.ok(failures.some(f => f.includes("broken link to \"topics/does-not-exist.md\"")), "broken file link must be flagged");
    assert.ok(failures.some(f => f.includes("dangling anchor \"#does-not-exist\"")), "broken anchor must be flagged");
    assert.ok(failures.some(f => f.includes("dangling same-file anchor \"#nope\"")), "broken same-file anchor must be flagged");
    assert.ok(failures.some(f => f.includes("link escaping repository root")), "escaped link must be flagged");
    assert.ok(failures.some(f => f.includes("line anchor \"#L10\" out of bounds")), "out-of-bounds line anchor must be flagged");
    assert.ok(failures.some(f => f.includes("invalid line anchor \"#foo\"")), "invalid anchor format must be flagged");

    // Verify valid links are NOT flagged:
    assert.ok(!failures.some(f => f.includes("topics/widgets/README.md") && !f.includes("does-not-exist")), "valid widgets links must not be flagged");
    assert.ok(!failures.some(f => f.includes("example.com")), "external links must not be flagged");
    assert.ok(!failures.some(f => f.includes("#spine")), "valid same-file anchor must not be flagged");
    assert.ok(!failures.some(f => f.includes("main.rs") && f.includes("L2") && !f.includes("L10")), "valid line anchor must not be flagged");

    console.log("check-internal-links: self-test passed");
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
    console.error(`check-internal-links: ${failures.length} broken internal link(s)/anchor(s):\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log(`check-internal-links: ${files.length} Markdown file(s) checked, no broken internal links.`);
}

main();
