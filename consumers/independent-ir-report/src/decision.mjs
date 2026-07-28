export function decideIrContract({
  irLines,
  ansiLines,
  lspLines,
  correctnessAdvantage,
}) {
  const alternativesNonblankAdapterLines = ansiLines + lspLines;
  const withinReviewedCostBound =
    irLines <= alternativesNonblankAdapterLines * 2;
  const smallestAdapter = irLines <= ansiLines && irLines <= lspLines;
  const retain =
    (correctnessAdvantage && withinReviewedCostBound) || smallestAdapter;
  return Object.freeze({
    alternativesNonblankAdapterLines,
    correctnessAdvantage,
    withinReviewedCostBound,
    smallestAdapter,
    decision: retain ? "retain-stable-v1" : "simplify-before-expansion",
  });
}
