import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  MAX_CLIENT_ID_LENGTH,
  cleanText,
  isValidRoomCode,
  normalizeRoomCode,
  type ClientToServer,
  type JoinRequest,
  type JoinResponse,
  type ServerToClient,
} from '@scrawl/shared';
import { systemClock } from './clock.js';
import { RateLimiter } from './rateLimit.js';
import type { Room, RoomTransport } from './room.js';
import { RoomRegistry } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';

const app = express();
app.disable('x-powered-by');
app.use(compression());

const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  // Drawing arrives in small bursts; this is ample and bounds a bad client.
  maxHttpBufferSize: 256 * 1024,
  pingInterval: 20_000,
  pingTimeout: 25_000,
});

const registry = new RoomRegistry(systemClock);

/** Which room and seat a live socket belongs to. */
const sessions = new Map<string, { room: Room; playerId: string }>();

const joinLimiter = new RateLimiter(8, 0.25, systemClock);
const chatLimiter = new RateLimiter(6, 1.5, systemClock);
const drawLimiter = new RateLimiter(80, 50, systemClock);
const actionLimiter = new RateLimiter(20, 4, systemClock);

setInterval(() => {
  joinLimiter.prune();
  chatLimiter.prune();
  drawLimiter.prune();
  actionLimiter.prune();
}, 5 * 60_000).unref();

/**
 * Socket.IO rooms do the fan-out, and the engine only ever names a player, so
 * this maps a player id onto whichever socket currently holds that seat.
 */
function transportFor(code: string): RoomTransport {
  return {
    emitToRoom(event, ...args) {
      io.to(`room:${code}`).emit(event, ...args);
    },
    emitToPlayer(playerId, event, ...args) {
      io.to(`player:${playerId}`).emit(event, ...args);
    },
    dropPlayer(playerId) {
      for (const socket of io.sockets.sockets.values()) {
        if (sessions.get(socket.id)?.playerId === playerId) {
          sessions.delete(socket.id);
          socket.leave(`room:${code}`);
          socket.leave(`player:${playerId}`);
        }
      }
    },
  };
}

function clientAddress(socket: Socket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return socket.handshake.address;
}

function resolveRoom(request: JoinRequest): { room: Room } | { error: JoinResponse } {
  if (request.mode === 'create') {
    const room = registry.create(request.settings);
    if (!room) return { error: { ok: false, error: 'room-closed' } };
    room.attach(transportFor(room.code));
    return { room };
  }

  if (request.mode === 'quickplay') {
    const existing = registry.findPublic();
    if (existing) return { room: existing };
    // No public game with space, so open one.
    const room = registry.create({ ...request.settings, isPrivate: false });
    if (!room) return { error: { ok: false, error: 'room-closed' } };
    room.attach(transportFor(room.code));
    return { room };
  }

  if (!isValidRoomCode(request.code)) return { error: { ok: false, error: 'invalid' } };
  const room = registry.get(normalizeRoomCode(request.code));
  if (!room) return { error: { ok: false, error: 'room-not-found' } };
  return { room };
}

