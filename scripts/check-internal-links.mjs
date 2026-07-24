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

// GitHub-style heading slug: lowercase, strip characters that aren't a
// letter/number/space/hyphen, spaces to hyphens. Duplicate slugs get
// -1, -2, ... suffixes for the 2nd, 3rd, ... occurrence.
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
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

const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g;

function extractLinks(markdown) {
  const links = [];
  let match;
  while ((match = LINK_PATTERN.exec(markdown)) !== null) {
    links.push(match[2].trim());
  }
  return links;
}

function isExternal(target) {
  return /^([a-z][a-z0-9+.-]*:)/i.test(target) && !/^[a-z]:\\/i.test(target);
}

// checkFile: the one entry point both the real run and the self-test use --
// no separate "test mode" logic to drift from what actually runs.
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
      const targetMarkdown = readFileSync(resolved, "utf8");
      if (!headingSlugsIn(targetMarkdown).has(anchor)) {
        failures.push(`${label}: dangling anchor "#${anchor}" in "${pathPart}"`);
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
      "# Widgets\n\n## Usage\n\nSome content.\n",
    );

    writeFileSync(
      join(dir, "docs", "README.md"),
      [
        "# Spine",
        "",
        "[widgets](topics/widgets/README.md)",
        "[widgets usage](topics/widgets/README.md#usage)",
        "[broken file](topics/does-not-exist.md)",
        "[broken anchor](topics/widgets/README.md#does-not-exist)",
        "[external](https://example.com/whatever)",
        "[same-file anchor](#spine)",
        "[broken same-file anchor](#nope)",
        "",
      ].join("\n"),
    );

    const failures = checkFile(dir, join(dir, "docs", "README.md"));
    const messages = failures.join("\n");

    assert.ok(!messages.includes("widgets/README.md)"), "a valid file link must not be flagged");
    assert.ok(messages.includes('broken link to "topics/does-not-exist.md"'), "a broken file link must be flagged");
    assert.ok(
      messages.includes('dangling anchor "#does-not-exist"'),
      "a broken anchor on an existing file must be flagged",
    );
    assert.ok(!messages.includes("#usage"), "a valid anchor must not be flagged");
    assert.ok(!messages.includes("example.com"), "an external link must never be checked/flagged");
    assert.ok(
      messages.includes('dangling same-file anchor "#nope"'),
      "a broken same-file anchor must be flagged",
    );
    assert.ok(!messages.includes('"#spine"'), "a valid same-file anchor must not be flagged");

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

  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
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
