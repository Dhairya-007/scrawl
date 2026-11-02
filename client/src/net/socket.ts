import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@scrawl/shared';
import { PollingSocket } from './pollingSocket.js';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

/**
 * Which way to talk to the server. Sockets are the better experience and the
 * default; polling exists for hosts that cannot keep a connection open, where
 * a socket is simply not on offer.
 */
const TRANSPORT = import.meta.env.VITE_TRANSPORT === 'http' ? 'http' : 'socket';

let socket: GameSocket | null = null;

/**
 * Where the server is. Unset means "this origin", which covers development
 * (Vite proxies `/socket.io`) and the single-service deploy (one Node process
 * serves the API and the built client). It is set only when the two are hosted
 * apart, as they must be on a static host that cannot hold a socket open.
 */
const SERVER_URL = import.meta.env.VITE_SERVER_URL?.trim() || undefined;

/** One socket for the whole session, opened lazily. */
export function getSocket(): GameSocket {
  if (!socket) {
    if (TRANSPORT === 'http') {
      socket = new PollingSocket(SERVER_URL ?? '') as unknown as GameSocket;
      return socket;
    }
    socket = io(SERVER_URL, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 400,
      reconnectionDelayMax: 4_000,
      timeout: 8_000,
    });
  }
  return socket;
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}
