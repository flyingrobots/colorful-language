import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIVE_ISSUE_LIMIT = 10_000;
export const GITHUB_CALL_BOUNDS = Object.freeze({
  timeout: 30_000,
  maxBuffer: 16 * 1024 * 1024,
});

export function createRoadmapInventoryRun({
  InventoryError,
  closingIssueNumbersForRepository,
  parseRoadmapInventory,
  validateRoadmapInventory,
}) {
  const fail = (category, location, detail) => {
    throw new InventoryError(category, location, detail);
  };

  const parseArguments = (argv) => {
    const options = {
      roadmapPath: "ROADMAP.md",
      issuePath: undefined,
      live: false,
      repo: process.env.GITHUB_REPOSITORY,
      closingPr: undefined,
    };
    const seenArguments = new Set();

    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index];
      if (seenArguments.has(argument)) {
        fail(
          "E_ROADMAP_USAGE",
          "arguments",
          `${argument} may be specified only once`,
        );
      }
      seenArguments.add(argument);
      const optionValue = () => {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          fail(
            "E_ROADMAP_USAGE",
            "arguments",
            `${argument} requires a value`,
          );
        }
        index += 1;
        return value;
      };
      if (argument === "--live") {
        options.live = true;
      } else if (argument === "--roadmap") {
        options.roadmapPath = optionValue();
      } else if (argument === "--issues") {
        options.issuePath = optionValue();
      } else if (argument === "--repo") {
        options.repo = optionValue();
      } else if (argument === "--closing-pr") {
        options.closingPr = optionValue();
      } else {
        fail(
          "E_ROADMAP_USAGE",
          "arguments",
          `unknown or incomplete argument "${argument ?? ""}"`,
        );
      }
    }

    if (options.live && options.issuePath) {
      fail(
        "E_ROADMAP_USAGE",
        "arguments",
        "--live and --issues are mutually exclusive",
      );
    }
    if (
      (options.live || seenArguments.has("--repo")) &&
      options.repo !== undefined &&
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u.test(
        options.repo,
      )
    ) {
      fail("E_ROADMAP_USAGE", "arguments", "--repo requires OWNER/NAME");
    }
    if (options.closingPr && !options.live) {
      fail(
        "E_ROADMAP_USAGE",
        "arguments",
        "--closing-pr requires --live",
      );
    }
    if (options.live && !options.repo) {
      fail(
        "E_ROADMAP_USAGE",
        "arguments",
        "--live requires --repo OWNER/NAME or GITHUB_REPOSITORY",
      );
    }
    if (options.closingPr && !/^[1-9]\d*$/u.test(String(options.closingPr))) {
      fail(
        "E_ROADMAP_USAGE",
        "arguments",
        "--closing-pr requires a positive pull-request number",
      );
    }

    return options;
  };

  const runGitHub = (arguments_, description) => {
    try {
      return execFileSync("gh", arguments_, {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: GITHUB_CALL_BOUNDS.timeout,
        maxBuffer: GITHUB_CALL_BOUNDS.maxBuffer,
      });
    } catch (error) {
      const stderr = error?.stderr?.trim();
      fail(
        "E_ROADMAP_GITHUB",
        description,
        stderr || error?.message || "GitHub CLI command failed",
      );
    }
  };

  const parseJson = (source, category, location) => {
    try {
      return JSON.parse(source);
    } catch (error) {
      fail(category, location, `invalid JSON: ${error.message}`);
    }
  };

  const readSource = (path, category) => {
    try {
      return readFileSync(resolve(path), "utf8");
    } catch (error) {
      fail(category, path, `unable to read: ${error.message}`);
    }
  };

  const loadLiveIssues = (repo) => {
    const output = runGitHub(
      [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "all",
        "--limit",
        String(LIVE_ISSUE_LIMIT),
        "--json",
        "number,state,title,labels",
      ],
      `github:${repo}:issues`,
    );
    const issues = parseJson(
      output,
      "E_ROADMAP_GITHUB",
      `github:${repo}:issues`,
    );
    if (Array.isArray(issues) && issues.length >= LIVE_ISSUE_LIMIT) {
      fail(
        "E_ROADMAP_GITHUB",
        `github:${repo}:issues`,
        "issue listing reached the 10,000-issue ceiling; results may be truncated",
      );
    }
    return issues;
  };

  const loadClosingIssueNumbers = (repo, pullRequest) => {
    if (!pullRequest) {
      return new Set();
    }
    const output = runGitHub(
      [
        "pr",
        "view",
        String(pullRequest),
        "--repo",
        repo,
        "--json",
        "closingIssuesReferences",
      ],
      `github:${repo}:pulls/${pullRequest}`,
    );
    const parsed = parseJson(
      output,
      "E_ROADMAP_GITHUB",
      `github:${repo}:pulls/${pullRequest}`,
    );
    return closingIssueNumbersForRepository(
      parsed.closingIssuesReferences ?? [],
      repo,
    );
  };

  return function run(argv = process.argv.slice(2)) {
    const options = parseArguments(argv);
    const roadmap = readSource(
      options.roadmapPath,
      "E_ROADMAP_UNREADABLE_ROADMAP",
    );

    if (!options.live && !options.issuePath) {
      const inventory = parseRoadmapInventory(roadmap, {
        roadmapPath: options.roadmapPath,
      });
      process.stdout.write(
        `check-roadmap-inventory: ${inventory.size} primary markers are structurally valid\n`,
      );
      return;
    }

    const issues = options.live
      ? loadLiveIssues(options.repo)
      : parseJson(
          readSource(
            options.issuePath,
            "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
          ),
          "E_ROADMAP_INVALID_ISSUE_SNAPSHOT",
          options.issuePath,
        );
    const closingIssueNumbers = options.live
      ? loadClosingIssueNumbers(options.repo, options.closingPr)
      : new Set();
    const result = validateRoadmapInventory({
      roadmap,
      issues,
      roadmapPath: options.roadmapPath,
      issuePath: options.live
        ? `github:${options.repo}:issues`
        : options.issuePath,
      closingIssueNumbers,
    });
    process.stdout.write(
      `check-roadmap-inventory: ${result.openSliceCount} open slices and ${result.primaryCount} primary markers agree\n`,
    );
  };
}