io.on('connection', (socket) => {
  const address = clientAddress(socket);

  socket.on('join', (request, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (sessions.has(socket.id)) {
      respond({ ok: false, error: 'invalid' });
      return;
    }
    if (!joinLimiter.take(address)) {
      respond({ ok: false, error: 'rate-limited' });
      return;
    }
    if (typeof request !== 'object' || request === null) {
      respond({ ok: false, error: 'invalid' });
      return;
    }

    const clientId = cleanText(request.clientId, MAX_CLIENT_ID_LENGTH);
    if (clientId.length < 8) {
      respond({ ok: false, error: 'invalid' });
      return;
    }

    const resolved = resolveRoom(request);
    if ('error' in resolved) {
      respond(resolved.error);
      return;
    }
    const { room } = resolved;

    if (room.isBannedClient(clientId)) {
      respond({ ok: false, error: 'banned' });
      return;
    }
    // A player reclaiming their own seat does not need space in the room.
    if (!room.findSeatFor(clientId) && !room.isJoinable) {
      respond({ ok: false, error: 'room-full' });
      return;
    }

    const { id, resumed } = room.join({
      clientId,
      name: request.name,
      avatar: request.avatar,
    });

    sessions.set(socket.id, { room, playerId: id });
    socket.join(`room:${room.code}`);
    socket.join(`player:${id}`);
    // Everything the client needs to paint the room, in one reply: the socket
    // has only just been added to these channels, so a separate emit from
    // inside `join` would have had nowhere to go.
    respond({
      ok: true,
      code: room.code,
      youId: id,
      state: room.stateFor(id),
      resumed,
      ops: room.canvasOps,
      chat: room.publicChat,
    });
  });

  /** Every in-room handler needs the seat and a rate-limit check. */
  function seat(limiter: RateLimiter | null, cost = 1) {
    const session = sessions.get(socket.id);
    if (!session) return null;
    if (limiter && !limiter.take(session.playerId, cost)) return null;
    return session;
  }

  socket.on('settings:update', (patch) => {
    const session = seat(actionLimiter);
    session?.room.updateSettings(session.playerId, patch ?? {});
  });

  socket.on('profile:update', (profile) => {
    const session = seat(actionLimiter);
    if (!session || typeof profile !== 'object' || profile === null) return;
    session.room.updateProfile(session.playerId, profile);
  });

  socket.on('game:start', () => {
    const session = seat(actionLimiter);
    session?.room.startGame(session.playerId);
  });

  socket.on('word:pick', (payload) => {
    const session = seat(actionLimiter);
    const index = Number(payload?.index);
    if (!session || !Number.isInteger(index) || index < 0 || index > 8) return;
    session.room.chooseWord(session.playerId, index);
  });

  socket.on('draw:ops', (ops) => {
    const session = seat(drawLimiter, Array.isArray(ops) ? Math.min(ops.length, 64) : 1);
    session?.room.addOps(session.playerId, ops);
  });

  socket.on('draw:cursor', (cursor) => {
    // Cursor updates are chatty and harmless, so they skip the limiter.
    const session = sessions.get(socket.id);
    if (!session) return;
    session.room.setCursor(session.playerId, cursor ?? null);
  });

  socket.on('draw:undo', () => {
    const session = seat(drawLimiter);
    session?.room.undo(session.playerId);
  });

  socket.on('draw:clear', () => {
    const session = seat(drawLimiter);
    session?.room.clearCanvas(session.playerId);
  });

  socket.on('chat:send', (payload) => {
    const session = seat(chatLimiter);
    if (!session || typeof payload?.text !== 'string') return;
    session.room.say(session.playerId, payload.text);
  });

  socket.on('vote:skip', () => {
    const session = seat(actionLimiter);
    session?.room.voteSkip(session.playerId);
  });

  socket.on('vote:kick', (payload) => {
    const session = seat(actionLimiter);
    if (!session || typeof payload?.playerId !== 'string') return;
    session.room.voteKick(session.playerId, payload.playerId);
  });

  socket.on('host:kick', (payload) => {
    const session = seat(actionLimiter);
    if (!session || typeof payload?.playerId !== 'string') return;
    session.room.hostKick(session.playerId, payload.playerId);
  });

  socket.on('leave', () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    sessions.delete(socket.id);
    socket.leave(`room:${session.room.code}`);
    socket.leave(`player:${session.playerId}`);
    // An explicit leave gives up the seat rather than holding it open.
    session.room.remove(session.playerId, 'left');
  });

  socket.on('disconnect', () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    sessions.delete(socket.id);
    session.room.disconnect(session.playerId);
  });
});

app.get('/healthz', (_request, response) => {
  response.json({ ok: true, uptime: Math.round(process.uptime()), ...registry.stats() });
});

// In production the server also hands out the built client, so the whole game
// is one free service rather than a separate frontend deploy.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(response, filePath) {
        // Hashed assets are immutable; the shell must never be cached.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          response.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.get('/{*splat}', (_request, response) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });
}

httpServer.listen(PORT, () => {
  console.log(`scrawl server listening on :${PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, closing`);
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
