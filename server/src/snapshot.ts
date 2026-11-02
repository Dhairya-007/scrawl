import type {
  ChatMessage,
  DrawOp,
  Phase,
  Player,
  RoomSettings,
  WordEntry,
} from '@scrawl/shared';

/** Bumped when the shape changes, so stale rooms are dropped rather than crash. */
export const SNAPSHOT_VERSION = 1;

/** A seated player as stored: the live timer handle is not serialisable. */
export interface StoredPlayer extends Player {
  clientId: string;
  graceUntil: number | null;
}

/**
 * A whole room as plain JSON. This is what lets the engine run somewhere
 * without a long-lived process: the room is rebuilt from here on each
 * request, caught up, acted on, and written back.
 */
export interface RoomSnapshot {
  version: number;
  code: string;
  settings: RoomSettings;
  players: StoredPlayer[];
  seating: string[];
  hostId: string;
  phase: Phase;
  revealedWord: string | null;
  round: number;
  turnOrder: string[];
  turnIndex: number;
  entry: WordEntry | null;
  choices: WordEntry[];
  hintPlan: number[];
  hintsShown: number;
  wordStart: number;
  hintWindow: number;
  wordsCleared: number;
  lockedColor: string | null;
  deadline: number | null;
  phaseLength: number | null;
  ops: DrawOp[];
  nextOpId: number;
  guessOrder: string[];
  guessScores: number[];
  turnGains: Record<string, number>;
  skipVotes: string[];
  kickVotes: Array<[string, string[]]>;
  banned: string[];
  usedWords: string[];
  chatLog: ChatMessage[];
  closed: boolean;
  /** The clock reading when this was written, which is where time resumes. */
  savedAt: number;
  /** Events waiting to be collected by polling clients. */
  events: LoggedEvent[];
  nextSeq: number;
}

/**
 * An event the engine emitted, held until each client has polled for it.
 * `to` is null for the whole room, or a player id for a private one.
 */
export interface LoggedEvent {
  seq: number;
  to: string | null;
  event: string;
  args: unknown[];
}

/** Events kept per room. Older ones fall off; a client that far behind resyncs. */
export const EVENT_LOG_LIMIT = 400;
