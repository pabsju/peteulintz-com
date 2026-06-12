// Distribution summaries for the stats API. Pure: arrays in, plain objects
// out. The handlers feed these the score columns D1 returns.

/**
 * Bucket `values` into `bucketCount` equal-width bins and compute order
 * stats. Returns null for an empty array — "no data yet" is the caller's
 * story to tell, not a zero-filled histogram's.
 *
 * Shape: { n, min, max, median, counts } where counts.length === bucketCount
 * (or 1 when every value is identical — a single spike, not 20 empty bins).
 */
export function summarize(values, bucketCount = 20) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const mid = n >> 1;
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (min === max) return { n, min, max, median, counts: [n] };
  const width = (max - min) / bucketCount;
  const counts = new Array(bucketCount).fill(0);
  for (const v of sorted) {
    counts[Math.min(bucketCount - 1, Math.floor((v - min) / width))] += 1;
  }
  return { n, min, max, median, counts };
}

/**
 * Which bucket a value lands in, for marking "you are here" on a histogram
 * with this min/max/bucket-count. Clamped; null when there is no spread.
 */
export function bucketIndex(value, min, max, bucketCount) {
  if (!(max > min) || bucketCount < 1) return null;
  const idx = Math.floor(((value - min) / (max - min)) * bucketCount);
  return Math.max(0, Math.min(bucketCount - 1, idx));
}
