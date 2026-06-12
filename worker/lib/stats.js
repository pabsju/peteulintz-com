// Percentile math for the stats API. Pure, no D1 — the SQL layer hands us
// counts, we hand back ranks. Tested directly in node (test/worker-stats).

/**
 * Mid-rank percentile: where does a value sit in a distribution, given how
 * many observations fall below it, tie it, and the total count?
 * Ties count half so ranks stay symmetric (p + p-from-the-top = 100).
 * Returns 0-100, or null when the distribution is empty.
 */
export function percentileRank(below, ties, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return (100 * (below + 0.5 * ties)) / total;
}

/** Round a percentile for display/transport; null passes through. */
export function roundPercentile(p) {
  return p === null ? null : Math.round(p * 10) / 10;
}
