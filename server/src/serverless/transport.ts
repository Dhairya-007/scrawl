import type { ServerToClient } from '@scrawl/shared';
import type { LoggedEvent } from '../snapshot.js';
import { EVENT_LOG_LIMIT } from '../snapshot.js';
import type { RoomTransport } from '../room.js';

/**
 * A transport for a server with no sockets. Instead of pushing to clients it
 * writes what the engine emitted into a log, which clients collect by polling
 * with a cursor.
 *
 * `state` is deliberately not logged: it is derived, and every poll computes
 * it fresh for the caller, so logging it would only waste space and risk
 * handing one player another's view.
 */
export class BufferTransport implements RoomTransport {
  constructor(
    private events: LoggedEvent[] = [],
    private seq = 1,
  ) {}

  private push(to: string | null, event: string, args: unknown[]): void {
    if (event === 'state') return;
    this.events.push({ seq: this.seq++, to, event, args });
    if (this.events.length > EVENT_LOG_LIMIT) {
      this.events.splice(0, this.events.length - EVENT_LOG_LIMIT);
    }
  }

  emitToRoom<E extends keyof ServerToClient>(
    event: E,
    ...args: Parameters<ServerToClient[E]>
  ): void {
    this.push(null, event as string, args as unknown[]);
  }

  emitToPlayer<E extends keyof ServerToClient>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClient[E]>
  ): void {
    this.push(playerId, event as string, args as unknown[]);
  }

  dropPlayer(): void {
    // Nothing to disconnect: the client stops polling when it sees `kicked`.
  }

  /** Everything this player has not seen, oldest first. */
  since(cursor: number, playerId: string): LoggedEvent[] {
    return this.events.filter((e) => e.seq > cursor && (e.to === null || e.to === playerId));
  }

  get log(): LoggedEvent[] {
    return this.events;
  }

  get nextSeq(): number {
    return this.seq;
  }

  /** The oldest sequence still held, so a client can tell it fell behind. */
  get oldestSeq(): number {
    return this.events[0]?.seq ?? this.seq;
  }
}
