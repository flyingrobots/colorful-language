const SERVER_NOT_FOUND_CATEGORY = "colorful/server-not-found";
const SERVER_START_FAILED_CATEGORY = "colorful/server-start-failed";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function startupFailureCategory(error: unknown): string {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if (errorCode(current) === "ENOENT") {
      return SERVER_NOT_FOUND_CATEGORY;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b|\b(?:spawn|command|executable|binary)\b.{0,80}\b(?:not found|does not exist)\b/iu.test(
    message,
  )
    ? SERVER_NOT_FOUND_CATEGORY
    : SERVER_START_FAILED_CATEGORY;
}
