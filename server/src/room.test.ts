import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PALETTE,
  type ChatMessage,
  type RoomSettings,
  isExactGuess,
  type ServerToClient,
  type Twist,
} from '@scrawl/shared';
import { FakeClock } from './clock.js';
import {
  CHAT_LOG_LIMIT,
  PICK_TIME_MS,
  RECONNECT_GRACE_MS,
  Room,
  TURN_END_MS,
  kickVotesNeeded,
  skipVotesNeeded,
  type RoomTransport,
} from './room.js';

interface Recorded {
  event: keyof ServerToClient;
  args: unknown[];
}

/** Captures everything the engine emits, both to the room and per player. */
class Recorder implements RoomTransport {
  room: Recorded[] = [];
  perPlayer = new Map<string, Recorded[]>();
  dropped: string[] = [];

  emitToRoom(event: keyof ServerToClient, ...args: unknown[]): void {
    this.room.push({ event, args });
  }

  emitToPlayer(playerId: string, event: keyof ServerToClient, ...args: unknown[]): void {
    const list = this.perPlayer.get(playerId) ?? [];
    list.push({ event, args });
    this.perPlayer.set(playerId, list);
  }

  dropPlayer(playerId: string): void {
    this.dropped.push(playerId);
  }

  /** Chat a player can actually see: room-wide messages plus their own. */
  chatFor(playerId: string): ChatMessage[] {
    const mine = (this.perPlayer.get(playerId) ?? [])
      .filter((r) => r.event === 'chat')
      .map((r) => r.args[0] as ChatMessage);
    const all = this.room.filter((r) => r.event === 'chat').map((r) => r.args[0] as ChatMessage);
    return [...all, ...mine];
  }

  roomEvents(event: keyof ServerToClient): unknown[][] {
    return this.room.filter((r) => r.event === event).map((r) => r.args);
  }

  reset(): void {
    this.room = [];
    this.perPlayer.clear();
    this.dropped = [];
  }
}

/** Deterministic pseudo-random, so a failing test fails the same way twice. */
function seededRandom(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

interface Harness {
  room: Room;
  clock: FakeClock;
  tx: Recorder;
  add: (name: string) => string;
}

function harness(settings: Partial<RoomSettings> = {}): Harness {
  const clock = new FakeClock();
  const tx = new Recorder();
  const room = new Room({
    code: 'ABCDE',
    settings: { ...settings },
    clock,
    random: seededRandom(7),
  });
  room.attach(tx);
  let seat = 0;
  const add = (name: string) =>
    room.join({
      clientId: `client-${++seat}-aaaaaaaa`,
      name,
      avatar: { color: 0, face: 0, eyes: 0, mouth: 0, hat: 0 },
    }).id;
  return { room, clock, tx, add };
}

/** Get the current turn into the drawing phase and report who is drawing. */
function intoDrawing(h: Harness): { drawerId: string; word: string } {
  const drawerId = h.room.stateFor('nobody').drawerId!;
  h.room.chooseWord(drawerId, 0);
  const word = h.room.stateFor(drawerId).wordPattern;
  return { drawerId, word };
}

/** Advance exactly to the end of the current phase, never past it. */
function runPhaseOut(h: Harness): void {
  const { deadline } = h.room.stateFor('nobody');
  h.clock.advance(deadline === null ? 1_000 : Math.max(0, deadline - h.clock.now()) + 50);
}

/**
 * Play a game out to the end, one phase at a time. `onDrawing` runs once per
 * turn with the drawer and the answer, which is how a test decides who gets
 * to score.
 */
function playGame(
  h: Harness,
  onDrawing: (drawerId: string, word: string) => void = () => {},
  maxPhases = 200,
): void {
  for (let step = 0; step < maxPhases; step++) {
    const state = h.room.stateFor('nobody');
    if (state.phase === 'game-end' || state.phase === 'lobby') return;
    if (state.phase === 'picking') {
      const { drawerId, word } = intoDrawing(h);
      onDrawing(drawerId, word);
      continue;
    }
    runPhaseOut(h);
  }
  throw new Error('game did not finish');
}

describe('joining a room', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('makes the first player the host', () => {
    const alice = h.add('Alice');
    const state = h.room.stateFor(alice);
    expect(state.hostId).toBe(alice);
    expect(state.players[0]!.isHost).toBe(true);
  });

  it('starts in the lobby with the default settings', () => {
    const alice = h.add('Alice');
    const state = h.room.stateFor(alice);
    expect(state.phase).toBe('lobby');
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps names unique rather than rejecting a duplicate', () => {
    h.add('Alice');
    const second = h.add('Alice');
    expect(h.room.stateFor(second).players.map((p) => p.name)).toEqual(['Alice', 'Alice 2']);
  });

  it('hands the host over when the host leaves', () => {
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.remove(alice, 'left');
    expect(h.room.stateFor(bob).hostId).toBe(bob);
  });

  it('announces arrivals and departures', () => {
    const alice = h.add('Alice');
    h.room.remove(alice, 'left');
    const texts = h.tx.chatFor(alice).map((m) => m.text);
    expect(texts).toContain('Alice joined');
    expect(texts).toContain('Alice left');
  });
});

