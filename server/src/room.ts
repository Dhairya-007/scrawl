import {
  DEFAULT_SETTINGS,
  PALETTE,
  RAPID_WORD_WINDOW,
  MAX_CHAT_LENGTH,
  MAX_OPS_PER_TURN,
  cleanName,
  cleanText,
  drawerPoints,
  guessPoints,
  hintsRevealedAt,
  isCloseGuess,
  isExactGuess,
  leaksWord,
  maskWord,
  planHints,
  sanitizeAvatar,
  sanitizeDrawOp,
  sanitizeSettings,
  toWordEntry,
  wordPool,
  type Avatar,
  type ChatMessage,
  type DrawOp,
  type GameEndPayload,
  type Phase,
  type Player,
  type RoomSettings,
  type ServerToClient,
  type StatePayload,
  type Tool,
  type Twist,
  type TurnEndPayload,
  type WordEntry,
} from '@scrawl/shared';
import { systemClock, type Clock } from './clock.js';
import { newMessageId, newPlayerId, shuffle } from './ids.js';

/** Seconds the drawer gets to choose a word before one is chosen for them. */
export const PICK_TIME_MS = 15_000;
/** How long the word and the turn's points stay on screen. */
export const TURN_END_MS = 6_000;
/** How often the drawing phase re-checks the clock and the hint schedule. */
export const TICK_MS = 400;
/** A dropped player keeps their seat and score this long. */
export const RECONNECT_GRACE_MS = 45_000;
/** An empty room is torn down after this long. */
export const EMPTY_ROOM_TTL_MS = 60_000;
/** How much public chat a newcomer is shown. */
export const CHAT_LOG_LIMIT = 60;

/**
 * Votes needed to skip a turn. With a single guesser their word is final, but
 * from two upwards it takes a clear majority, so one impatient player in a
 * three-player room cannot cut the drawer off.
 */
export function skipVotesNeeded(eligible: number): number {
  if (eligible <= 1) return 1;
  return Math.max(2, Math.ceil(eligible * 0.6));
}

/** Votes needed to kick someone, counted over everybody but the target. */
export function kickVotesNeeded(eligible: number): number {
  return Math.max(2, Math.ceil(eligible * 0.6));
}

export interface RoomTransport {
  emitToRoom<E extends keyof ServerToClient>(
    event: E,
    ...args: Parameters<ServerToClient[E]>
  ): void;
  emitToPlayer<E extends keyof ServerToClient>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClient[E]>
  ): void;
  /** Close the socket of a player who has been removed. */
  dropPlayer(playerId: string): void;
}

interface PlayerRecord extends Player {
  /** Stable across a reload, which is how a seat is recovered. */
  clientId: string;
  /** Set while the seat is being held open for a reconnect. */
  graceTimer: unknown;
}

export interface RoomOptions {
  code: string;
  settings?: Partial<RoomSettings>;
  clock?: Clock;
  random?: () => number;
  /** Called when the room has been empty long enough to discard. */
  onEmpty?: (code: string) => void;
}

/**
 * One game room: the players in it, the settings, the canvas and the turn
 * clock. Everything the engine needs is passed in, so a whole game can be
 * played out in a test without a socket or a real timer.
 */
export class Room {
  readonly code: string;
  settings: RoomSettings;

  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly onEmpty?: (code: string) => void;
  private transport: RoomTransport | null = null;

  private players = new Map<string, PlayerRecord>();
  /** Join order, which is the order the player list is drawn in. */
  private seating: string[] = [];
  private hostId = '';

  private phase: Phase = 'lobby';
  /** Set only during `turn-end`, when the answer is public. */
  private revealedWord: string | null = null;
  private round = 0;
  /** Ids in drawing order for the current round; may contain departed players. */
  private turnOrder: string[] = [];
  private turnIndex = -1;

  private entry: WordEntry | null = null;
  private choices: WordEntry[] = [];
  private hintPlan: number[] = [];
  private hintsShown = 0;
  /**
   * When the current word went up. In rapid fire a turn holds several words,
   * so hints and points are measured from the word rather than the turn.
   */
  private wordStart = 0;
  /** The span hints are spread over for the current word. */
  private hintWindow = 0;
  /** Words the drawer has already got through this turn (rapid fire). */
  private wordsCleared = 0;
  /** The only colour allowed this turn, under the `one-colour` twist. */
  private lockedColor: string | null = null;

  private deadline: number | null = null;
  private phaseLength: number | null = null;
  private phaseTimer: unknown = null;

  private ops: DrawOp[] = [];
  private nextOpId = 1;

