import type { Clock } from './clock.js';

/**
 * A token bucket per key. Used to keep one client from flooding chat, drawing
 * or settings changes; it refills smoothly so normal bursts still go through.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: Clock,
  ) {}

  /** Spend one token. False means the caller is over its limit. */
  take(key: string, cost = 1): boolean {
    const now = this.clock.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    const elapsed = Math.max(0, now - bucket.updated) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updated = now;

    if (bucket.tokens < cost) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= cost;
    this.buckets.set(key, bucket);
    return true;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop buckets nobody has touched for a while, so the map cannot grow. */
  prune(olderThanMs = 10 * 60_000): void {
    const cutoff = this.clock.now() - olderThanMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.updated < cutoff) this.buckets.delete(key);
    }
  }
}