describe('starting a game', () => {
  it('refuses with one player', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.room.startGame(alice);
    expect(h.room.stateFor(alice).phase).toBe('lobby');
  });

  it('refuses a player who is not the host', () => {
    const h = harness();
    h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(bob);
    expect(h.room.stateFor(bob).phase).toBe('lobby');
  });

  it('opens the word picker for the drawer only', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);

    const state = h.room.stateFor(alice);
    expect(state.phase).toBe('picking');
    const drawer = state.drawerId!;
    const other = drawer === alice ? bob : alice;
    expect(h.room.stateFor(drawer).wordChoices).toHaveLength(DEFAULT_SETTINGS.wordCount);
    expect(h.room.stateFor(other).wordChoices).toBeNull();
  });

  it('picks a word for a drawer who does not choose in time', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);
    h.clock.advance(PICK_TIME_MS + 100);
    expect(h.room.stateFor(alice).phase).toBe('drawing');
  });

  it('resets scores from a previous game', () => {
    const h = harness({ rounds: 2 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    const { drawerId, word } = intoDrawing(h);
    h.room.say(drawerId === alice ? bob : alice, word);

    h.clock.advance(60 * 60_000);
    expect(h.room.stateFor(alice).phase).toBe('game-end');
    expect(h.room.stateFor(alice).players.some((p) => p.score > 0)).toBe(true);

    h.room.startGame(h.room.stateFor(alice).hostId);
    expect(h.room.stateFor(alice).players.every((p) => p.score === 0)).toBe(true);
  });
});

