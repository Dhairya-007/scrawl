/**
 * Drives two real socket clients through a whole game against a running
 * server: create a room, join it, draw, guess, reconnect and reach the
 * podium. Unit tests cover the engine in isolation; this covers the wiring.
 *
 *   npm run build && npm start &
 *   node scripts/smoke.mjs
 */
import { io } from 'socket.io-client';

const URL = process.env.SCRAWL_URL ?? 'http://localhost:3001';
const AVATAR = { color: 1, face: 1, eyes: 1, mouth: 1, hat: 1 };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(label, passed, extra = '') {
  results.push({ label, passed, extra });
  if (!passed) process.exitCode = 1;
}

/** Poll a condition rather than sleeping for a guessed amount of time. */
async function until(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(50);
  }
  check(label, false, 'timed out');
  return false;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${URL}/healthz`);
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await wait(300);
  }
  throw new Error(`no server at ${URL}`);
}

function connect(name, clientId) {
  const socket = io(URL, { transports: ['websocket'] });
  const peer = { socket, name, state: null, chat: [], ops: [], turnEnd: null, gameEnd: null, notices: [] };
  socket.on('state', (state) => { peer.state = state; });
  socket.on('chat', (message) => peer.chat.push(message));
  socket.on('draw:ops', (ops) => peer.ops.push(...ops));
  socket.on('draw:sync', (ops) => { peer.ops = [...ops]; });
  socket.on('turn:end', (payload) => { peer.turnEnd = payload; });
  socket.on('game:end', (payload) => { peer.gameEnd = payload; });
  socket.on('notice', (notice) => peer.notices.push(notice));
  peer.join = (request) =>
    new Promise((resolve) => socket.emit('join', { name, clientId, avatar: AVATAR, ...request }, resolve));
  return peer;
}

await waitForServer();

const host = connect('Hosty', 'smoke-host-00000001');
const guest = connect('Guesty', 'smoke-guest-0000001');
await until(() => host.socket.connected && guest.socket.connected, 'both sockets connect');

const created = await host.join({ mode: 'create', settings: { drawTime: 25, rounds: 2, hints: 2 } });
check('host creates a room', created.ok && /^[A-Z2-9]{5}$/.test(created.code ?? ''), created.code);
const code = created.code;

const joined = await guest.join({ mode: 'join', code });
check('guest joins by code', joined.ok && joined.code === code);
await until(() => host.state?.players.length === 2, 'host sees both players');
check('the host holds the crown', host.state.hostId === created.youId);
check('the chosen settings stuck', host.state.settings.drawTime === 25 && host.state.settings.rounds === 2);

guest.socket.emit('game:start');
await wait(250);
check('a guest cannot start the game', host.state.phase === 'lobby');
check('and is told why', guest.notices.some((n) => /host/i.test(n.text)));

host.socket.emit('game:start');
await until(() => host.state?.phase === 'picking', 'the game starts');

const drawer = host.state.drawerId === created.youId ? host : guest;
const other = drawer === host ? guest : host;
check('only the drawer is offered words',
  drawer.state.wordChoices?.length === 3 && other.state.wordChoices === null);

drawer.socket.emit('word:pick', { index: 0 });
await until(() => drawer.state?.phase === 'drawing', 'the turn begins');
const word = drawer.state.wordPattern;
check('the drawer sees the word', word.length > 0 && !word.includes('_'), word);
check('the guesser sees blanks', /_/.test(other.state.wordPattern));
check('the blanks match the length', other.state.wordPattern.length === word.length);

drawer.socket.emit('draw:ops', [
  { kind: 'stroke', group: 1, tool: 'brush', color: '#ff2e63', width: 10, points: [10, 10, 200, 150] },
  { kind: 'stroke', group: 1, tool: 'brush', color: '#ff2e63', width: 10, points: [200, 150, 400, 300] },
]);
await until(() => other.ops.length === 2, 'strokes reach the guesser');

// Joining must hand over the canvas as it stands. This is only catchable end
// to end: a socket is added to the room's channels after it is seated, so
// anything pushed from inside `join` would quietly go nowhere.
const latecomer = connect('Latey', 'smoke-latecomer-00001');
await until(() => latecomer.socket.connected, 'the latecomer connects');
const lateJoin = await latecomer.join({ mode: 'join', code });
check('a newcomer is handed the canvas with their join reply',
  lateJoin.ok && lateJoin.ops?.length === 2, String(lateJoin.ops?.length));
check('and it is the real drawing, not a blank one',
  lateJoin.ok && lateJoin.ops.every((op) => op.kind === 'stroke'));
check('and recent public chat comes with it',
  lateJoin.ok && (lateJoin.chat?.length ?? 0) > 0, String(lateJoin.chat?.length));
check('the private channels stay out of that backlog',
  lateJoin.ok && !lateJoin.chat.some((m) => m.kind === 'insider' || m.kind === 'close'));
// Give the seat up properly, so the standings later are still just the two.
latecomer.socket.emit('leave');
latecomer.socket.close();
await wait(300);

drawer.socket.emit('draw:ops', [
  { kind: 'stroke', group: 1, tool: 'brush', color: 'javascript:bad', width: 10, points: [0, 0, 1, 1] },
]);
await wait(250);
check('a colour off the palette is rejected', other.ops.length === 2);

other.socket.emit('draw:ops', [
  { kind: 'stroke', group: 9, tool: 'brush', color: '#000000', width: 10, points: [0, 0, 5, 5] },
]);
await wait(250);
check('a guesser cannot draw', other.ops.length === 2);

drawer.socket.emit('draw:undo');
await until(() => other.ops.length === 0, 'undo removes the whole stroke group');

other.socket.emit('chat:send', { text: 'definitely a banana tree' });
await wait(250);
check('a wrong guess shows in the chat', other.chat.some((m) => m.text.includes('banana tree')));

drawer.socket.emit('chat:send', { text: `psst it is a ${word}` });
await wait(250);
check('the drawer cannot leak the word',
  !other.chat.some((m) => m.text.toLowerCase().includes(word.toLowerCase())));

other.socket.emit('chat:send', { text: word });
await until(() => other.state?.youGuessed === true, 'the guess is accepted');
check('the word is revealed to them', other.state.wordPattern === word);
check('the guess never appears verbatim',
  !other.chat.some((m) => m.kind === 'say' && m.text.toLowerCase() === word.toLowerCase()));
check('a "got it" line goes out', other.chat.some((m) => m.kind === 'correct'));

await until(() => other.turnEnd !== null, 'the turn ends once everyone has it');
const guesserId = other === host ? created.youId : joined.youId;
const drawerId = drawer === host ? created.youId : joined.youId;
check('the turn end reports the word', other.turnEnd.word === word);
check('the guesser scored', (other.turnEnd.gains[guesserId] ?? 0) > 0, String(other.turnEnd.gains[guesserId]));
check('the drawer was paid', (other.turnEnd.gains[drawerId] ?? 0) > 0, String(other.turnEnd.gains[drawerId]));

// A reload must not cost the player their seat or their score.
const scoreBefore = other.state.players.find((p) => p.id === guesserId).score;
other.socket.disconnect();
await wait(400);
const returning = connect(other.name, other === host ? 'smoke-host-00000001' : 'smoke-guest-0000001');
await until(() => returning.socket.connected, 'the returning socket connects');
const resumed = await returning.join({ mode: 'join', code });
check('a reload gets the same seat back', resumed.ok && resumed.youId === guesserId && resumed.resumed === true);
check('the score survived', resumed.state.players.find((p) => p.id === guesserId).score === scoreBefore);
check('the game kept running', resumed.state.phase !== 'lobby', resumed.state.phase);

// Play the remaining turns out, guessing at once so the clock is not needed.
const cast = [drawer, returning];
for (let step = 0; step < 200 && !drawer.gameEnd; step++) {
  for (const peer of cast) {
    if (peer.state?.phase === 'picking' && peer.state.youAreDrawing) {
      peer.socket.emit('word:pick', { index: 0 });
    }
  }
  const drawing = cast.find((peer) => peer.state?.phase === 'drawing' && peer.state.youAreDrawing);
  if (drawing) {
    const guessing = cast.find((peer) => peer !== drawing);
    if (guessing && !guessing.state?.youGuessed) {
      guessing.socket.emit('chat:send', { text: drawing.state.wordPattern });
    }
  }
  await wait(250);
}
check('the game reaches the podium', drawer.gameEnd !== null);
check('the standings list everyone', drawer.gameEnd?.standings.length === 2);
check('the standings are sorted',
  !!drawer.gameEnd && drawer.gameEnd.standings[0].score >= drawer.gameEnd.standings[1].score);
check('everybody finished with points', !!drawer.gameEnd && drawer.gameEnd.standings.every((p) => p.score > 0));

const stranger = connect('Stranger', 'smoke-stranger-00001');
await until(() => stranger.socket.connected, 'the stranger connects');
const missing = await stranger.join({ mode: 'join', code: 'ZZZZZ' });
check('an unknown room is refused', !missing.ok && missing.error === 'room-not-found');
const shortId = await stranger.join({ mode: 'join', code, clientId: 'x' });
check('a too-short client id is refused', !shortId.ok);

for (const peer of [host, guest, returning, stranger]) peer.socket.close();
await wait(300);

for (const { label, passed, extra } of results) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
}
const passes = results.filter((r) => r.passed).length;
console.log(`\n${passes}/${results.length} checks passed`);
process.exit(process.exitCode ?? 0);
