/** Domain types shared by the server game engine and the browser client. */

export type LanguageId = 'en' | 'es' | 'fr' | 'de' | 'hi' | 'nl';

/**
 * How a game is played.
 * - `classic`: one word per turn, the drawer picks it.
 * - `rapid`: words chain inside a single timed turn — the moment somebody
 *   gets one, the canvas wipes and the drawer is handed the next.
 * - `sudden-death`: classic scoring, but the lowest scorer is knocked out at
 *   the end of every round until one player is left.
 */
export type GameMode = 'classic' | 'rapid' | 'sudden-death';

/**
 * Optional rule changes that stack on top of any mode.
 * - `mirror`: the drawer's strokes come out flipped left to right.
 * - `no-takebacks`: no eraser, no undo, no clearing.
 * - `one-colour`: the drawer is locked to a single colour, picked per turn.
 */
export type Twist = 'mirror' | 'no-takebacks' | 'one-colour';

export const TWISTS: Twist[] = ['mirror', 'no-takebacks', 'one-colour'];

/** How the word pool for a game is assembled. */
export type WordMode = 'standard' | 'mixed' | 'custom-only';

export interface RoomSettings {
  mode: GameMode;
  /** Rule changes layered on the mode; order is not significant. */
  twists: Twist[];
  /** 2..20 */
  maxPlayers: number;
  language: LanguageId;
  /** Seconds the drawer gets per turn, 20..240. */
  drawTime: number;
  /** Turns per player per game, 2..10. */
  rounds: number;
  /** How many words the drawer chooses between, 1..5. */
  wordCount: number;
  /** How many letters get revealed as hints, 0..5. */
  hints: number;
  wordMode: WordMode;
  /** Host-supplied words, already trimmed and de-duplicated. */
  customWords: string[];
  /** Private rooms are never handed out by matchmaking. */
  isPrivate: boolean;
}

/** Each field indexes into the option arrays in `avatar.ts`. */
export interface Avatar {
  color: number;
  face: number;
  eyes: number;
  mouth: number;
  hat: number;
}

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  /** Points earned on the turn being shown, used by the turn scoreboard. */
  lastGain: number;
  isHost: boolean;
  /** True once this player has the current word right. */
  hasGuessed: boolean;
  /** Set while the player's socket is gone but their seat is held open. */
  disconnected: boolean;
  /** Spectators joined mid-game and play from the next game on. */
  spectating: boolean;
  /** Knocked out in sudden death. Watches the rest of the game. */
  eliminated: boolean;
}

export type Phase =
  /** Waiting for the host to start. */
  | 'lobby'
  /** The drawer is choosing a word. */
  | 'picking'
  /** The drawer is drawing and everyone else is guessing. */
  | 'drawing'
  /** The word is revealed and turn points are shown. */
  | 'turn-end'
  /** Final standings. */
  | 'game-end';

export interface PublicState {
  code: string;
  phase: Phase;
  settings: RoomSettings;
  players: Player[];
  hostId: string;
  /** 1-based; 0 outside a game. */
  round: number;
  drawerId: string | null;
  /** Server clock at which the current phase ends, ms since epoch. */
  deadline: number | null;
  /** Full phase length in ms, so clients can draw a progress bar. */
  phaseLength: number | null;
  /**
   * Masked word for guessers ("_ _ _ _" with revealed hint letters), or the
   * real word for the drawer and for anyone who already guessed it.
   */
  wordPattern: string;
  /** Only sent once the turn is over. */
  revealedWord: string | null;
  /** Ids of players who voted to skip the current turn. */
  skipVotes: string[];
  /** Words the drawer has already got through this turn, in rapid fire. */
  wordsCleared: number;
  /** The only colour allowed this turn, under the `one-colour` twist. */
  lockedColor: string | null;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** The canvas is replayed at this fixed internal size on every client. */
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;

export type Tool = 'brush' | 'eraser' | 'fill';

export interface StrokeOp {
  kind: 'stroke';
  id: number;
  /**
   * Segments of one unbroken drag share a group. The drawer streams a long
   * stroke in pieces so guessers see it appear live, and undo removes the
   * whole group rather than the last piece.
   */
  group: number;
  tool: 'brush' | 'eraser';
  color: string;
  width: number;
  /** Flat [x0, y0, x1, y1, ...] in canvas pixels; a single point is a dot. */
  points: number[];
}

export interface FillOp {
  kind: 'fill';
  id: number;
  color: string;
  x: number;
  y: number;
}

export interface ClearOp {
  kind: 'clear';
  id: number;
}

export type DrawOp = StrokeOp | FillOp | ClearOp;

/**
 * An operation as the drawer sends it, before the server stamps an id.
 * Spelled out per member because `Omit` over a union keeps only the keys
 * every member shares, which would drop `points`, `color` and the rest.
 */
export type DrawOpInput = Omit<StrokeOp, 'id'> | Omit<FillOp, 'id'> | Omit<ClearOp, 'id'>;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatKind =
  /** An ordinary guess or remark. */
  | 'say'
  /** Visible only to players who already guessed, plus the drawer. */
  | 'insider'
  /** Neutral server notice. */
  | 'system'
  /** Someone got the word. */
  | 'correct'
  /** "'tree' is close!", sent only to the one player. */
  | 'close'
  /** A player joined. */
  | 'join'
  /** A player left. */
  | 'leave';

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  /** Absent for server notices. */
  authorId?: string;
  authorName?: string;
  text: string;
  at: number;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * A word in a pool. Pools are mostly plain strings; the object form carries
 * extra spellings that also count as correct, which is what makes a
 * non-Latin-script pool playable for people typing a romanised guess.
 */
export interface WordEntry {
  word: string;
  alts?: string[];
}

export type PoolWord = string | WordEntry;
