/**
 * The game engine reads time and schedules work through this interface so that
 * tests can drive a whole game forward without waiting for it.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** A clock whose time only moves when a test tells it to. */
export class FakeClock implements Clock {
  private current: number;

  /** `startAt` lets a restored room resume from the instant it was stored. */
  constructor(startAt = 1_700_000_000_000) {
    this.current = startAt;
  }

  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Move time forward, firing every timer that comes due along the way. */
  advance(ms: number): void {
    const target = this.current + ms;
    // Timers set by other timers must fire too, so keep draining.
    for (;;) {
      let soonestId: number | null = null;
      let soonestAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < soonestAt) {
          soonestAt = timer.at;
          soonestId = id;
        }
      }
      if (soonestId === null) break;
      const timer = this.timers.get(soonestId)!;
      this.timers.delete(soonestId);
      this.current = timer.at;
      timer.fn();
    }
    this.current = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}
