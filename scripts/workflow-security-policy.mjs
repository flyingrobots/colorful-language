const POLICY_PATH = ".github/workflow-security-policy.yml";
const RELEASE_EXCEPTION_PATH =
  ".github/workflows/release.yml:jobs.release.steps[Publish to crates.io].env.CARGO_REGISTRY_TOKEN";
const RELEASE_SECRET = "${{ secrets.CARGO_REGISTRY_TOKEN }}";

export const WORKFLOW_SECURITY_COMMANDS = [
  "node --test scripts/check-workflow-security.test.mjs",
  "node scripts/check-workflow-security.mjs",
];

export class WorkflowSecurityPolicyError extends Error {
  constructor(code, path, detail) {
    super(`${path}: ${detail}`);
    this.name = "WorkflowSecurityPolicyError";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

function reject(code, path, detail) {
  throw new WorkflowSecurityPolicyError(code, path, detail);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, code, path) {
  if (!isObject(value)) {
    reject(code, path, "expected an object");
  }
  return value;
}

function requireExactKeys(value, expected, code, path) {
  const actual = Object.keys(requireObject(value, code, path)).toSorted();
  const wanted = expected.toSorted();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    reject(code, path, `must contain only ${wanted.join(", ")}`);
  }
}

function requireText(value, code, path, description) {
  if (typeof value !== "string" || value.trim() === "") {
    reject(code, path, description);
  }
}

function countSubstring(value, needle) {
  if (typeof value === "string") {
    return value.split(needle).length - 1;
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (count, child) => count + countSubstring(child, needle),
      0,
    );
  }
  if (isObject(value)) {
    return Object.values(value).reduce(
      (count, child) => count + countSubstring(child, needle),
      0,
    );
  }
  return 0;
}

function validateException(exception, workflowFiles) {
  const code = "E_WORKFLOW_SECURITY_EXCEPTION";
  const path = `${POLICY_PATH}:exceptions[0]`;
  requireExactKeys(
    exception,
    ["owner", "path", "reason", "remove_when", "rule", "selector"],
    code,
    path,
  );
  if (
    exception.rule !== "secrets-outside-env" ||
    exception.path !== RELEASE_EXCEPTION_PATH ||
    exception.selector !== "CARGO_REGISTRY_TOKEN"
  ) {
    reject(
      code,
      path,
      "must identify only the reviewed crates.io release-token exception",
    );
  }
  if (
    typeof exception.owner !== "string" ||
    !/^@[A-Za-z0-9-]+$/u.test(exception.owner)
  ) {
    reject(code, `${path}.owner`, "must name one GitHub owner");
  }
  for (const key of ["reason", "remove_when"]) {
    requireText(
      exception[key],
      code,
      `${path}.${key}`,
      "must be a non-empty string",
    );
  }

  const releaseWorkflow =
    workflowFiles?.[".github/workflows/release.yml"];
  const publishSteps = releaseWorkflow?.jobs?.release?.steps?.filter(
    (step) => step?.name === "Publish to crates.io",
  );
  if (
    !Array.isArray(publishSteps) ||
    publishSteps.length !== 1 ||
    publishSteps[0]?.env?.CARGO_REGISTRY_TOKEN !== RELEASE_SECRET ||
    countSubstring(workflowFiles, RELEASE_SECRET) !== 1
  ) {
    reject(
      code,
      exception.path,
      "must resolve to the only use of the reviewed crates.io token",
    );
  }
}

export function validateWorkflowSecurityPolicy(policy, workflowFiles) {
  const code = "E_WORKFLOW_SECURITY_POLICY";
  requireExactKeys(
    policy,
    ["analyzer", "exceptions", "invocation", "version"],
    code,
    POLICY_PATH,
  );
  if (policy.version !== 1) {
    reject(code, `${POLICY_PATH}:version`, "must equal 1");
  }

  requireExactKeys(
    policy.analyzer,
    ["name", "version"],
    code,
    `${POLICY_PATH}:analyzer`,
  );
  if (
    policy.analyzer.name !== "zizmor" ||
    typeof policy.analyzer.version !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(policy.analyzer.version)
  ) {
    reject(
      code,
      `${POLICY_PATH}:analyzer`,
      "must select zizmor at one exact stable semantic version",
    );
  }

  requireExactKeys(
    policy.invocation,
    [
      "collect",
      "min_confidence",
      "min_severity",
      "offline",
      "persona",
      "strict_collection",
    ],
    code,
    `${POLICY_PATH}:invocation`,
  );
  const reviewedInvocation = {
    persona: "auditor",
    min_severity: "low",
    min_confidence: "low",
    offline: true,
    collect: "workflows",
    strict_collection: true,
  };
  for (const [key, expected] of Object.entries(reviewedInvocation)) {
    if (policy.invocation[key] !== expected) {
      reject(
        code,
        `${POLICY_PATH}:invocation.${key}`,
        `must equal ${JSON.stringify(expected)}`,
      );
    }
  }

  if (!Array.isArray(policy.exceptions) || policy.exceptions.length !== 1) {
    reject(
      "E_WORKFLOW_SECURITY_EXCEPTION",
      `${POLICY_PATH}:exceptions`,
      "must contain exactly the reviewed release-token exception",
    );
  }
  validateException(policy.exceptions[0], workflowFiles);
  return policy;
}

export function zizmorConfig(policy) {
  const allowedSecrets = policy.exceptions
    .filter((exception) => exception.rule === "secrets-outside-env")
    .map((exception) => exception.selector)
    .toSorted();
  return {
    rules: {
      "secrets-outside-env": {
        config: {
          allow: allowedSecrets,
        },
      },
    },
  };
}
