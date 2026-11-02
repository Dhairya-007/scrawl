import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  randomAvatar,
  type Avatar,
  type ChatMessage,
  type DrawOp,
  type DrawOpInput,
  type GameEndPayload,
  type JoinMode,
  type JoinResponse,
  type RoomSettings,
  type StatePayload,
  type Tool,
  type TurnEndPayload,
} from '@scrawl/shared';
import { clientId, loadJSON, saveJSON } from '../lib/clientId.js';
import { lastRoom, readRoomCode, rememberRoom, writeRoomCode } from '../lib/roomUrl.js';
import { getSocket } from '../net/socket.js';
import { play } from '../audio/sfx.js';

const PROFILE_KEY = 'scrawl.profile';
const MAX_CHAT = 250;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}

export interface Profile {
  name: string;
  avatar: Avatar;
}

export type Screen = 'home' | 'room';

export interface BrushState {
  tool: Tool;
  color: string;
  width: number;
}

interface GameStore {
  screen: Screen;
  connection: 'idle' | 'joining' | 'live' | 'reconnecting';
  joinError: string | null;
  /** True until the one-shot rejoin attempt on page load has settled. */
  booting: boolean;

  profile: Profile;
  youId: string | null;
  state: StatePayload | null;
  /** serverNow minus the local clock, so timers agree with the server. */
  skew: number;

  chat: ChatMessage[];
  /** Everything drawn this turn, replayed whenever the canvas resets. */
  ops: DrawOp[];
  /** Bumped whenever `ops` was replaced rather than appended. */
  opsEpoch: number;
  cursor: { x: number; y: number; tool: Tool; width: number } | null;

  turnEnd: TurnEndPayload | null;
  gameEnd: GameEndPayload | null;
  toasts: Toast[];
  mutedPlayers: string[];
  brush: BrushState;

  setProfile: (patch: Partial<Profile>) => void;
  setBrush: (patch: Partial<BrushState>) => void;
  join: (mode: JoinMode, code?: string, settings?: Partial<RoomSettings>) => Promise<JoinResponse>;
  leave: () => void;
  /** Reclaim the seat named by the address bar, once, on page load. */
  boot: () => Promise<void>;
  toggleMutePlayer: (playerId: string) => void;
  pushToast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  /** Add ops the local drawer just made, before the server echoes them back. */
  appendLocalOps: (ops: DrawOp[]) => void;
}

function initialProfile(): Profile {
  const stored = loadJSON<Partial<Profile>>(PROFILE_KEY, {});
  return {
    name: typeof stored.name === 'string' ? stored.name : '',
    avatar: (stored.avatar as Avatar | undefined) ?? randomAvatar(),
  };
}

let toastId = 0;
let wired = false;

/** Everything that belongs to a room, wiped in one place so none is missed. */
function clearedRoomState(opsEpoch: number) {
  return {
    screen: 'home' as Screen,
    connection: 'idle' as const,
    youId: null,
    state: null,
    skew: 0,
    chat: [] as ChatMessage[],
    ops: [] as DrawOp[],
    opsEpoch: opsEpoch + 1,
    cursor: null,
    turnEnd: null,
    gameEnd: null,
    mutedPlayers: [] as string[],
  };
}

export const useGame = create<GameStore>((set, get) => ({
  screen: 'home',
  connection: 'idle',
  joinError: null,
  booting: readRoomCode() !== '' && readRoomCode() === lastRoom(),

  profile: initialProfile(),
  youId: null,
  state: null,
  skew: 0,

  chat: [],
  ops: [],
  opsEpoch: 0,
  cursor: null,

  turnEnd: null,
  gameEnd: null,
  toasts: [],
  mutedPlayers: [],
  brush: { tool: 'brush', color: '#222935', width: 10 },

  setProfile(patch) {
    const profile = { ...get().profile, ...patch };
    set({ profile });
    saveJSON(PROFILE_KEY, profile);
    // In the lobby the change is pushed live so others see it straight away.
    if (get().connection === 'live') {
      getSocket().emit('profile:update', { name: profile.name, avatar: profile.avatar });
    }
  },

  setBrush(patch) {
    set({ brush: { ...get().brush, ...patch } });
  },

  async join(mode, code, settings) {
    const { profile } = get();
    set({ connection: 'joining', joinError: null });
    const socket = getSocket();
    wireSocket();

    const response = await new Promise<JoinResponse>((resolve) => {
      const request = {
        mode,
        code,
        name: profile.name.trim() || 'Player',
        avatar: profile.avatar,
        clientId: clientId(),
        settings,
      };
      const send = () => socket.emit('join', request, resolve);
      if (socket.connected) send();
      else socket.once('connect', send);
      // Never leave the button spinning for ever.
      setTimeout(() => resolve({ ok: false, error: 'room-closed' }), 10_000);
    });

    if (response.ok) {
      set({
        screen: 'room',
        connection: 'live',
        booting: false,
        youId: response.youId,
        state: response.state,
        skew: response.state.serverNow - Date.now(),
        chat: response.chat,
        ops: response.ops,
        opsEpoch: get().opsEpoch + 1,
        cursor: null,
        turnEnd: null,
        gameEnd: null,
        joinError: null,
        mutedPlayers: [],
      });
      rememberRoom(response.code);
      writeRoomCode(response.code);
      play('join');
    } else {
      set({ connection: 'idle', booting: false, joinError: response.error });
      // A room that is gone should not keep pulling this tab back to it.
      if (response.error === 'room-not-found' || response.error === 'banned') {
        rememberRoom(null);
        writeRoomCode(null);
      }
      play('error');
    }
    return response;
  },

  leave() {
    // Tell the server first: an explicit leave gives the seat up rather than
    // holding it open the way a dropped connection does.
    getSocket().emit('leave');
    rememberRoom(null);
    writeRoomCode(null);
    set({ ...clearedRoomState(get().opsEpoch), joinError: null });
  },

  async boot() {
    const code = readRoomCode();
    // Only a code this browser was already seated in is reclaimed without
    // asking; somebody else's invite waits for a name to be chosen.
    if (!code || code !== lastRoom()) {
      set({ booting: false });
      return;
    }
    set({ booting: true });
    await get().join('join', code);
    set({ booting: false });
  },

  toggleMutePlayer(playerId) {
    const muted = get().mutedPlayers;
    set({
      mutedPlayers: muted.includes(playerId)
        ? muted.filter((id) => id !== playerId)
        : [...muted, playerId],
    });
  },

  pushToast(text, tone = 'info') {
    const toast: Toast = { id: ++toastId, text, tone };
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().dismissToast(toast.id), 4_000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },

  appendLocalOps(ops) {
    set({ ops: [...get().ops, ...ops] });
  },
}));

