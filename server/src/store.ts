import type { RoomSnapshot } from './snapshot.js';

/**
 * Where rooms live between requests. A long-running server keeps them in
 * memory; a serverless one cannot, so it needs somewhere shared.
 *
 * Writes are conditional on the version that was read, because two players
 * can act in the same instant and a blind write would lose one of them.
 */
export interface RoomStore {
  load(code: string): Promise<{ snapshot: RoomSnapshot; version: number } | null>;
  /** Returns false when someone else wrote first; the caller retries. */
  save(code: string, snapshot: RoomSnapshot, expectedVersion: number | null): Promise<boolean>;
  delete(code: string): Promise<void>;
  /** Codes of rooms that are public and have room, for quick-play. */
  listPublic(): Promise<string[]>;
  setPublic(code: string, isPublic: boolean): Promise<void>;
}

/** For tests and local runs. */
export class MemoryStore implements RoomStore {
  private rooms = new Map<string, { snapshot: RoomSnapshot; version: number }>();
  private publicCodes = new Set<string>();

  async load(code: string) {
    const entry = this.rooms.get(code);
    return entry ? { snapshot: structuredClone(entry.snapshot), version: entry.version } : null;
  }

  async save(code: string, snapshot: RoomSnapshot, expectedVersion: number | null) {
    const current = this.rooms.get(code);
    if (expectedVersion === null && current) return false;
    if (expectedVersion !== null && current && current.version !== expectedVersion) return false;
    this.rooms.set(code, { snapshot: structuredClone(snapshot), version: (current?.version ?? 0) + 1 });
    return true;
  }

  async delete(code: string) {
    this.rooms.delete(code);
    this.publicCodes.delete(code);
  }

  async listPublic() {
    return [...this.publicCodes];
  }

  async setPublic(code: string, isPublic: boolean) {
    if (isPublic) this.publicCodes.add(code);
    else this.publicCodes.delete(code);
  }
}

/**
 * Redis over HTTP, which is what works from a serverless function — a TCP
 * pool cannot survive between invocations. Speaks the Upstash REST API, the
 * one Vercel's marketplace provisions.
 */
export class RedisStore implements RoomStore {
  /** Rooms are dropped by Redis itself if nobody touches them. */
  private readonly ttlSeconds = 2 * 60 * 60;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args.map(String)),
    });
    if (!response.ok) throw new Error(`redis ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as { result: T; error?: string };
    if (body.error) throw new Error(`redis: ${body.error}`);
    return body.result;
  }

  private key(code: string) {
    return `scrawl:room:${code}`;
  }

  async load(code: string) {
    const raw = await this.command<string | null>('GET', this.key(code));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { snapshot: RoomSnapshot; version: number };
      return parsed.snapshot ? parsed : null;
    } catch {
      // A snapshot we cannot read is worse than none; drop it.
      await this.delete(code);
      return null;
    }
  }

  /**
   * Compare-and-set through a small Lua script, so two players acting at once
   * cannot overwrite each other. Redis runs it atomically.
   */
  async save(code: string, snapshot: RoomSnapshot, expectedVersion: number | null) {
    const script = `
      local current = redis.call('GET', KEYS[1])
      local expected = ARGV[2]
      if current then
        if expected == 'new' then return 0 end
        local decoded = cjson.decode(current)
        if tostring(decoded.version) ~= expected then return 0 end
      elseif expected ~= 'new' then
        return 0
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
      return 1`;
    const nextVersion = (expectedVersion ?? 0) + 1;
    const payload = JSON.stringify({ snapshot, version: nextVersion });
    const ok = await this.command<number>(
      'EVAL',
      script,
      1,
      this.key(code),
      payload,
      expectedVersion === null ? 'new' : String(expectedVersion),
      this.ttlSeconds,
    );
    return ok === 1;
  }

  async delete(code: string) {
    await this.command('DEL', this.key(code));
    await this.command('SREM', 'scrawl:public', code);
  }

  async listPublic() {
    return (await this.command<string[]>('SMEMBERS', 'scrawl:public')) ?? [];
  }

  async setPublic(code: string, isPublic: boolean) {
    if (isPublic) await this.command('SADD', 'scrawl:public', code);
    else await this.command('SREM', 'scrawl:public', code);
  }
}

/** Picks the Redis store when it is configured, and memory otherwise. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): RoomStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisStore(url, token);
  return new MemoryStore();
}
