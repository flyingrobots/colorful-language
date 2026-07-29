export const SYNTAX_ADMISSION_REVIEW_CASES = Object.freeze([
  "generation is deterministic and both runtime copies are identical",
  "syntax envelope rejects unknown and absent identity fields",
  "every compatibility generation admits its exact released shape",
  "generated admission rejects missing, unknown, primitive, and enum drift",
  "generated rejection exposes stable machine and display metadata",
  "prototype properties cannot impersonate syntax generation ids",
  "generation field lookup preserves the caller error taxonomy",
  "a schema edit changes generated required-field and enum behavior",
  "generation fails closed on unsupported or dangling SDL",
  "generation fails closed when envelope fields drift from String",
  "generation rejects malformed compatibility manifests uniformly",
  "schema references compile once instead of once per admitted value",
  "consumers do not retain handwritten structural field or enum tables",
]);

export function createReviewedCaseRegistry({
  expectedCases = SYNTAX_ADMISSION_REVIEW_CASES,
  registerCase,
}) {
  if (typeof registerCase !== "function") {
    throw new TypeError("reviewed case registrar must be a function");
  }
  const expectedNames = [...expectedCases];
  const expected = new Set();
  for (const name of expectedNames) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("reviewed case names must be non-empty strings");
    }
    if (expected.has(name)) {
      throw new Error(`duplicate reviewed case authority: ${name}`);
    }
    expected.add(name);
  }

  const registered = new Set();
  return Object.freeze({
    register(name, ...arguments_) {
      if (!expected.has(name)) {
        throw new Error(`unreviewed syntax-admission case: ${name}`);
      }
      if (registered.has(name)) {
        throw new Error(`duplicate syntax-admission registration: ${name}`);
      }
      registered.add(name);
      return registerCase(name, ...arguments_);
    },
    assertComplete() {
      const missing = expectedNames.filter((name) => !registered.has(name));
      if (missing.length > 0) {
        throw new Error(
          `missing syntax-admission registrations: ${missing.join(", ")}`,
        );
      }
    },
  });
}
