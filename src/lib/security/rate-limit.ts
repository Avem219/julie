// Sliding-window limiter. In-memory: correct for a single instance only.
// For multi-instance/serverless production, back this interface with a shared store.
export function createRateLimiter(opts: { windowMs: number; max: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    check(key: string) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { allowed: false as const, retryAfterMs: opts.windowMs - (t - recent[0]) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { allowed: true as const, remaining: opts.max - recent.length };
    },
  };
}
