import type { JoinResponse, StatePayload } from '@scrawl/shared';

type Handler = (...args: any[]) => void;

/** How often the client asks the server what changed. */
const POLL_IDLE_MS = 1200;
const POLL_ACTIVE_MS = 450;

/**
 * A stand-in for the Socket.IO client that talks to the polling API instead.
 *
 * It presents the same surface the store already uses — `on`, `emit`, `once`,
 * `connected`, `io.on('reconnect')` — so the rest of the client does not need
 * to know which transport is underneath. This is what lets the game run on a
 * host that cannot hold a connection open.
 */
export class PollingSocket {
  private handlers = new Map<string, Handler[]>();
  private code: string | null = null;
  private playerId: string | null = null;
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private inFlight = false;
  /** Faster polling just after you act, so your own moves feel immediate. */
  private quickUntil = 0;

  connected = true;
  readonly io = { on: (_event: string, _handler: Handler) => {} };

  constructor(private readonly base: string) {}

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  once(event: string, handler: Handler): this {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler: Handler): void {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
  }

  private fire(event: string, args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  emit(event: string, ...args: unknown[]): this {
    if (event === 'join') {
      const [request, ack] = args as [unknown, ((response: JoinResponse) => void) | undefined];
      void this.join(request, ack);
      return this;
    }
    if (event === 'leave') {
      void this.send('leave', undefined);
      this.stop();
      return this;
    }
    void this.send(event, args[0]);
    return this;
  }

  private async join(request: unknown, ack?: (response: JoinResponse) => void): Promise<void> {
    try {
      const response = await this.post<JoinResponse & { cursor?: number }>('join', request);
      if (response.ok) {
        this.code = response.code;
        this.playerId = response.youId;
        this.cursor = response.cursor ?? 0;
        this.stopped = false;
        this.schedule(POLL_ACTIVE_MS);
      }
      ack?.(response);
    } catch {
      ack?.({ ok: false, error: 'room-closed' });
    }
  }

  private async send(type: string, payload: unknown): Promise<void> {
    if (!this.code || !this.playerId) return;
    // Act, then look again promptly rather than waiting out the idle gap.
    this.quickUntil = Date.now() + 2_000;
    try {
      await this.post('action', { code: this.code, playerId: this.playerId, type, payload });
    } catch {
      // A dropped action is recovered by the next poll's authoritative state.
    }
    this.schedule(120);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.base}/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as T;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.inFlight || !this.code || !this.playerId) return;
    this.inFlight = true;
    try {
      const url = `${this.base}/api/poll?code=${this.code}&playerId=${this.playerId}&cursor=${this.cursor}`;
      const response = await fetch(url);
      if (response.status === 404) {
        this.fire('kicked', [{ reason: 'room-closed' }]);
        this.stop();
        return;
      }
      const body = (await response.json()) as {
        state: StatePayload;
        events: Array<{ seq: number; event: string; args: unknown[] }>;
        cursor: number;
        seated: boolean;
      };
      if (!this.connected) {
        this.connected = true;
        this.fire('connect', []);
      }
      // The seat is gone: treat it the way a socket client treats a kick.
      if (body.seated === false) {
        this.fire('kicked', [{ reason: 'room-closed' }]);
        this.stop();
        return;
      }
      for (const entry of body.events ?? []) this.fire(entry.event, entry.args);
      this.cursor = body.cursor ?? this.cursor;
      if (body.state) this.fire('state', [body.state]);
    } catch {
      if (this.connected) {
        this.connected = false;
        this.fire('disconnect', []);
      }
    } finally {
      this.inFlight = false;
      this.schedule(Date.now() < this.quickUntil ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.code = null;
    this.playerId = null;
    this.cursor = 0;
  }

  close(): void {
    this.stop();
  }
}
