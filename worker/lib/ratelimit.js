// Per-IP fixed-window rate limiting, in isolate memory. Honest scope note:
// each Worker isolate keeps its own counters, so a determined abuser spread
// across POPs gets `limit × isolates` — that's fine here. This exists to
// stop the casual curl loop from burning Sonnet tokens or flooding D1, not
// to survive a botnet. (The durable fix would be a Durable Object or the
// platform rate-limit binding; not worth it for a personal site.)

export function makeLimiter({ limit, windowMs = 60_000 }) {
  const buckets = new Map(); // key → { count, resetAt }
  return function allow(key, now = Date.now()) {
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      // Window roll is also when we pay the cleanup tax, amortized.
      if (buckets.size > 10_000) {
        for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    b.count += 1;
    return b.count <= limit;
  };
}