  private guessOrder: string[] = [];
  private guessScores: number[] = [];
  private turnGains: Record<string, number> = {};

  private skipVotes = new Set<string>();
  private kickVotes = new Map<string, Set<string>>();
  /** Client ids removed by the host or a vote, barred for the room's life. */
  private banned = new Set<string>();
  /** Words already used this game, so a short game does not repeat itself. */
  private usedWords = new Set<string>();

  /** Recent room-wide chat, replayed to anyone who joins. */
  private chatLog: ChatMessage[] = [];

  private emptyTimer: unknown = null;
  private closed = false;

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.onEmpty = options.onEmpty;
    this.settings = sanitizeSettings(options.settings ?? {}, DEFAULT_SETTINGS);
    this.armEmptyTimer();
  }

  attach(transport: RoomTransport): void {
    this.transport = transport;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Players holding a seat, including ones in their reconnect grace period. */
  get playerCount(): number {
    return this.players.size;
  }

  /** Players actually present right now. */
  get presentCount(): number {
    return [...this.players.values()].filter((p) => !p.disconnected).length;
  }

  get isJoinable(): boolean {
    return !this.closed && this.players.size < this.settings.maxPlayers;
  }

  get isPublic(): boolean {
    return !this.settings.isPrivate;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** The canvas so far, for a player who has just been seated. */
  get canvasOps(): DrawOp[] {
    return [...this.ops];
  }

  /**
   * Chat a newcomer may see. Only messages that went to the whole room are
   * kept, so the private channels — what the guessers say to each other, and
   * the "close!" nudges — can never be replayed to somebody who was not there.
   */
  get publicChat(): ChatMessage[] {
    return [...this.chatLog];
  }

  isBannedClient(clientId: string): boolean {
    return this.banned.has(clientId);
  }

  hasName(name: string): boolean {
    const target = name.trim().toLowerCase();
    return [...this.players.values()].some((p) => p.name.toLowerCase() === target);
  }

  findSeatFor(clientId: string): string | null {
    for (const player of this.players.values()) {
      if (player.clientId === clientId) return player.id;
    }
    return null;
  }

  /** Players eligible to take a turn: present, seated and not spectating. */
  private playable(): PlayerRecord[] {
    return this.seating
      .map((id) => this.players.get(id))
      .filter((p): p is PlayerRecord => !!p && !p.spectating && !p.disconnected && !p.eliminated);
  }

  private get drawerId(): string | null {
    if (this.turnIndex < 0 || this.turnIndex >= this.turnOrder.length) return null;
    return this.turnOrder[this.turnIndex] ?? null;
  }

  private get inGame(): boolean {
    return this.phase === 'picking' || this.phase === 'drawing' || this.phase === 'turn-end';
  }

  // -------------------------------------------------------------------------
  // Joining and leaving
  // -------------------------------------------------------------------------

  /**
   * Seat a player, or hand back the seat they already had if they are
   * reconnecting with the same client id.
   */
  join(input: { clientId: string; name: string; avatar: Avatar }): { id: string; resumed: boolean } {
    this.clearEmptyTimer();

    const existingId = this.findSeatFor(input.clientId);
    if (existingId) {
      const player = this.players.get(existingId)!;
      if (player.graceTimer) {
        this.clock.clearTimeout(player.graceTimer);
        player.graceTimer = null;
      }
      player.disconnected = false;
      player.name = cleanName(input.name);
      this.system(`${player.name} is back`, 'join');
      this.broadcastState();
      return { id: player.id, resumed: true };
    }

    const id = newPlayerId();
    const player: PlayerRecord = {
      id,
      clientId: input.clientId,
      name: this.uniqueName(cleanName(input.name)),
      avatar: sanitizeAvatar(input.avatar),
      score: 0,
      lastGain: 0,
      isHost: this.players.size === 0,
      hasGuessed: false,
      disconnected: false,
      // Someone arriving mid-game watches until the next round begins.
      spectating: this.inGame,
      eliminated: false,
      graceTimer: null,
    };
    this.players.set(id, player);
    this.seating.push(id);
    if (player.isHost) this.hostId = id;

    this.chat({ kind: 'join', text: `${player.name} joined`, authorId: id, authorName: player.name });
    this.broadcastState();
    return { id, resumed: false };
  }

  private uniqueName(name: string): string {
    if (!this.hasName(name)) return name;
    for (let suffix = 2; suffix < 100; suffix++) {
      const candidate = `${name} ${suffix}`;
      if (!this.hasName(candidate)) return candidate;
    }
    return `${name} ${Math.floor(this.random() * 9000) + 1000}`;
  }

  /** The socket went away. Hold the seat briefly in case it was a reload. */
  disconnect(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.disconnected) return;
    player.disconnected = true;

    // A missing drawer stalls the game, so that turn ends straight away.
    if (this.drawerId === playerId && (this.phase === 'picking' || this.phase === 'drawing')) {
      this.endTurn('drawer-left');
    }

    player.graceTimer = this.clock.setTimeout(() => {
      player.graceTimer = null;
      this.remove(playerId, 'left');
    }, RECONNECT_GRACE_MS);

    this.checkViability();
    this.broadcastState();
  }

  /** Take the seat away for good. */
  remove(playerId: string, reason: 'left' | 'host' | 'vote'): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (player.graceTimer) this.clock.clearTimeout(player.graceTimer);

    this.players.delete(playerId);
    this.seating = this.seating.filter((id) => id !== playerId);
    this.skipVotes.delete(playerId);
    this.kickVotes.delete(playerId);
    for (const voters of this.kickVotes.values()) voters.delete(playerId);

    if (reason !== 'left') {
      this.banned.add(player.clientId);
      this.transport?.emitToPlayer(playerId, 'kicked', { reason });
      this.transport?.dropPlayer(playerId);
    }

    const verb = reason === 'left' ? 'left' : 'was kicked';
    this.chat({ kind: 'leave', text: `${player.name} ${verb}`, authorId: playerId, authorName: player.name });

    if (this.hostId === playerId) this.passHost();

    const wasDrawing = this.drawerId === playerId;
    if (this.players.size === 0) {
      this.resetToLobby(null);
      this.armEmptyTimer();
      this.broadcastState();
      return;
    }

    if (wasDrawing && (this.phase === 'picking' || this.phase === 'drawing')) {
      this.endTurn('drawer-left');
      return;
    }

    if (!this.checkViability()) this.evaluateTurnEnd();
    this.broadcastState();
  }

  private passHost(): void {
    const next = this.seating.find((id) => !this.players.get(id)?.disconnected) ?? this.seating[0];
    for (const player of this.players.values()) player.isHost = false;
    if (!next) {
      this.hostId = '';
      return;
    }
    this.hostId = next;
    const player = this.players.get(next);
    if (player) {
      player.isHost = true;
      this.system(`${player.name} is the new host`);
    }
  }

  /**
   * A game needs two players. Seats being held open for a reconnect still
   * count, so a dropped connection does not tear down everyone else's game;
   * the abort happens when a seat is actually given up.
   */
  private checkViability(): boolean {
    if (!this.inGame) return false;
    const seatsInPlay = [...this.players.values()].filter((p) => !p.spectating).length;
    if (seatsInPlay >= 2) return false;
    this.system('Not enough players — back to the lobby');
    this.resetToLobby('game-end-abort');
    this.broadcastState();
    return true;
  }

  private armEmptyTimer(): void {
    this.clearEmptyTimer();
    this.emptyTimer = this.clock.setTimeout(() => {
      this.emptyTimer = null;
      if (this.players.size === 0) {
        this.closed = true;
        this.onEmpty?.(this.code);
      }
    }, EMPTY_ROOM_TTL_MS);
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer) this.clock.clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  // -------------------------------------------------------------------------
  // Profile and settings
  // -------------------------------------------------------------------------

  updateProfile(playerId: string, profile: { name?: string; avatar?: Avatar }): void {
    const player = this.players.get(playerId);
    if (!player) return;
    // Changing identity mid-game would make the scoreboard nonsense.
    if (this.inGame) {
      this.notice(playerId, 'You can only change your look in the lobby', 'warn');
      return;
    }
    if (profile.name !== undefined) {
      const name = cleanName(profile.name);
      if (name.toLowerCase() !== player.name.toLowerCase()) player.name = this.uniqueName(name);
    }
    if (profile.avatar !== undefined) player.avatar = sanitizeAvatar(profile.avatar);
    this.broadcastState();
  }

  updateSettings(playerId: string, patch: Partial<RoomSettings>): void {
    if (playerId !== this.hostId) {
      this.notice(playerId, 'Only the host can change the settings', 'warn');
      return;
    }
    if (this.inGame) {
      this.notice(playerId, 'Settings are locked while a game is running', 'warn');
      return;
    }
    this.settings = sanitizeSettings({ ...this.settings, ...patch }, this.settings);
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Game flow
  // -------------------------------------------------------------------------

  startGame(playerId: string): void {
    if (playerId !== this.hostId) {
      this.notice(playerId, 'Only the host can start the game', 'warn');
      return;
    }
    if (this.inGame) return;

    const present = this.seating
      .map((id) => this.players.get(id))
      .filter((p): p is PlayerRecord => !!p && !p.disconnected);
    if (present.length < 2) {
      this.notice(playerId, 'You need at least 2 players', 'warn');
      return;
    }
    if (this.poolFor().length === 0) {
      this.notice(playerId, 'No words available — check the word settings', 'error');
      return;
    }

    for (const player of this.players.values()) {
      player.score = 0;
      player.lastGain = 0;
      player.hasGuessed = false;
      player.spectating = player.disconnected;
      player.eliminated = false;
    }
    this.usedWords.clear();
    this.round = 1;
    this.turnOrder = shuffle(present.map((p) => p.id), this.random);
    this.turnIndex = 0;
    this.system(`Round 1 of ${this.settings.rounds}`);
    this.beginTurn();
  }

  /** Word pool for this room, given the word-mode setting. */
  private poolFor(): WordEntry[] {
    const custom = this.settings.customWords.map((word) => toWordEntry(word));
    switch (this.settings.wordMode) {
      case 'custom-only':
        return custom;
      case 'mixed':
        return [...wordPool(this.settings.language), ...custom];
      default:
        return wordPool(this.settings.language);
    }
  }

  private drawChoices(): WordEntry[] {
    const pool = this.poolFor();
    if (pool.length === 0) return [];
    let available = pool.filter((entry) => !this.usedWords.has(entry.word));
    // A long game in a small pool starts again rather than running dry.
    if (available.length < this.settings.wordCount) {
      this.usedWords.clear();
      available = pool;
    }
    const picked: WordEntry[] = [];
    const taken = new Set<number>();
    const wanted = Math.min(this.settings.wordCount, available.length);
    while (picked.length < wanted) {
      const index = Math.floor(this.random() * available.length);
      if (taken.has(index)) continue;
      taken.add(index);
      picked.push(available[index]!);
    }
    return picked;
  }

  private beginTurn(): void {
    const drawer = this.drawerId ? this.players.get(this.drawerId) : null;
    if (!drawer || drawer.disconnected || drawer.spectating) {
      this.advanceTurn();
      return;
    }

    this.ops = [];
    this.entry = null;
    this.hintPlan = [];
    this.hintsShown = 0;
    this.guessOrder = [];
    this.guessScores = [];
    this.turnGains = {};
    this.skipVotes.clear();
    for (const player of this.players.values()) {
      player.hasGuessed = false;
      player.lastGain = 0;
    }

    this.wordsCleared = 0;
    // The locked colour is rolled once a turn, so a drawer cannot reroll it.
    this.lockedColor = this.settings.twists.includes('one-colour')
      ? PALETTE[Math.floor(this.random() * PALETTE.length)]!
      : null;

    this.choices = this.drawChoices();
    if (this.choices.length === 0) {
      this.system('Ran out of words — back to the lobby');
      this.resetToLobby('no-words');
      this.broadcastState();
      return;
    }

    this.transport?.emitToRoom('draw:sync', []);
    this.transport?.emitToRoom('draw:cursor', null);
    this.transport?.emitToRoom('turn:start', { drawerId: drawer.id, round: this.round });

    if (this.settings.mode === 'rapid') {
      // No picking in rapid fire: the clock belongs to the turn, and words
      // are handed over one after another inside it.
      this.phase = 'drawing';
      this.setPhaseClock(this.settings.drawTime * 1000, null);
      this.startWord(this.choices[0]!);
      this.choices = [];
      this.scheduleTick();
      this.broadcastState();
      return;
    }

    this.phase = 'picking';
    this.setPhaseClock(PICK_TIME_MS, () => {
      // Nobody chose, so the first option is used.
      this.chooseWord(drawer.id, 0, true);
    });
    this.broadcastState();
  }

  /** Put a word up: plan its hints and start its own clock. */
  private startWord(entry: WordEntry): void {
    this.entry = entry;
    this.usedWords.add(entry.word);
    this.hintPlan = planHints(entry.word, this.settings.hints, this.random);
    this.hintsShown = 0;
    this.wordStart = this.clock.now();
    this.hintWindow =
      this.settings.mode === 'rapid'
        ? RAPID_WORD_WINDOW * 1000
        : this.settings.drawTime * 1000;
    for (const player of this.players.values()) player.hasGuessed = false;
  }

  /** Rapid fire: wipe the canvas and hand the drawer the next word. */
  private nextRapidWord(): void {
    const next = this.drawChoices()[0];
    if (!next) {
      this.endTurn('time');
      return;
    }
    this.wordsCleared++;
    this.ops = [];
    this.guessOrder = [];
    this.guessScores = [];
    this.transport?.emitToRoom('draw:sync', []);
    this.transport?.emitToRoom('draw:cursor', null);
    this.startWord(next);
    this.broadcastState();
  }

  chooseWord(playerId: string, index: number, auto = false): void {
    if (this.phase !== 'picking') return;
    if (playerId !== this.drawerId) return;
    const entry = this.choices[index] ?? this.choices[0];
    if (!entry) return;

    this.choices = [];
    this.phase = 'drawing';
    this.setPhaseClock(this.settings.drawTime * 1000, null);
    this.startWord(entry);
    this.scheduleTick();
    if (auto) this.notice(playerId, 'Time was up, so a word was picked for you', 'info');
    this.broadcastState();
  }

  /** Runs through the drawing phase, moving hints along and watching the clock. */
  private scheduleTick(): void {
    this.phaseTimer = this.clock.setTimeout(() => {
      this.phaseTimer = null;
      if (this.phase !== 'drawing' || this.deadline === null) return;

      const now = this.clock.now();
      if (now >= this.deadline) {
        this.endTurn('time');
        return;
      }

      const elapsed = now - this.wordStart;
      const shown = hintsRevealedAt(elapsed, this.hintWindow, this.hintPlan.length);
      if (shown !== this.hintsShown) {
        this.hintsShown = shown;
        this.broadcastState();
      }
      this.scheduleTick();
    }, TICK_MS);
  }

  private setPhaseClock(ms: number, onExpiry: (() => void) | null): void {
    if (this.phaseTimer) this.clock.clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.phaseLength = ms;
    this.deadline = this.clock.now() + ms;
    if (onExpiry) {
      this.phaseTimer = this.clock.setTimeout(() => {
        this.phaseTimer = null;
        onExpiry();
      }, ms);
    }
  }

  private clearPhaseClock(): void {
    if (this.phaseTimer) this.clock.clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.deadline = null;
    this.phaseLength = null;
  }

  private endTurn(reason: TurnEndPayload['reason']): void {
    if (this.phase !== 'picking' && this.phase !== 'drawing') return;
    const word = this.entry?.word ?? this.choices[0]?.word ?? '';
    const drawerId = this.drawerId;
    this.clearPhaseClock();

    // The drawer is paid out of what the guessers earned, and nothing at all
    // if the turn was skipped or abandoned.
    if (
      drawerId &&
      reason !== 'skipped' &&
      reason !== 'drawer-left' &&
      // A rapid-fire drawer was already paid, word by word.
      this.settings.mode !== 'rapid'
    ) {
      const payout = drawerPoints(this.guessScores);
      if (payout > 0) {
        const drawer = this.players.get(drawerId);
        if (drawer) {
          drawer.score += payout;
          drawer.lastGain = payout;
          this.turnGains[drawerId] = payout;
        }
      }
    }

    this.entry = null;
    this.phase = 'turn-end';
    const payload: TurnEndPayload = { word, gains: { ...this.turnGains }, reason };
    this.transport?.emitToRoom('turn:end', payload);
    this.transport?.emitToRoom('draw:cursor', null);
    this.revealedWord = word;

    this.setPhaseClock(TURN_END_MS, () => this.advanceTurn());
    this.broadcastState();
  }

  private advanceTurn(): void {
    this.revealedWord = null;
    this.clearPhaseClock();
    if (this.closed) return;

    // Step past anyone who has gone.
    let next = this.turnIndex + 1;
    while (next < this.turnOrder.length) {
      const candidate = this.players.get(this.turnOrder[next]!);
      if (candidate && !candidate.disconnected && !candidate.spectating) break;
      next++;
    }

    if (next < this.turnOrder.length) {
      this.turnIndex = next;
      this.beginTurn();
      return;
    }

    // End of the round.
    if (this.settings.mode === 'sudden-death') this.eliminateLowest();

    if (this.round >= this.settings.rounds) {
      this.endGame();
      return;
    }
    this.round++;
    // Anyone who joined mid-game starts playing now. The knocked-out stay out.
    for (const player of this.players.values()) {
      if (player.spectating && !player.disconnected && !player.eliminated) {
        player.spectating = false;
      }
    }
    const roster = this.playable();
    if (roster.length < 2) {
      this.endGame();
      return;
    }
    this.turnOrder = roster.map((p) => p.id);
    this.turnIndex = 0;
    this.system(`Round ${this.round} of ${this.settings.rounds}`);
    this.beginTurn();
  }

  /**
   * Sudden death: the lowest scorer drops out at the end of every round. A
   * knocked-out player keeps watching, and sees the word, so they have no way
   * to spoil it for anyone still in.
   */
  private eliminateLowest(): void {
    const contenders = [...this.players.values()].filter((p) => !p.eliminated && !p.spectating);
    if (contenders.length < 2) return;

    const lowest = Math.min(...contenders.map((p) => p.score));
    const doomed = contenders.filter((p) => p.score === lowest);
    // If everybody is level, knocking them all out would empty the game.
    if (doomed.length === contenders.length) {
      this.system('Everyone is level — nobody goes out this round');
      return;
    }
    for (const player of doomed) {
      player.eliminated = true;
      player.spectating = true;
      player.hasGuessed = false;
      this.system(`${player.name} is knocked out on ${player.score} points`);
    }
  }

  private endGame(): void {
    this.clearPhaseClock();
    this.phase = 'game-end';
    this.entry = null;
    this.choices = [];
    this.revealedWord = null;

    // In sudden death the winner is whoever is left, not the top scorer, so
    // survivors are ranked above the knocked-out before score is considered.
    const standings: GameEndPayload['standings'] = [...this.players.values()]
      .sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score)
      .map(({ id, name, avatar, score }) => ({ id, name, avatar, score }));
    this.transport?.emitToRoom('game:end', { standings });

    const winner = standings[0];
    if (winner) this.system(`${winner.name} wins with ${winner.score} points`);
    this.broadcastState();
  }

  private resetToLobby(_reason: string | null): void {
    this.clearPhaseClock();
    this.phase = 'lobby';
    this.round = 0;
    this.turnOrder = [];
    this.turnIndex = -1;
    this.entry = null;
    this.choices = [];
    this.revealedWord = null;
    this.wordsCleared = 0;
    this.lockedColor = null;
    this.ops = [];
    this.guessOrder = [];
    this.guessScores = [];
    this.turnGains = {};
    this.skipVotes.clear();
    this.kickVotes.clear();
    for (const player of this.players.values()) {
      player.hasGuessed = false;
      player.spectating = false;
      player.eliminated = false;
    }
    this.transport?.emitToRoom('draw:sync', []);
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /** Whether a twist is switched on for this room. */
  private hasTwist(twist: Twist): boolean {
    return this.settings.twists.includes(twist);
  }

  addOps(playerId: string, raw: unknown): void {
    if (this.phase !== 'drawing' || playerId !== this.drawerId) return;
    if (!Array.isArray(raw)) return;

    const noTakebacks = this.hasTwist('no-takebacks');
    const locked = this.lockedColor?.toLowerCase() ?? null;

    const accepted: DrawOp[] = [];
    for (const candidate of raw.slice(0, 64)) {
      if (this.ops.length >= MAX_OPS_PER_TURN) {
        this.notice(playerId, 'Canvas is full for this turn', 'warn');
        break;
      }
      const op = sanitizeDrawOp(candidate, this.nextOpId);
      if (!op) continue;

      // Twists are enforced here rather than only in the toolbar, so a
      // hand-rolled client cannot opt out of them.
      if (noTakebacks && (op.kind === 'clear' || (op.kind === 'stroke' && op.tool === 'eraser'))) {
        this.notice(playerId, 'No take-backs this game!', 'warn');
        continue;
      }
      if (locked && op.kind !== 'clear' && op.color.toLowerCase() !== locked) continue;

      this.nextOpId++;
      if (op.kind === 'clear') {
        this.ops = [op];
        this.transport?.emitToRoom('draw:sync', this.ops);
        accepted.length = 0;
        continue;
      }
      this.ops.push(op);
      accepted.push(op);
    }
    if (accepted.length > 0) this.transport?.emitToRoom('draw:ops', accepted);
  }

  setCursor(playerId: string, cursor: { x: number; y: number; tool: Tool; width: number } | null): void {
    if (this.phase !== 'drawing' || playerId !== this.drawerId) return;
    this.transport?.emitToRoom('draw:cursor', cursor);
  }

  undo(playerId: string): void {
    if (this.phase !== 'drawing' || playerId !== this.drawerId) return;
    if (this.hasTwist('no-takebacks')) {
      this.notice(playerId, 'No take-backs this game!', 'warn');
      return;
    }
    const last = this.ops.at(-1);
    if (!last) return;

    if (last.kind === 'stroke') {
      // Drop every trailing segment of the same drag, not just the last one.
      while (this.ops.length > 0) {
        const op = this.ops.at(-1)!;
        if (op.kind !== 'stroke' || op.group !== last.group) break;
        this.ops.pop();
      }
    } else {
      this.ops.pop();
    }
    this.transport?.emitToRoom('draw:sync', this.ops);
  }

  clearCanvas(playerId: string): void {
    if (this.phase !== 'drawing' || playerId !== this.drawerId) return;
    if (this.hasTwist('no-takebacks')) {
      this.notice(playerId, 'No take-backs this game!', 'warn');
      return;
    }
    this.ops = [];
    this.transport?.emitToRoom('draw:sync', []);
  }

  // -------------------------------------------------------------------------
  // Chat and guessing
  // -------------------------------------------------------------------------

  say(playerId: string, rawText: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = cleanText(rawText, MAX_CHAT_LENGTH);
    if (text.length === 0) return;

    const isDrawer = playerId === this.drawerId;

    // Outside a live turn there is nothing to protect, so everyone talks.
    if (this.phase !== 'drawing' || !this.entry) {
      this.chat({ kind: 'say', text, authorId: playerId, authorName: player.name });
      return;
    }

    if (isDrawer) {
      if (leaksWord(text, this.entry)) {
        this.notice(playerId, 'No telling them the word!', 'warn');
        return;
      }
      this.chat({ kind: 'say', text, authorId: playerId, authorName: player.name });
      return;
    }

    // Players who already have the word talk only among themselves, so they
    // cannot hand it to anyone still guessing.
    if (player.hasGuessed || player.spectating) {
      this.chat(
        { kind: 'insider', text, authorId: playerId, authorName: player.name },
        this.insiders(),
      );
      return;
    }

    if (isExactGuess(text, this.entry)) {
      this.awardGuess(player);
      return;
    }

    if (isCloseGuess(text, this.entry)) {
      this.chat({ kind: 'say', text, authorId: playerId, authorName: player.name });
      this.chat({ kind: 'close', text: `"${text}" is close!` }, [playerId]);
      return;
    }

    this.chat({ kind: 'say', text, authorId: playerId, authorName: player.name });
  }

  /** Who may see insider chat: everyone holding the word. */
  private insiders(): string[] {
    const ids = [...this.players.values()]
      .filter((p) => p.hasGuessed || p.spectating)
      .map((p) => p.id);
    if (this.drawerId) ids.push(this.drawerId);
    return [...new Set(ids)];
  }

  private awardGuess(player: PlayerRecord): void {
    player.hasGuessed = true;
    const rapid = this.settings.mode === 'rapid';

    // In rapid fire the turn clock covers many words, so a guess is scored
    // against its own word's window instead.
    const window = rapid ? RAPID_WORD_WINDOW : this.settings.drawTime;
    const secondsLeft = rapid
      ? Math.max(0, window - (this.clock.now() - this.wordStart) / 1000)
      : this.deadline
        ? Math.max(0, (this.deadline - this.clock.now()) / 1000)
        : 0;

    const points = guessPoints({ secondsLeft, drawTime: window, order: this.guessOrder.length });
    player.score += points;
    player.lastGain = points;
    this.turnGains[player.id] = (this.turnGains[player.id] ?? 0) + points;
    this.guessOrder.push(player.id);
    this.guessScores.push(points);

    const place = this.guessOrder.length === 1 && !rapid ? ' first' : '';
    this.chat({
      kind: 'correct',
      text: `${player.name} got it${place}!`,
      authorId: player.id,
      authorName: player.name,
    });

    if (rapid) {
      // The drawer is paid for each word as it falls, then the next goes up.
      const drawerId = this.drawerId;
      const payout = drawerPoints([points]);
      if (drawerId && payout > 0) {
        const drawer = this.players.get(drawerId);
        if (drawer) {
          drawer.score += payout;
          drawer.lastGain = payout;
          this.turnGains[drawerId] = (this.turnGains[drawerId] ?? 0) + payout;
        }
      }
      this.nextRapidWord();
      return;
    }

    this.broadcastState();
    this.evaluateTurnEnd();
  }

  /** End the turn early once there is nobody left to guess. */
  private evaluateTurnEnd(): void {
    if (this.phase !== 'drawing') return;
    // Rapid fire moves to the next word instead of ending the turn.
    if (this.settings.mode === 'rapid') return;
    const guessers = this.playable().filter((p) => p.id !== this.drawerId);
    if (guessers.length > 0 && guessers.every((p) => p.hasGuessed)) {
      this.endTurn('all-guessed');
    }
  }

  // -------------------------------------------------------------------------
  // Votes and moderation
  // -------------------------------------------------------------------------

  voteSkip(playerId: string): void {
    if (this.phase !== 'drawing' && this.phase !== 'picking') return;
    const player = this.players.get(playerId);
    if (!player || player.spectating) return;
    if (playerId === this.drawerId) {
      // The drawer does not vote, they simply give up the turn.
      this.endTurn('skipped');
      return;
    }
    if (this.skipVotes.has(playerId)) {
      this.skipVotes.delete(playerId);
    } else {
      this.skipVotes.add(playerId);
    }

    const eligible = this.playable().filter((p) => p.id !== this.drawerId).length;
    const needed = skipVotesNeeded(eligible);
    if (eligible > 0 && this.skipVotes.size >= needed) {
      this.system('The turn was skipped');
      this.endTurn('skipped');
      return;
    }
    this.broadcastState();
  }

  voteKick(playerId: string, targetId: string): void {
    const voter = this.players.get(playerId);
    const target = this.players.get(targetId);
    if (!voter || !target || playerId === targetId) return;
    if (target.id === this.hostId) {
      this.notice(playerId, 'The host cannot be voted out', 'warn');
      return;
    }

    const voters = this.kickVotes.get(targetId) ?? new Set<string>();
    if (voters.has(playerId)) return;
    voters.add(playerId);
    this.kickVotes.set(targetId, voters);

    const needed = kickVotesNeeded(this.players.size - 1);
    if (voters.size >= needed) {
      this.remove(targetId, 'vote');
      return;
    }
    this.system(`${voters.size}/${needed} votes to kick ${target.name}`);
    this.broadcastState();
  }

  hostKick(playerId: string, targetId: string): void {
    if (playerId !== this.hostId) {
      this.notice(playerId, 'Only the host can kick', 'warn');
      return;
    }
    if (playerId === targetId) return;
    if (!this.players.has(targetId)) return;
    this.remove(targetId, 'host');
  }

  // -------------------------------------------------------------------------
  // Emitting
  // -------------------------------------------------------------------------

  private chat(
    message: Omit<ChatMessage, 'id' | 'at'>,
    onlyTo?: string[],
  ): void {
    const full: ChatMessage = { ...message, id: newMessageId(), at: this.clock.now() };
    if (onlyTo) {
      for (const id of onlyTo) this.transport?.emitToPlayer(id, 'chat', full);
      return;
    }
    this.transport?.emitToRoom('chat', full);
    this.chatLog.push(full);
    if (this.chatLog.length > CHAT_LOG_LIMIT) this.chatLog.shift();
  }

  private system(text: string, kind: ChatMessage['kind'] = 'system'): void {
    this.chat({ kind, text });
  }

  private notice(playerId: string, text: string, tone: 'info' | 'warn' | 'error'): void {
    this.transport?.emitToPlayer(playerId, 'notice', { text, tone });
  }

  /** What one player is allowed to know about the room right now. */
  stateFor(playerId: string): StatePayload {
    const viewer = this.players.get(playerId);
    const isDrawer = playerId === this.drawerId;
    const guessed = !!viewer?.hasGuessed || !!viewer?.spectating;
    const word = this.entry?.word ?? null;

    let pattern = '';
    if (word) {
      pattern = isDrawer || guessed ? word : maskWord(word, this.hintPlan.slice(0, this.hintsShown));
    } else if (this.revealedWord) {
      pattern = this.revealedWord;
    }

    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      players: this.seating
        .map((id) => this.players.get(id))
        .filter((p): p is PlayerRecord => !!p)
        .map(({ graceTimer: _graceTimer, clientId: _clientId, ...player }) => player),
      hostId: this.hostId,
      round: this.round,
      drawerId: this.drawerId,
      deadline: this.deadline,
      phaseLength: this.phaseLength,
      wordPattern: pattern,
      revealedWord: this.revealedWord,
      skipVotes: [...this.skipVotes],
      wordsCleared: this.wordsCleared,
      lockedColor: this.lockedColor,
      serverNow: this.clock.now(),
      youAreDrawing: isDrawer,
      youGuessed: guessed,
      wordChoices:
        isDrawer && this.phase === 'picking' ? this.choices.map((entry) => entry.word) : null,
    };
  }

  broadcastState(): void {
    if (!this.transport) return;
    for (const id of this.players.keys()) {
      this.transport.emitToPlayer(id, 'state', this.stateFor(id));
    }
  }

  /** Tear the room down and release its timers. */
  close(): void {
    this.closed = true;
    this.clearPhaseClock();
    this.clearEmptyTimer();
    for (const player of this.players.values()) {
      if (player.graceTimer) this.clock.clearTimeout(player.graceTimer);
    }
    this.players.clear();
    this.seating = [];
  }
}
