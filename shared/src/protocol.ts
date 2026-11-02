/**
 * The socket contract. Both ends import these maps so that an event renamed
 * here fails to compile on the other side.
 */

import type {
  Avatar,
  ChatMessage,
  DrawOp,
  DrawOpInput,
  Player,
  PublicState,
  RoomSettings,
  Tool,
} from './types.js';

/** Room codes are short, unambiguous and case-insensitive. */
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type JoinMode =
  /** Open a new private room and host it. */
  | 'create'
  /** Join the room with the given code. */
  | 'join'
  /** Drop into any public room with space, opening one if there is none. */
  | 'quickplay';

export interface JoinRequest {
  mode: JoinMode;
  code?: string;
  name: string;
  avatar: Avatar;
  /**
   * A browser-local id that survives a reload. It lets a player who refreshes
   * drop back into the same seat with their score intact, and it is what a
   * kick is remembered against for the life of the room.
   */
  clientId: string;
  /** Only read for `create`; everything else is decided by the room. */
  settings?: Partial<RoomSettings>;
}

export type JoinError =
  | 'room-not-found'
  | 'room-full'
  | 'room-closed'
  | 'name-taken'
  | 'banned'
  | 'rate-limited'
  | 'invalid';

export type JoinResponse =
  | {
      ok: true;
      code: string;
      youId: string;
      state: StatePayload;
      resumed: boolean;
      /**
       * The canvas as it stands. It rides along with the ack rather than
       * arriving as a separate `draw:sync`, because at the moment a player is
       * seated their socket has not yet been added to the room's channels,
       * and because an ack cannot race the state it belongs to.
       */
      ops: DrawOp[];
      /** Recent public chat, so a room does not open blank. */
      chat: ChatMessage[];
    }
  | { ok: false; error: JoinError };

export const MAX_CLIENT_ID_LENGTH = 40;

/** The authoritative state, as one particular player is allowed to see it. */
export interface StatePayload extends PublicState {
  /** Server wall clock when this was sent, so clients can correct for skew. */
  serverNow: number;
  /** True when the receiving player is the drawer this turn. */
  youAreDrawing: boolean;
  /** True once the receiving player has the word. */
  youGuessed: boolean;
  /** Set only for the drawer during `picking`. */
  wordChoices: string[] | null;
}

export interface TurnEndPayload {
  /** The word in full, now that the turn is over. */
  word: string;
  /** Points earned this turn, keyed by player id. */
  gains: Record<string, number>;
  /** Why the turn ended, which decides the message and the sound. */
  reason: 'time' | 'all-guessed' | 'skipped' | 'drawer-left';
}

export interface GameEndPayload {
  standings: Array<Pick<Player, 'id' | 'name' | 'avatar' | 'score'>>;
}

/** Events the server sends to a client. */
export interface ServerToClient {
  state: (state: StatePayload) => void;
  chat: (message: ChatMessage) => void;
  /** Incremental drawing updates to append to the canvas. */
  'draw:ops': (ops: DrawOp[]) => void;
  /** The whole canvas, for a fresh join, an undo or a clear. */
  'draw:sync': (ops: DrawOp[]) => void;
  /** The drawer's live cursor, so guessers see where the brush is. */
  'draw:cursor': (cursor: { x: number; y: number; tool: Tool; width: number } | null) => void;
  'turn:start': (payload: { drawerId: string; round: number }) => void;
  'turn:end': (payload: TurnEndPayload) => void;
  'game:end': (payload: GameEndPayload) => void;
  /** Removed from the room; the client returns to the home screen. */
  kicked: (payload: { reason: 'host' | 'vote' | 'room-closed' }) => void;
  notice: (payload: { text: string; tone: 'info' | 'warn' | 'error' }) => void;
}

/** Events a client sends to the server. */
export interface ClientToServer {
  join: (request: JoinRequest, ack: (response: JoinResponse) => void) => void;
  leave: () => void;
  'settings:update': (settings: Partial<RoomSettings>) => void;
  'profile:update': (profile: { name?: string; avatar?: Avatar }) => void;
  'game:start': () => void;
  'word:pick': (payload: { index: number }) => void;
  /** A batch of finished operations from the drawer. */
  'draw:ops': (ops: DrawOpInput[]) => void;
  'draw:cursor': (cursor: { x: number; y: number; tool: Tool; width: number } | null) => void;
  'draw:undo': () => void;
  'draw:clear': () => void;
  'chat:send': (payload: { text: string }) => void;
  'vote:skip': () => void;
  'vote:kick': (payload: { playerId: string }) => void;
  'host:kick': (payload: { playerId: string }) => void;
}

export function isValidRoomCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    code.length === ROOM_CODE_LENGTH &&
    [...code.toUpperCase()].every((ch) => ROOM_CODE_ALPHABET.includes(ch))
  );
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}