/** Attach the store to the socket once; later joins reuse the same handlers. */
function wireSocket(): void {
  if (wired) return;
  wired = true;
  const socket = getSocket();
  const store = useGame;

  socket.on('state', (next) => {
    const previous = store.getState().state;
    store.setState({ state: next, skew: next.serverNow - Date.now() });

    // A new turn clears last turn's reveal and scoreboard.
    if (previous && previous.phase !== next.phase) {
      if (next.phase === 'picking' || next.phase === 'drawing') {
        store.setState({ turnEnd: null });
      }
      if (next.phase === 'lobby') store.setState({ gameEnd: null, turnEnd: null });
    }
  });

  socket.on('chat', (message) => {
    const { chat, mutedPlayers, youId } = store.getState();
    if (message.authorId && mutedPlayers.includes(message.authorId)) return;

    if (message.kind === 'correct') play(message.authorId === youId ? 'youCorrect' : 'correct');
    if (message.kind === 'close') play('close');
    if (message.kind === 'join') play('join');
    if (message.kind === 'leave') play('leave');

    store.setState({ chat: [...chat, message].slice(-MAX_CHAT) });
  });

  socket.on('draw:ops', (ops) => {
    store.setState({ ops: [...store.getState().ops, ...ops] });
  });

  socket.on('draw:sync', (ops) => {
    store.setState({ ops, opsEpoch: store.getState().opsEpoch + 1 });
  });

  socket.on('draw:cursor', (cursor) => {
    store.setState({ cursor });
  });

  socket.on('turn:start', () => {
    store.setState({
      ops: [],
      opsEpoch: store.getState().opsEpoch + 1,
      turnEnd: null,
      cursor: null,
    });
    play('turnStart');
  });

  socket.on('turn:end', (payload) => {
    store.setState({ turnEnd: payload });
    play('turnEnd');
  });

  socket.on('game:end', (payload) => {
    store.setState({ gameEnd: payload, turnEnd: null });
    play('win');
  });

  socket.on('notice', ({ text, tone }) => {
    store.getState().pushToast(text, tone);
    if (tone !== 'info') play('error');
  });

  socket.on('kicked', ({ reason }) => {
    const text =
      reason === 'host'
        ? 'The host removed you from the room'
        : reason === 'vote'
          ? 'You were voted out of the room'
          : 'That room has closed';
    rememberRoom(null);
    writeRoomCode(null);
    store.setState(clearedRoomState(store.getState().opsEpoch));
    store.getState().pushToast(text, 'error');
  });

  socket.on('disconnect', () => {
    if (store.getState().screen === 'room') store.setState({ connection: 'reconnecting' });
  });

  // Socket.IO reconnects on its own; the seat is reclaimed with the same id.
  socket.io.on('reconnect', () => {
    const { screen, state, profile } = store.getState();
    if (screen !== 'room' || !state) return;
    socket.emit(
      'join',
      {
        mode: 'join',
        code: state.code,
        name: profile.name.trim() || 'Player',
        avatar: profile.avatar,
        clientId: clientId(),
      },
      (response) => {
        if (response.ok) {
          store.setState({
            connection: 'live',
            youId: response.youId,
            state: response.state,
            skew: response.state.serverNow - Date.now(),
            // The canvas may have moved on while the socket was away.
            ops: response.ops,
            opsEpoch: store.getState().opsEpoch + 1,
          });
        } else {
          rememberRoom(null);
          writeRoomCode(null);
          store.setState(clearedRoomState(store.getState().opsEpoch));
          store.getState().pushToast('That room is gone', 'error');
        }
      },
    );
  });
}

/** Helpers so components do not each reach for the socket. */
export const actions = {
  start: () => getSocket().emit('game:start'),
  pickWord: (index: number) => getSocket().emit('word:pick', { index }),
  settings: (patch: Partial<RoomSettings>) => getSocket().emit('settings:update', patch),
  sendChat: (text: string) => getSocket().emit('chat:send', { text }),
  sendOps: (ops: DrawOpInput[]) => getSocket().emit('draw:ops', ops),
  sendCursor: (cursor: { x: number; y: number; tool: Tool; width: number } | null) =>
    getSocket().emit('draw:cursor', cursor),
  undo: () => getSocket().emit('draw:undo'),
  clear: () => getSocket().emit('draw:clear'),
  voteSkip: () => getSocket().emit('vote:skip'),
  voteKick: (playerId: string) => getSocket().emit('vote:kick', { playerId }),
  hostKick: (playerId: string) => getSocket().emit('host:kick', { playerId }),
};

export { DEFAULT_SETTINGS };
