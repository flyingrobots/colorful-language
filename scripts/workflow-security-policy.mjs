const POLICY_PATH = ".github/workflow-security-policy.yml";
const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";
const REVIEWED_RELEASE_SECRET_EXCEPTIONS = Object.freeze([
  {
    path: `${RELEASE_WORKFLOW_PATH}:jobs.release.steps[Publish to crates.io].env.CARGO_REGISTRY_TOKEN`,
    selector: "CARGO_REGISTRY_TOKEN",
    stepName: "Publish to crates.io",
    secret: "${{ secrets.CARGO_REGISTRY_TOKEN }}",
  },
  {
    path: `${RELEASE_WORKFLOW_PATH}:jobs.release.steps[Verify and publish VS Marketplace extension].env.VSCE_PAT`,
    selector: "VSCE_PAT",
    stepName: "Verify and publish VS Marketplace extension",
    secret: "${{ secrets.VSCE_PAT }}",
  },
  {
    path: `${RELEASE_WORKFLOW_PATH}:jobs.release.steps[Verify and publish Open VSX extension].env.OVSX_PAT`,
    selector: "OVSX_PAT",
    stepName: "Verify and publish Open VSX extension",
    secret: "${{ secrets.OVSX_PAT }}",
  },
]);

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

function validateException(exception, index, workflowFiles, expected) {
  const code = "E_WORKFLOW_SECURITY_EXCEPTION";
  const path = `${POLICY_PATH}:exceptions[${index}]`;
  requireExactKeys(
    exception,
    ["owner", "path", "reason", "remove_when", "rule", "selector"],
    code,
    path,
  );
  if (
    exception.rule !== "secrets-outside-env" ||
    exception.path !== expected.path ||
    exception.selector !== expected.selector
  ) {
    reject(
      code,
      path,
      `must identify only the reviewed ${expected.selector} release-token exception`,
    );
  }
  if (exception.owner !== "@flyingrobots") {
    reject(code, `${path}.owner`, "must name @flyingrobots");
  }
  for (const key of ["reason", "remove_when"]) {
    requireText(
      exception[key],
      code,
      `${path}.${key}`,
      "must be a non-empty string",
    );
  }

  const releaseWorkflow = workflowFiles?.[RELEASE_WORKFLOW_PATH];
  const publishSteps = releaseWorkflow?.jobs?.release?.steps?.filter(
    (step) => step?.name === expected.stepName,
  );
  if (
    !Array.isArray(publishSteps) ||
    publishSteps.length !== 1 ||
    publishSteps[0]?.env?.[expected.selector] !== expected.secret ||
    countSubstring(workflowFiles, expected.selector) !== 1
  ) {
    reject(
      code,
      exception.path,
      `must resolve to the only use of the reviewed ${expected.selector} token`,
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

  if (
    !Array.isArray(policy.exceptions) ||
    policy.exceptions.length !==
      REVIEWED_RELEASE_SECRET_EXCEPTIONS.length
  ) {
    reject(
      "E_WORKFLOW_SECURITY_EXCEPTION",
      `${POLICY_PATH}:exceptions`,
      "must contain exactly the reviewed release-token exceptions",
    );
  }
  const expectedBySelector = new Map(
    REVIEWED_RELEASE_SECRET_EXCEPTIONS.map((expected) => [
      expected.selector,
      expected,
    ]),
  );
  const expectedSelectors = [...expectedBySelector.keys()].toSorted();
  const actualSelectors = policy.exceptions
    .map((exception) => exception?.selector)
    .toSorted();
  if (
    actualSelectors.some(
      (selector, index) => selector !== expectedSelectors[index],
    )
  ) {
    reject(
      "E_WORKFLOW_SECURITY_EXCEPTION",
      `${POLICY_PATH}:exceptions`,
      `selectors must equal ${expectedSelectors.join(", ")}`,
    );
  }
  for (const [index, exception] of policy.exceptions.entries()) {
    validateException(
      exception,
      index,
      workflowFiles,
      expectedBySelector.get(exception.selector),
    );
  }
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
