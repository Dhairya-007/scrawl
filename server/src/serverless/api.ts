import {
  MAX_CLIENT_ID_LENGTH,
  cleanText,
  isValidRoomCode,
  normalizeRoomCode,
  type JoinRequest,
  type JoinResponse,
} from '@scrawl/shared';
import { newRoomCode } from '../ids.js';
import type { RoomStore } from '../store.js';
import { createRoom, reviveSession, withRoom, type Session } from './session.js';

export interface ApiRequest {
  method: string;
  /** Path with the `/api` prefix already stripped, e.g. `join`. */
  path: string;
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

/** Dispatches one action onto a restored room. */
function applyAction(session: Session, playerId: string, type: string, payload: any): void {
  const { room } = session;
  switch (type) {
    case 'settings:update':
      return room.updateSettings(playerId, payload ?? {});
    case 'profile:update':
      return room.updateProfile(playerId, payload ?? {});
    case 'game:start':
      return room.startGame(playerId);
    case 'word:pick':
      return room.chooseWord(playerId, Number(payload?.index) || 0);
    case 'draw:ops':
      return room.addOps(playerId, payload);
    case 'draw:cursor':
      return room.setCursor(playerId, payload ?? null);
    case 'draw:undo':
      return room.undo(playerId);
    case 'draw:clear':
      return room.clearCanvas(playerId);
    case 'chat:send':
      return room.say(playerId, String(payload?.text ?? ''));
    case 'vote:skip':
      return room.voteSkip(playerId);
    case 'vote:kick':
      return room.voteKick(playerId, String(payload?.playerId ?? ''));
    case 'host:kick':
      return room.hostKick(playerId, String(payload?.playerId ?? ''));
    case 'leave':
      return room.remove(playerId, 'left');
    default:
      return;
  }
}

/** Find a public room with space for one more. */
async function findPublic(store: RoomStore, now: number): Promise<string | null> {
  const codes = await store.listPublic();
  let best: { code: string; players: number } | null = null;
  for (const code of codes.slice(0, 25)) {
    const loaded = await store.load(code);
    if (!loaded) continue;
    const { room } = reviveSession(loaded.snapshot, now);
    // Fill the busiest room that still has space, so games gather rather
    // than scatter one player at a time.
    if (room.isJoinable && (!best || room.playerCount > best.players)) {
      best = { code, players: room.playerCount };
    }
  }
  return best?.code ?? null;
}

export async function handleApi(
  request: ApiRequest,
  store: RoomStore,
  now: () => number = Date.now,
): Promise<ApiResponse> {
  const path = request.path.replace(/^\/+|\/+$/g, '');

  // ---- health -----------------------------------------------------------
  if (path === 'healthz') {
    return json(200, { ok: true, mode: 'serverless' });
  }

  // ---- join -------------------------------------------------------------
  if (path === 'join' && request.method === 'POST') {
    const input = (request.body ?? {}) as Partial<JoinRequest>;
    const clientId = cleanText(input.clientId, MAX_CLIENT_ID_LENGTH);
    if (clientId.length < 8) return json(200, { ok: false, error: 'invalid' } satisfies JoinResponse);

    let code: string | null = null;
    if (input.mode === 'create') {
      code = newRoomCode();
      const made = await createRoom(store, code, input.settings, () => {}, now);
      if (!made) return json(200, { ok: false, error: 'room-closed' } satisfies JoinResponse);
    } else if (input.mode === 'quickplay') {
      code = await findPublic(store, now());
      if (!code) {
        code = newRoomCode();
        const made = await createRoom(
          store,
          code,
          { ...input.settings, isPrivate: false },
          () => {},
          now,
        );
        if (!made) return json(200, { ok: false, error: 'room-closed' } satisfies JoinResponse);
      }
    } else {
      if (!isValidRoomCode(input.code)) {
        return json(200, { ok: false, error: 'invalid' } satisfies JoinResponse);
      }
      code = normalizeRoomCode(input.code);
    }

    const outcome = await withRoom(
      store,
      code,
      ({ room, transport }): JoinResponse => {
        if (room.isBannedClient(clientId)) return { ok: false, error: 'banned' };
        if (!room.findSeatFor(clientId) && !room.isJoinable) return { ok: false, error: 'room-full' };
        const { id, resumed } = room.join({
          clientId,
          name: String(input.name ?? 'Player'),
          avatar: input.avatar as JoinRequest['avatar'],
        });
        return {
          ok: true,
          code: room.code,
          youId: id,
          state: room.stateFor(id),
          resumed,
          ops: room.canvasOps,
          chat: room.publicChat,
          // Everything up to here is already folded into the reply, so the
          // client starts polling from the current end of the log.
          cursor: transport.nextSeq - 1,
        } as JoinResponse & { cursor: number };
      },
      now,
    );

    if (!outcome.ok) {
      return json(200, {
        ok: false,
        error: outcome.reason === 'missing' ? 'room-not-found' : 'rate-limited',
      } satisfies JoinResponse);
    }
    return json(200, outcome.value);
  }

  // ---- poll -------------------------------------------------------------
  if (path === 'poll' && request.method === 'GET') {
    const code = request.query.code ?? '';
    const playerId = request.query.playerId ?? '';
    const cursor = Number(request.query.cursor ?? 0) || 0;
    if (!isValidRoomCode(code) || playerId.length === 0) return json(400, { error: 'invalid' });

    const outcome = await withRoom(
      store,
      normalizeRoomCode(code),
      ({ room, transport }) => ({
        state: room.stateFor(playerId),
        events: transport.since(cursor, playerId),
        cursor: transport.nextSeq - 1,
        // A client that fell behind the log needs a full resync, not a diff.
        stale: cursor > 0 && cursor < transport.oldestSeq - 1,
        seated: room.hasSeat(playerId),
      }),
      now,
    );
    if (!outcome.ok) return json(404, { error: outcome.reason });
    return json(200, outcome.value);
  }

  // ---- action -----------------------------------------------------------
  if (path === 'action' && request.method === 'POST') {
    const body = (request.body ?? {}) as { code?: string; playerId?: string; type?: string; payload?: unknown };
    if (!isValidRoomCode(body.code) || !body.playerId || !body.type) {
      return json(400, { error: 'invalid' });
    }
    const outcome = await withRoom(
      store,
      normalizeRoomCode(body.code),
      (session) => {
        applyAction(session, body.playerId!, body.type!, body.payload);
        return { ok: true };
      },
      now,
    );
    if (!outcome.ok) return json(404, { error: outcome.reason });
    return json(200, outcome.value);
  }

  return json(404, { error: 'not-found' });
}
