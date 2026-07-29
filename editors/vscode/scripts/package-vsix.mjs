#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const editorRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(editorRoot, "../..");
const requireFromScript = createRequire(import.meta.url);
const vsceManifestPath = requireFromScript.resolve(
  "@vscode/vsce/package.json",
);
const vsceManifest = requireFromScript("@vscode/vsce/package.json");
const vsceRelativePath =
  typeof vsceManifest.bin === "string"
    ? vsceManifest.bin
    : vsceManifest.bin?.vsce;
if (typeof vsceRelativePath !== "string" || vsceRelativePath.length === 0) {
  throw new Error("@vscode/vsce does not declare its 'vsce' binary");
}
const vscePath = path.resolve(
  path.dirname(vsceManifestPath),
  vsceRelativePath,
);

function run(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}\n` +
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

const commitEpoch = run(
  "git",
  ["show", "-s", "--format=%ct", "HEAD"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
  },
).stdout.trim();
if (!/^[1-9]\d*$/u.test(commitEpoch)) {
  throw new Error(
    `git HEAD did not provide a valid SOURCE_DATE_EPOCH: ${JSON.stringify(commitEpoch)}`,
  );
}

run(
  process.execPath,
  [
    vscePath,
    "package",
    "--no-yarn",
    "--no-dependencies",
    ...process.argv.slice(2),
  ],
  {
    cwd: editorRoot,
    env: { ...process.env, SOURCE_DATE_EPOCH: commitEpoch },
    stdio: "inherit",
  },
);
