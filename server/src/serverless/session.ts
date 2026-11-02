import { FakeClock } from '../clock.js';
import { Room } from '../room.js';
import type { RoomSnapshot } from '../snapshot.js';
import type { RoomStore } from '../store.js';
import { BufferTransport } from './transport.js';

/** How many times a write is retried when another player got there first. */
const MAX_ATTEMPTS = 5;

export interface Session {
  room: Room;
  transport: BufferTransport;
}

/**
 * Rebuild a room, catch it up, let the caller act on it, and store it again.
 *
 * The catching-up is the trick. Nothing was running between requests, so the
 * turn clock, the hint reveals and the reconnect timers all stand still. The
 * room is restored at the instant it was saved, its timers are put back from
 * the deadlines it stored, and then the clock is wound forward to now — which
 * fires everything that fell due, in order, exactly as a live server would
 * have. It is the same mechanism the engine tests use to play whole games in
 * a millisecond.
 */
export async function withRoom<T>(
  store: RoomStore,
  code: string,
  act: (session: Session) => T,
  now: () => number = Date.now,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'missing' | 'conflict' }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const loaded = await store.load(code);
    if (!loaded) return { ok: false, reason: 'missing' };

    const session = reviveSession(loaded.snapshot, now());
    const value = act(session);

    const snapshot = captureSession(session);
    if (await store.save(code, snapshot, loaded.version)) {
      await store.setPublic(code, !snapshot.settings.isPrivate && !snapshot.closed);
      return { ok: true, value };
    }
    // Somebody else wrote first. Their change is already stored, so start over
    // from what they left rather than clobbering it.
  }
  return { ok: false, reason: 'conflict' };
}

/** Restore a room, rearm its timers, and run its clock up to `at`. */
export function reviveSession(snapshot: RoomSnapshot, at: number): Session {
  const clock = new FakeClock(snapshot.savedAt);
  const transport = new BufferTransport(snapshot.events ?? [], snapshot.nextSeq ?? 1);
  const room = Room.restore(snapshot, { clock });
  room.attach(transport);
  room.rearm();
  clock.advance(Math.max(0, at - snapshot.savedAt));
  return { room, transport };
}

export function captureSession({ room, transport }: Session): RoomSnapshot {
  return { ...room.snapshot(), events: transport.log, nextSeq: transport.nextSeq };
}

/** A brand new room, stored for the first time. */
export async function createRoom(
  store: RoomStore,
  code: string,
  settings: Parameters<typeof Room.prototype.updateSettings>[1] | undefined,
  act: (session: Session) => unknown,
  now: () => number = Date.now,
): Promise<boolean> {
  const clock = new FakeClock(now());
  const transport = new BufferTransport();
  const room = new Room({ code, settings, clock });
  room.attach(transport);
  act({ room, transport });
  const snapshot = captureSession({ room, transport });
  const stored = await store.save(code, snapshot, null);
  if (stored) await store.setPublic(code, !snapshot.settings.isPrivate);
  return stored;
}
