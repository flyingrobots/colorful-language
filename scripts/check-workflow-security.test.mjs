#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const script = resolve("scripts/check-workflow-security.mjs");
const safeFixture = resolve("scripts", "fixtures", "workflow-security", "safe");

function trackedWorkflowCount() {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      ".github/workflows/*.yml",
      ".github/workflows/*.yaml",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const paths = result.stdout.split("\0").filter(Boolean);
  assert.ok(paths.length > 0);
  return paths.length;
}

function runFixture(name) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--root",
      resolve("scripts", "fixtures", "workflow-security", name),
    ],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
}

test("accepts a workflow with read-only permissions and ephemeral checkout credentials", () => {
  const result = runFixture("safe");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    "check-workflow-security: 1 workflow passed zizmor 1.28.0\n",
  );
});

test("rejects persisted checkout credentials with a stable category", () => {
  const result = runFixture("unsafe-artipacked");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^E_WORKFLOW_SECURITY_FINDING: artipacked: scripts\/fixtures\/workflow-security\/unsafe-artipacked\/\.github\/workflows\/unsafe\.yml:/u,
  );
});

test("rejects overbroad workflow permissions with a stable category", () => {
  const result = runFixture("unsafe-permissions");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^E_WORKFLOW_SECURITY_FINDING: excessive-permissions: scripts\/fixtures\/workflow-security\/unsafe-permissions\/\.github\/workflows\/unsafe\.yml:/u,
  );
});

test("rejects a hung analyzer with a stable timeout diagnostic", () => {
  const directory = mkdtempSync(join(tmpdir(), "colorful-hung-zizmor-"));
  const binary = join(directory, "zizmor");
  writeFileSync(
    binary,
    `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  process.stdout.write("zizmor 1.28.0\\n");
} else {
  setInterval(() => {}, 1_000);
}
`,
    { mode: 0o755 },
  );

  try {
    const source = `
import { auditWorkflows } from ${JSON.stringify(pathToFileURL(script).href)};
try {
  auditWorkflows({
    root: ${JSON.stringify(safeFixture)},
    binary: ${JSON.stringify(binary)},
    timeoutMs: 1_000,
  });
} catch (error) {
  process.stderr.write(\`\${error.code}: \${error.message}\\n\`);
  process.exitCode = 1;
}
`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^E_WORKFLOW_SECURITY_ANALYZER: .* timed out after 1000 ms\n$/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the repository passes the pinned workflow-security analysis", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    `check-workflow-security: ${trackedWorkflowCount()} workflows passed zizmor 1.28.0\n`,
  );
});
