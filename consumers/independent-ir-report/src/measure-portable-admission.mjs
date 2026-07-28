function nonblankSourceLines(bytes) {
  return Buffer.from(bytes).toString("utf8").split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//");
  }).length;
}

export function measurePortableAdmission(canonicalBytes, copies) {
  if (!(canonicalBytes instanceof Uint8Array)) {
    throw new TypeError("canonical generated admission bytes are missing");
  }
  if (!Array.isArray(copies) || copies.length === 0) {
    throw new TypeError("generated admission copies are missing");
  }
  const canonical = Buffer.from(canonicalBytes);
  let committedGeneratedNonblankLines = 0;
  for (const copy of copies) {
    if (
      copy === null ||
      typeof copy !== "object" ||
      typeof copy.path !== "string" ||
      !(copy.bytes instanceof Uint8Array)
    ) {
      const label =
        copy !== null &&
        typeof copy === "object" &&
        typeof copy.path === "string"
          ? copy.path
          : "unknown";
      throw new Error(`generated admission copy ${label} is missing`);
    }
    if (!canonical.equals(Buffer.from(copy.bytes))) {
      throw new Error(
        `generated admission copy ${copy.path} is not byte-identical`,
      );
    }
    committedGeneratedNonblankLines += nonblankSourceLines(copy.bytes);
  }
  return {
    uniqueGeneratedNonblankLines: nonblankSourceLines(canonical),
    committedGeneratedNonblankLines,
  };
}