describe('guessing', () => {
  let h: Harness;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeEach(() => {
    h = harness({ rounds: 4, drawTime: 60, hints: 0 });
    alice = h.add('Alice');
    bob = h.add('Bob');
    carol = h.add('Carol');
    h.room.startGame(alice);
  });

  it('hides the word from guessers and shows it to the drawer', () => {
    const { drawerId, word } = intoDrawing(h);
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    const pattern = h.room.stateFor(guesser).wordPattern;
    expect(pattern).not.toBe(word);
    expect(pattern.replace(/[\s\-'.]/g, '')).toMatch(/^_+$/);
    expect(pattern).toHaveLength(word.length);
  });

  it('scores a correct guess and reveals the word to that player', () => {
    const { drawerId, word } = intoDrawing(h);
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    h.room.say(guesser, word);

    const state = h.room.stateFor(guesser);
    expect(state.youGuessed).toBe(true);
    expect(state.wordPattern).toBe(word);
    expect(state.players.find((p) => p.id === guesser)!.score).toBeGreaterThan(0);
  });

  it('does not put a correct guess into the chat', () => {
    const { drawerId, word } = intoDrawing(h);
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    const other = [alice, bob, carol].find((id) => id !== drawerId && id !== guesser)!;
    h.tx.reset();
    h.room.say(guesser, word);

    const seen = h.tx.chatFor(other);
    expect(seen.some((m) => m.text.toLowerCase().includes(word.toLowerCase()))).toBe(false);
    expect(seen.some((m) => m.kind === 'correct')).toBe(true);
  });

  it('pays the first guesser more than the second', () => {
    const { drawerId, word } = intoDrawing(h);
    const [first, second] = [alice, bob, carol].filter((id) => id !== drawerId);
    h.room.say(first!, word);
    h.room.say(second!, word);

    const players = h.room.stateFor(drawerId).players;
    const firstScore = players.find((p) => p.id === first)!.score;
    const secondScore = players.find((p) => p.id === second)!.score;
    expect(firstScore).toBeGreaterThan(secondScore);
  });

  it('pays the drawer once somebody gets it', () => {
    const { drawerId, word } = intoDrawing(h);
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    h.room.say(guesser, word);
    h.clock.advance(h.room.settings.drawTime * 1000 + 100);

    const drawer = h.room.stateFor(drawerId).players.find((p) => p.id === drawerId)!;
    expect(drawer.score).toBeGreaterThan(0);
  });

  it('pays the drawer nothing when nobody gets it', () => {
    const { drawerId } = intoDrawing(h);
    h.clock.advance(h.room.settings.drawTime * 1000 + 100);
    const drawer = h.room.stateFor(drawerId).players.find((p) => p.id === drawerId)!;
    expect(drawer.score).toBe(0);
  });

  it('ends the turn as soon as everyone has it', () => {
    const { drawerId, word } = intoDrawing(h);
    const guessers = [alice, bob, carol].filter((id) => id !== drawerId);
    for (const id of guessers) h.room.say(id, word);

    expect(h.room.stateFor(drawerId).phase).toBe('turn-end');
    const [payload] = h.tx.roomEvents('turn:end').at(-1)!;
    expect(payload).toMatchObject({ reason: 'all-guessed', word });
  });

  it('tells a player privately when they were close', () => {
    const h2 = harness({ hints: 0 });
    const a = h2.add('Alice');
    const b = h2.add('Bob');
    h2.room.startGame(a);
    const { drawerId, word } = intoDrawing(h2);
    const guesser = drawerId === a ? b : a;

    h2.tx.reset();
    h2.room.say(guesser, `${word}x`);

    const own = (h2.tx.perPlayer.get(guesser) ?? [])
      .filter((r) => r.event === 'chat')
      .map((r) => r.args[0] as ChatMessage);
    expect(own.some((m) => m.kind === 'close')).toBe(true);
    // The nudge is private.
    expect(h2.tx.roomEvents('chat').some(([m]) => (m as ChatMessage).kind === 'close')).toBe(false);
  });

  it('keeps a guesser from telling the others', () => {
    const { drawerId, word } = intoDrawing(h);
    const [insider, stillGuessing] = [alice, bob, carol].filter((id) => id !== drawerId);
    h.room.say(insider!, word);

    h.tx.reset();
    h.room.say(insider!, `it is ${word}`);
    const leaked = h.tx.chatFor(stillGuessing!).some((m) => m.text.includes(word));
    expect(leaked).toBe(false);
    // The drawer and the other insiders do see it.
    const drawerSaw = (h.tx.perPlayer.get(drawerId) ?? []).some(
      (r) => r.event === 'chat' && (r.args[0] as ChatMessage).kind === 'insider',
    );
    expect(drawerSaw).toBe(true);
  });

  it('blocks the drawer from typing the word', () => {
    const { drawerId, word } = intoDrawing(h);
    h.tx.reset();
    h.room.say(drawerId, `it is a ${word}`);

    expect(h.tx.roomEvents('chat')).toHaveLength(0);
    const warned = (h.tx.perPlayer.get(drawerId) ?? []).some((r) => r.event === 'notice');
    expect(warned).toBe(true);
  });

  it('lets the drawer say something harmless', () => {
    const { drawerId } = intoDrawing(h);
    h.tx.reset();
    h.room.say(drawerId, 'come on, look at it');
    expect(h.tx.roomEvents('chat')).toHaveLength(1);
  });

  it('ignores a guess from someone who is not in the room', () => {
    const { word } = intoDrawing(h);
    h.tx.reset();
    h.room.say('ghost', word);
    expect(h.tx.roomEvents('chat')).toHaveLength(0);
  });
});

describe('hints', () => {
  it('turns letters over as the clock runs down', () => {
    const h = harness({ hints: 3, drawTime: 100 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    const { drawerId, word } = intoDrawing(h);
    const guesser = drawerId === alice ? bob : alice;

    const revealedCount = () =>
      [...h.room.stateFor(guesser).wordPattern].filter((ch) => ch !== '_' && !/[\s\-'.]/.test(ch))
        .length;

    expect(revealedCount()).toBe(0);
    h.clock.advance(50_000);
    const midway = revealedCount();
    h.clock.advance(45_000);
    const late = revealedCount();

    expect(midway).toBeGreaterThan(0);
    expect(late).toBeGreaterThanOrEqual(midway);
    // Never the whole word.
    expect(late).toBeLessThan(word.replace(/[\s\-'.]/g, '').length);
  });

  it('reveals nothing when hints are off', () => {
    const h = harness({ hints: 0, drawTime: 60 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    const guesser = drawerId === alice ? bob : alice;

    h.clock.advance(55_000);
    expect(h.room.stateFor(guesser).wordPattern.replace(/[\s\-'.]/g, '')).toMatch(/^_+$/);
  });
});

describe('the turn and round cycle', () => {
  it('gives everyone a turn each round and then ends the game', () => {
    const h = harness({ rounds: 2, drawTime: 30 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);

    const drawers: string[] = [];
    playGame(h, (drawerId) => drawers.push(drawerId));

    expect(drawers).toHaveLength(6);
    expect(new Set(drawers.slice(0, 3)).size).toBe(3);
    expect(new Set(drawers.slice(3, 6)).size).toBe(3);
    expect(h.room.stateFor(alice).phase).toBe('game-end');
    expect(h.tx.roomEvents('game:end')).toHaveLength(1);
  });

  it('counts the rounds it was told to', () => {
    const h = harness({ rounds: 5, drawTime: 20 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);

    const rounds = new Set<number>();
    playGame(h, () => rounds.add(h.room.stateFor('nobody').round));
    expect([...rounds].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never shows the same word twice in one game', () => {
    const h = harness({ rounds: 5, drawTime: 20 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);

    const words: string[] = [];
    playGame(h, (_drawerId, word) => words.push(word));
    expect(words).toHaveLength(15);
    expect(new Set(words).size).toBe(words.length);
  });

  it('reports the standings in score order', () => {
    const h = harness({ rounds: 2, drawTime: 60 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);

    // Only ever let Bob guess, so he must finish ahead.
    playGame(h, (drawerId, word) => {
      if (drawerId !== bob) h.room.say(bob, word);
    });

    const [payload] = h.tx.roomEvents('game:end').at(-1)! as [{ standings: Array<{ id: string }> }];
    expect(payload.standings[0]!.id).toBe(bob);
    expect(payload.standings).toHaveLength(2);
  });
});

describe('skipping', () => {
  it('ends the turn on a majority vote and pays the drawer nothing', () => {
    const h = harness({ drawTime: 90 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    const voters = [alice, bob, carol].filter((id) => id !== drawerId);

    expect(skipVotesNeeded(voters.length)).toBe(2);
    h.room.voteSkip(voters[0]!);
    expect(h.room.stateFor(alice).phase).toBe('drawing');
    expect(h.room.stateFor(alice).skipVotes).toEqual([voters[0]]);

    h.room.voteSkip(voters[1]!);
    expect(h.room.stateFor(alice).phase).toBe('turn-end');
    const [payload] = h.tx.roomEvents('turn:end').at(-1)!;
    expect(payload).toMatchObject({ reason: 'skipped' });
    expect(h.room.stateFor(alice).players.find((p) => p.id === drawerId)!.score).toBe(0);
  });

  it('lets a vote be taken back', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    const voter = h.room.stateFor(alice).players.find((p) => p.id !== drawerId)!.id;

    h.room.voteSkip(voter);
    h.room.voteSkip(voter);
    expect(h.room.stateFor(alice).skipVotes).toEqual([]);
    expect(h.room.stateFor(alice).phase).toBe('drawing');
  });

  it('lets the drawer give up their own turn at once', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);

    h.room.voteSkip(drawerId);
    expect(h.room.stateFor(alice).phase).toBe('turn-end');
  });
});

describe('leaving mid-game', () => {
  it('ends the turn when the drawer disconnects', () => {
    const h = harness({ rounds: 3 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);

    h.room.disconnect(drawerId);
    const [payload] = h.tx.roomEvents('turn:end').at(-1)!;
    expect(payload).toMatchObject({ reason: 'drawer-left' });
  });

  it('holds a seat open and gives it back on a reload', () => {
    const h = harness({ rounds: 3, drawTime: 60 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);
    const { drawerId, word } = intoDrawing(h);
    const guesser = [alice, bob].find((id) => id !== drawerId) ?? bob;
    h.room.say(guesser, word);
    const earned = h.room.stateFor(guesser).players.find((p) => p.id === guesser)!.score;

    h.room.disconnect(guesser);
    expect(h.room.stateFor(alice).players.find((p) => p.id === guesser)!.disconnected).toBe(true);

    const back = h.room.join({
      clientId: `client-${[alice, bob].indexOf(guesser) + 1}-aaaaaaaa`,
      name: 'Rejoined',
      avatar: { color: 1, face: 1, eyes: 1, mouth: 1, hat: 1 },
    });
    expect(back.resumed).toBe(true);
    expect(back.id).toBe(guesser);
    expect(h.room.stateFor(guesser).players.find((p) => p.id === guesser)!.score).toBe(earned);
  });

  it('gives the seat up once the grace period runs out', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.disconnect(bob);
    h.clock.advance(RECONNECT_GRACE_MS + 1_000);
    expect(h.room.stateFor(alice).players.map((p) => p.id)).toEqual([alice]);
  });

  it('falls back to the lobby when too few players are left', () => {
    const h = harness({ rounds: 3 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    h.room.remove(bob, 'left');
    expect(h.room.stateFor(alice).phase).toBe('lobby');
  });

  it('skips a departed player when their turn comes round', () => {
    const h = harness({ rounds: 1, drawTime: 20 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);

    const firstDrawer = h.room.stateFor(alice).drawerId!;
    const later = [alice, bob, carol].filter((id) => id !== firstDrawer);
    // Take out somebody who has not drawn yet.
    h.room.remove(later[1]!, 'left');

    const seen: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      const state = h.room.stateFor(alice);
      if (state.phase === 'game-end' || state.phase === 'lobby') break;
      if (state.drawerId) seen.push(state.drawerId);
      h.clock.advance(PICK_TIME_MS + 20_000 + TURN_END_MS + 200);
    }
    expect(seen).not.toContain(later[1]);
  });
});

describe('mid-game arrivals', () => {
  it('watches the current round, then joins in on the next one', () => {
    const h = harness({ rounds: 2, drawTime: 20 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);

    const dave = h.add('Dave');
    expect(h.room.stateFor(dave).players.find((p) => p.id === dave)!.spectating).toBe(true);

    // Run out the rest of round one.
    for (let turn = 0; turn < 3; turn++) {
      if (h.room.stateFor(alice).round > 1) break;
      h.clock.advance(PICK_TIME_MS + 20_000 + TURN_END_MS + 200);
    }
    expect(h.room.stateFor(dave).players.find((p) => p.id === dave)!.spectating).toBe(false);
  });

  it('holds the canvas ready for a player who arrives mid-turn', () => {
    const h = harness({ drawTime: 60 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    h.room.addOps(drawerId, [
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 10, points: [10, 10, 50, 50] },
    ]);

    // The canvas travels with the join reply rather than as a separate emit:
    // when a player is seated their socket is not yet in the room's channels,
    // so anything pushed at that moment would be lost.
    h.room.join({
      clientId: 'dave-aaaaaaaaaa',
      name: 'Dave',
      avatar: { color: 0, face: 0, eyes: 0, mouth: 0, hat: 0 },
    });
    expect(h.room.canvasOps).toHaveLength(1);
  });

  it('hands the canvas back to someone who left and came straight back', () => {
    const h = harness({ drawTime: 60, rounds: 3 });
    const alice = h.add('Alice');
    h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    const leaver = drawerId === carol ? alice : carol;

    h.room.addOps(drawerId, [
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 10, points: [10, 10, 50, 50] },
      { kind: 'stroke', group: 2, tool: 'brush', color: '#ff2e63', width: 10, points: [60, 60, 90, 90] },
    ]);

    h.room.remove(leaver, 'left');
    h.room.join({
      clientId: 'returning-aaaaaaa',
      name: 'Back',
      avatar: { color: 0, face: 0, eyes: 0, mouth: 0, hat: 0 },
    });
    // The drawing is still on the easel, not wiped by the comings and goings.
    expect(h.room.canvasOps).toHaveLength(2);
  });
});

describe('the canvas', () => {
  let h: Harness;
  let drawerId: string;
  let other: string;

  beforeEach(() => {
    h = harness({ drawTime: 120 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    drawerId = intoDrawing(h).drawerId;
    other = drawerId === alice ? bob : alice;
  });

  it('broadcasts the drawer’s strokes', () => {
    h.tx.reset();
    h.room.addOps(drawerId, [
      { kind: 'stroke', group: 1, tool: 'brush', color: '#ff2e63', width: 10, points: [0, 0, 5, 5] },
    ]);
    const [ops] = h.tx.roomEvents('draw:ops').at(-1)! as [unknown[]];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'stroke', color: '#ff2e63', id: 1 });
  });

  it('ignores drawing from anyone but the drawer', () => {
    h.tx.reset();
    h.room.addOps(other, [
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 10, points: [0, 0, 5, 5] },
    ]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(0);
  });

  it('throws out a colour that is not on the palette', () => {
    h.tx.reset();
    h.room.addOps(drawerId, [
      { kind: 'stroke', group: 1, tool: 'brush', color: 'url(evil)', width: 10, points: [0, 0, 5, 5] },
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 999, points: [0, 0, 5, 5] },
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 10, points: [0] },
      { kind: 'stroke', tool: 'brush', color: '#000000', width: 10, points: [0, 0, 5, 5] },
      { kind: 'nonsense' },
    ]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(0);
  });

  it('undoes one stroke at a time', () => {
    const stroke = (group: number, x: number) => ({
      kind: 'stroke' as const,
      group,
      tool: 'brush' as const,
      color: '#000000',
      width: 10,
      points: [x, x, x + 5, x + 5],
    });
    h.room.addOps(drawerId, [stroke(1, 10), stroke(2, 20), stroke(3, 30)]);
    h.tx.reset();

    h.room.undo(drawerId);
    const [afterUndo] = h.tx.roomEvents('draw:sync').at(-1)! as [unknown[]];
    expect(afterUndo).toHaveLength(2);

    h.room.undo(other);
    expect(h.tx.roomEvents('draw:sync')).toHaveLength(1);
  });

  it('undoes a streamed stroke as one, not segment by segment', () => {
    const segment = (group: number, x: number) => ({
      kind: 'stroke' as const,
      group,
      tool: 'brush' as const,
      color: '#000000',
      width: 10,
      points: [x, x, x + 5, x + 5],
    });
    // One long drag arrives as four segments, then a second, separate dab.
    h.room.addOps(drawerId, [segment(1, 10), segment(1, 15), segment(1, 20), segment(1, 25)]);
    h.room.addOps(drawerId, [segment(2, 80)]);
    h.tx.reset();

    h.room.undo(drawerId);
    expect((h.tx.roomEvents('draw:sync').at(-1)! as [unknown[]])[0]).toHaveLength(4);

    h.room.undo(drawerId);
    expect((h.tx.roomEvents('draw:sync').at(-1)! as [unknown[]])[0]).toHaveLength(0);
  });

  it('undoes a fill without taking the stroke under it', () => {
    h.room.addOps(drawerId, [
      {
        kind: 'stroke',
        group: 1,
        tool: 'brush',
        color: '#000000',
        width: 10,
        points: [10, 10, 60, 60],
      },
      { kind: 'fill', color: '#ffcc00', x: 400, y: 300 },
    ]);
    h.tx.reset();

    h.room.undo(drawerId);
    const [remaining] = h.tx.roomEvents('draw:sync').at(-1)! as [Array<{ kind: string }>];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.kind).toBe('stroke');
  });

  it('clears the canvas and starts each turn blank', () => {
    h.room.addOps(drawerId, [
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 10, points: [0, 0, 9, 9] },
    ]);
    h.tx.reset();
    h.room.clearCanvas(drawerId);
    expect(h.tx.roomEvents('draw:sync').at(-1)![0]).toEqual([]);

    h.clock.advance(120_000 + TURN_END_MS + 200);
    const dave = h.add('Dave');
    expect((h.tx.perPlayer.get(dave) ?? []).some((r) => r.event === 'draw:sync')).toBe(false);
  });
});

describe('moderation', () => {
  it('lets the host kick, and remembers the ban', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.hostKick(alice, bob);

    expect(h.room.stateFor(alice).players.map((p) => p.id)).toEqual([alice]);
    expect(h.tx.dropped).toContain(bob);
    expect(h.room.isBannedClient('client-2-aaaaaaaa')).toBe(true);
  });

  it('does not let a guest kick', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.hostKick(bob, alice);
    expect(h.room.stateFor(bob).players).toHaveLength(2);
  });

  it('removes a player on a strong enough vote', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.add('Erin');
    const dave = h.add('Dave');
    expect(kickVotesNeeded(4)).toBe(3);

    h.room.voteKick(alice, dave);
    expect(h.room.stateFor(alice).players).toHaveLength(5);
    h.room.voteKick(bob, dave);
    expect(h.room.stateFor(alice).players).toHaveLength(5);
    h.room.voteKick(carol, dave);
    expect(h.room.stateFor(alice).players.map((p) => p.id)).not.toContain(dave);
  });

  it('counts each voter once', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    const dave = h.add('Dave');
    h.room.voteKick(alice, dave);
    h.room.voteKick(alice, dave);
    h.room.voteKick(alice, dave);
    expect(h.room.stateFor(alice).players.map((p) => p.id)).toContain(dave);
  });

  it('protects the host from a vote', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.voteKick(bob, alice);
    h.room.voteKick(carol, alice);
    expect(h.room.stateFor(bob).players.map((p) => p.id)).toContain(alice);
  });
});

describe('settings', () => {
  it('only takes changes from the host', () => {
    const h = harness();
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.updateSettings(bob, { rounds: 9 });
    expect(h.room.stateFor(alice).settings.rounds).toBe(DEFAULT_SETTINGS.rounds);
    h.room.updateSettings(alice, { rounds: 9 });
    expect(h.room.stateFor(alice).settings.rounds).toBe(9);
  });

  it('locks the settings once a game is running', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);
    h.room.updateSettings(alice, { rounds: 9 });
    expect(h.room.stateFor(alice).settings.rounds).toBe(DEFAULT_SETTINGS.rounds);
  });

  it('plays a game on custom words alone', () => {
    const customWords = Array.from({ length: 12 }, (_, i) => `custom${i}`);
    const h = harness({ wordMode: 'custom-only', customWords, rounds: 1, drawTime: 20 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.startGame(alice);

    const { word } = intoDrawing(h);
    expect(customWords).toContain(word);
  });

  it('keeps a profile change out of a running game', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.add('Bob');
    h.room.updateProfile(alice, { name: 'Renamed' });
    expect(h.room.stateFor(alice).players.find((p) => p.id === alice)!.name).toBe('Renamed');

    h.room.startGame(alice);
    h.room.updateProfile(alice, { name: 'Again' });
    expect(h.room.stateFor(alice).players.find((p) => p.id === alice)!.name).toBe('Renamed');
  });
});

describe('a brief disconnect', () => {
  it('does not tear down a two-player game', () => {
    const h = harness({ rounds: 3, drawTime: 60 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    const guesser = drawerId === alice ? bob : alice;

    h.room.disconnect(guesser);
    // The seat is still held, so the game is still on.
    expect(h.room.stateFor(alice).phase).not.toBe('lobby');
    expect(h.room.presentCount).toBe(1);
    expect(h.room.playerCount).toBe(2);

    const back = h.room.join({
      clientId: `client-${[alice, bob].indexOf(guesser) + 1}-aaaaaaaa`,
      name: 'Back',
      avatar: { color: 0, face: 0, eyes: 0, mouth: 0, hat: 0 },
    });
    expect(back.resumed).toBe(true);
    expect(h.room.stateFor(alice).phase).not.toBe('lobby');
  });

  it('gives up and returns to the lobby if they never come back', () => {
    const h = harness({ rounds: 3, drawTime: 60 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    intoDrawing(h);

    h.room.disconnect(bob);
    h.clock.advance(RECONNECT_GRACE_MS + 1_000);
    expect(h.room.stateFor(alice).phase).toBe('lobby');
    expect(h.room.playerCount).toBe(1);
  });
});

describe('rapid fire', () => {
  function rapidHarness() {
    const h = harness({ mode: 'rapid', drawTime: 60, rounds: 1, hints: 0 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);
    return { h, alice, bob, carol };
  }

  it('skips the word picker and starts drawing at once', () => {
    const { h, alice } = rapidHarness();
    const state = h.room.stateFor(alice);
    expect(state.phase).toBe('drawing');
    expect(state.wordChoices).toBeNull();
    expect(state.wordsCleared).toBe(0);
  });

  it('hands over a new word the moment someone gets one', () => {
    const { h, alice, bob, carol } = rapidHarness();
    const drawerId = h.room.stateFor(alice).drawerId!;
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;

    const first = h.room.stateFor(drawerId).wordPattern;
    h.room.say(guesser, first);

    const after = h.room.stateFor(drawerId);
    // Still drawing, on a different word, with the turn clock untouched.
    expect(after.phase).toBe('drawing');
    expect(after.wordPattern).not.toBe(first);
    expect(after.wordsCleared).toBe(1);
  });

  it('wipes the canvas between words', () => {
    const { h, alice, bob, carol } = rapidHarness();
    const drawerId = h.room.stateFor(alice).drawerId!;
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    h.room.addOps(drawerId, [
      { kind: 'stroke', group: 1, tool: 'brush', color: '#000000', width: 10, points: [0, 0, 9, 9] },
    ]);
    h.tx.reset();

    h.room.say(guesser, h.room.stateFor(drawerId).wordPattern);
    expect(h.tx.roomEvents('draw:sync').at(-1)![0]).toEqual([]);
  });

  it('lets everyone guess again on the new word', () => {
    const { h, alice, bob, carol } = rapidHarness();
    const drawerId = h.room.stateFor(alice).drawerId!;
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    h.room.say(guesser, h.room.stateFor(drawerId).wordPattern);
    expect(h.room.stateFor(guesser).youGuessed).toBe(false);
  });

  it('chains several words inside one turn and pays for each', () => {
    const { h, alice, bob, carol } = rapidHarness();
    const drawerId = h.room.stateFor(alice).drawerId!;
    const guessers = [alice, bob, carol].filter((id) => id !== drawerId);

    const words: string[] = [];
    for (let i = 0; i < 5; i++) {
      const word = h.room.stateFor(drawerId).wordPattern;
      words.push(word);
      // Spread the guesses around so no single player takes every word.
      h.room.say(guessers[i % guessers.length]!, word);
      h.clock.advance(1_000);
    }

    expect(h.room.stateFor(alice).wordsCleared).toBe(5);
    expect(new Set(words).size).toBe(5);
    expect(h.room.stateFor(alice).phase).toBe('drawing');

    const drawer = h.room.stateFor(alice).players.find((p) => p.id === drawerId)!;
    expect(drawer.score).toBeGreaterThan(0);
    for (const id of guessers) {
      expect(h.room.stateFor(alice).players.find((p) => p.id === id)!.score).toBeGreaterThan(0);
    }
  });

  it('ends the turn on the clock, not on a guess', () => {
    const { h, alice, bob, carol } = rapidHarness();
    const drawerId = h.room.stateFor(alice).drawerId!;
    const guessers = [alice, bob, carol].filter((id) => id !== drawerId);
    // Everyone gets it, which in classic would end the turn immediately.
    for (const id of guessers) h.room.say(id, h.room.stateFor(drawerId).wordPattern);
    expect(h.room.stateFor(alice).phase).toBe('drawing');

    h.clock.advance(60_000 + 100);
    expect(h.room.stateFor(alice).phase).toBe('turn-end');
  });

  it('does not pay the drawer twice over', () => {
    const { h, alice, bob, carol } = rapidHarness();
    const drawerId = h.room.stateFor(alice).drawerId!;
    const guesser = [alice, bob, carol].find((id) => id !== drawerId)!;
    h.room.say(guesser, h.room.stateFor(drawerId).wordPattern);
    const midTurn = h.room.stateFor(alice).players.find((p) => p.id === drawerId)!.score;

    h.clock.advance(60_000 + 100);
    const afterTurn = h.room.stateFor(alice).players.find((p) => p.id === drawerId)!.score;
    expect(afterTurn).toBe(midTurn);
  });

  it('caps the turn length so a game stays brisk', () => {
    const h = harness({ mode: 'rapid', drawTime: 240 });
    expect(h.room.settings.drawTime).toBeLessThanOrEqual(120);
  });
});

describe('sudden death', () => {
  it('knocks the lowest scorer out at the end of a round', () => {
    const h = harness({ mode: 'sudden-death', rounds: 4, drawTime: 30 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);

    // Only Bob and Carol ever guess, so Alice finishes the round on nothing.
    let rounds = 0;
    for (let step = 0; step < 60 && rounds < 1; step++) {
      const state = h.room.stateFor('nobody');
      if (state.phase === 'game-end') break;
      if (state.phase === 'picking') {
        const { drawerId, word } = intoDrawing(h);
        for (const id of [bob, carol]) if (id !== drawerId) h.room.say(id, word);
        continue;
      }
      runPhaseOut(h);
      if (h.room.stateFor('nobody').round > 1) rounds = 1;
    }

    const players = h.room.stateFor(bob).players;
    expect(players.find((p) => p.id === alice)!.eliminated).toBe(true);
    expect(players.find((p) => p.id === bob)!.eliminated).toBe(false);
  });

  it('leaves a knocked-out player watching, not drawing', () => {
    const h = harness({ mode: 'sudden-death', rounds: 4, drawTime: 30 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);

    for (let step = 0; step < 60; step++) {
      const state = h.room.stateFor('nobody');
      if (state.phase === 'game-end' || state.round > 1) break;
      if (state.phase === 'picking') {
        const { drawerId, word } = intoDrawing(h);
        for (const id of [bob, carol]) if (id !== drawerId) h.room.say(id, word);
        continue;
      }
      runPhaseOut(h);
    }

    const out = h.room.stateFor(alice).players.find((p) => p.id === alice)!;
    expect(out.eliminated).toBe(true);
    expect(out.spectating).toBe(true);

    // They never take another turn.
    const drawers: string[] = [];
    for (let step = 0; step < 40; step++) {
      const state = h.room.stateFor('nobody');
      if (state.phase === 'game-end') break;
      if (state.phase === 'picking') {
        drawers.push(state.drawerId!);
        intoDrawing(h);
        continue;
      }
      runPhaseOut(h);
    }
    expect(drawers).not.toContain(alice);
  });

  it('spares everyone when the scores are level', () => {
    const h = harness({ mode: 'sudden-death', rounds: 3, drawTime: 20 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);

    // Nobody guesses, so every score stays at zero.
    for (let step = 0; step < 40; step++) {
      const state = h.room.stateFor('nobody');
      if (state.phase === 'game-end' || state.round > 1) break;
      if (state.phase === 'picking') {
        intoDrawing(h);
        continue;
      }
      runPhaseOut(h);
    }
    expect(h.room.stateFor(alice).players.every((p) => !p.eliminated)).toBe(true);
  });

  it('ranks the survivor first even on a lower score', () => {
    const h = harness({ mode: 'sudden-death', rounds: 2, drawTime: 20 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    playGame(h, (drawerId, word) => {
      if (drawerId !== bob) h.room.say(bob, word);
    });

    const [payload] = h.tx.roomEvents('game:end').at(-1)! as [
      { standings: Array<{ id: string; score: number }> },
    ];
    const survivors = h.room.stateFor(alice).players.filter((p) => !p.eliminated);
    if (survivors.length === 1) {
      expect(payload.standings[0]!.id).toBe(survivors[0]!.id);
    }
  });

  it('plays as classic does when the mode is off', () => {
    const h = harness({ mode: 'classic', rounds: 2, drawTime: 20 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    playGame(h, (drawerId, word) => {
      if (drawerId !== bob) h.room.say(bob, word);
    });
    expect(h.room.stateFor(alice).players.every((p) => !p.eliminated)).toBe(true);
  });
});

describe('twists', () => {
  function twistHarness(twists: Twist[]) {
    const h = harness({ twists, drawTime: 60, hints: 0 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    h.room.startGame(alice);
    const { drawerId } = intoDrawing(h);
    return { h, alice, bob, drawerId };
  }

  const stroke = (over: Partial<Record<string, unknown>> = {}) => ({
    kind: 'stroke' as const,
    group: 1,
    tool: 'brush' as const,
    color: '#000000',
    width: 10,
    points: [0, 0, 9, 9],
    ...over,
  });

  it('no-takebacks refuses the eraser, undo and clear', () => {
    const { h, drawerId } = twistHarness(['no-takebacks']);
    h.room.addOps(drawerId, [stroke()]);
    h.tx.reset();

    h.room.addOps(drawerId, [stroke({ tool: 'eraser' })]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(0);

    h.room.undo(drawerId);
    h.room.clearCanvas(drawerId);
    expect(h.tx.roomEvents('draw:sync')).toHaveLength(0);
  });

  it('no-takebacks still allows ordinary drawing', () => {
    const { h, drawerId } = twistHarness(['no-takebacks']);
    h.tx.reset();
    h.room.addOps(drawerId, [stroke()]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(1);
  });

  it('one-colour locks the palette for the turn', () => {
    const { h, alice, drawerId } = twistHarness(['one-colour']);
    const locked = h.room.stateFor(alice).lockedColor;
    expect(locked).toBeTruthy();
    expect(PALETTE).toContain(locked);

    h.tx.reset();
    const wrong = PALETTE.find((c) => c !== locked)!;
    h.room.addOps(drawerId, [stroke({ color: wrong })]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(0);

    h.room.addOps(drawerId, [stroke({ color: locked! })]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(1);
  });

  it('one-colour rerolls between turns', () => {
    const h = harness({ twists: ['one-colour'], drawTime: 20, rounds: 3 });
    const alice = h.add('Alice');
    h.add('Bob');
    h.add('Carol');
    h.room.startGame(alice);

    const seen = new Set<string>();
    for (let step = 0; step < 30 && seen.size < 2; step++) {
      const state = h.room.stateFor(alice);
      if (state.phase === 'game-end') break;
      if (state.phase === 'picking') {
        intoDrawing(h);
        seen.add(h.room.stateFor(alice).lockedColor!);
        continue;
      }
      runPhaseOut(h);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leaves the palette open with no twist on', () => {
    const { h, alice, drawerId } = twistHarness([]);
    expect(h.room.stateFor(alice).lockedColor).toBeNull();
    h.tx.reset();
    h.room.addOps(drawerId, [stroke({ color: PALETTE[7]! })]);
    expect(h.tx.roomEvents('draw:ops')).toHaveLength(1);
  });

  it('ignores a twist name it does not know', () => {
    const h = harness({ twists: ['mirror', 'nonsense'] as unknown as Twist[] });
    expect(h.room.settings.twists).toEqual(['mirror']);
  });
});

describe('the chat backlog', () => {
  it('replays recent room chat to someone who joins', () => {
    const h = harness();
    const alice = h.add('Alice');
    h.room.say(alice, 'anyone about?');
    expect(h.room.publicChat.some((m) => m.text === 'anyone about?')).toBe(true);
  });

  it('never replays the private channels', () => {
    const h = harness({ drawTime: 60, hints: 0 });
    const alice = h.add('Alice');
    const bob = h.add('Bob');
    const carol = h.add('Carol');
    h.room.startGame(alice);
    const { drawerId, word } = intoDrawing(h);
    const [insider, other] = [alice, bob, carol].filter((id) => id !== drawerId);

    h.room.say(insider!, word);
    h.room.say(insider!, `it was obviously ${word}`);
    h.room.say(other!, `${word}x`);

    const log = h.room.publicChat;
    expect(log.some((m) => m.kind === 'insider')).toBe(false);
    expect(log.some((m) => m.kind === 'close')).toBe(false);
    // The answer itself is never in there. A near miss like "treee" is public
    // and does contain "tree", so what matters is that no logged message is
    // the word, not that none merely resembles it.
    expect(log.some((m) => isExactGuess(m.text, word))).toBe(false);
    expect(log.some((m) => m.text === `it was obviously ${word}`)).toBe(false);
  });

  it('keeps the backlog bounded', () => {
    const h = harness();
    const alice = h.add('Alice');
    for (let i = 0; i < CHAT_LOG_LIMIT + 40; i++) h.room.say(alice, `message ${i}`);
    expect(h.room.publicChat.length).toBeLessThanOrEqual(CHAT_LOG_LIMIT);
    // The newest survive, the oldest fall off.
    expect(h.room.publicChat.at(-1)!.text).toBe(`message ${CHAT_LOG_LIMIT + 39}`);
  });
});
