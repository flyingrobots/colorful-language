import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const TRANSIENT_CODES = new Set(["EBUSY", "ENOENT", "EPERM"]);
const DEFAULT_FILESYSTEM = { readFileSync, readdirSync, statSync };

function tolerateTransient(operation) {
  try {
    return operation();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      TRANSIENT_CODES.has(error.code)
    ) {
      return undefined;
    }
    throw error;
  }
}

export function textFiles(directory, filesystem = DEFAULT_FILESYSTEM) {
  const files = [];
  const visit = (current) => {
    const entries = tolerateTransient(() =>
      filesystem.readdirSync(current, { withFileTypes: true }),
    );
    if (entries === undefined) {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && /\.(?:log|txt)$/u.test(entry.name)) {
        const status = tolerateTransient(() => filesystem.statSync(absolute));
        if (status !== undefined && status.size <= 5 * 1024 * 1024) {
          files.push(absolute);
        }
      }
    }
  };
  visit(directory);
  return files;
}

export function readTextFile(filename, filesystem = DEFAULT_FILESYSTEM) {
  return tolerateTransient(() => filesystem.readFileSync(filename, "utf8"));
}
