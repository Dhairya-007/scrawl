import { useState } from 'react';
import type { StatePayload } from '@scrawl/shared';
import { Chat } from '../components/Chat.js';
import { DrawBoard } from '../components/DrawBoard.js';
import { PlayerList } from '../components/PlayerList.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { Toolbar } from '../components/Toolbar.js';
import { TopBar } from '../components/TopBar.js';
import { Podium, TurnEndCard, WaitingForWord, WordPicker } from '../components/Overlays.js';
import { Badge, Button, Panel } from '../components/ui.js';
import { actions, useGame } from '../state/store.js';
import { isMuted, setMuted } from '../audio/sfx.js';

/** The code and the share link, with a copy button that confirms itself. */
function InviteBar({ code }: { code: string }) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const link = `${window.location.origin}/?room=${code}`;

  async function copy(what: 'link' | 'code') {
    try {
      await navigator.clipboard.writeText(what === 'link' ? link : code);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access can be refused; the code is on screen anyway.
      setCopied(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => void copy('code')}
        title="Copy the code"
        className="rounded-2xl border-4 border-ink bg-chalk px-4 py-1.5 font-display text-3xl tracking-[0.25em] text-ink shadow-chunk active:translate-y-1.5 active:shadow-none"
      >
        {code}
      </button>
      <Button tone="aqua" size="sm" onClick={() => void copy('link')}>
        {copied === 'link' ? '✓ Copied' : '🔗 Copy invite link'}
      </Button>
      {copied === 'code' && <Badge tone="mint">Code copied</Badge>}
    </div>
  );
}

function Lobby({ state, isHost }: { state: StatePayload; isHost: boolean }) {
  const present = state.players.filter((p) => !p.disconnected).length;
  const ready = present >= 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="panel items-center gap-3 p-5 text-center">
        <h2 className="font-display text-3xl text-sun text-stroke">Waiting room</h2>
        <p className="text-sm text-chalk/70">
          Share the code so your friends can join.
        </p>
        <InviteBar code={state.code} />
        {isHost ? (
          <>
            <Button
              tone="mint"
              className="mt-1 text-2xl"
              disabled={!ready}
              onClick={() => actions.start()}
            >
              {ready ? '▶  Start the game' : 'Need 2 players'}
            </Button>
            {!state.settings.isPrivate && (
              <Badge tone="aqua">🌍 Listed publicly — anyone can drop in</Badge>
            )}
          </>
        ) : (
          <p className="font-display text-chalk/75">
            Waiting for the host to start…
          </p>
        )}
      </div>

      <Panel title={<span>Game settings</span>} accent="sun" className="min-h-72">
        <SettingsPanel state={state} editable={isHost} />
      </Panel>
    </div>
  );
}

export function Room({ state }: { state: StatePayload }) {
  const youId = useGame((s) => s.youId);
  const leave = useGame((s) => s.leave);
  const turnEnd = useGame((s) => s.turnEnd);
  const gameEnd = useGame((s) => s.gameEnd);
  const connection = useGame((s) => s.connection);
  const [muted, setLocalMuted] = useState(isMuted);
  const [tab, setTab] = useState<'players' | 'chat'>('chat');

  const isHost = state.hostId === youId;
  const inLobby = state.phase === 'lobby';
  const showPodium = state.phase === 'game-end' && gameEnd !== null;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-3 p-3">
      <header className="flex items-center gap-2">
        <h1 className="font-display text-2xl text-sun text-stroke-sm sm:text-3xl">Scrawl</h1>
        <Badge tone="grape" className="hidden sm:inline-flex">
          Room {state.code}
        </Badge>
        {connection === 'reconnecting' && (
          <Badge tone="punch" className="animate-pulse">
            Reconnecting…
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            tone="chalk"
            size="sm"
            title={muted ? 'Sound off' : 'Sound on'}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setLocalMuted(next);
            }}
          >
            {muted ? '🔇' : '🔊'}
          </Button>
          <Button tone="punch" size="sm" onClick={() => leave()}>
            Leave
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[15.5rem_minmax(0,1fr)_19rem]">
        {/* Players: a column on desktop, a tab on small screens. */}
        <Panel
          title={
            <span>
              Players{' '}
              <span className="text-ink/60">
                {state.players.length}/{state.settings.maxPlayers}
              </span>
            </span>
          }
          accent="aqua"
          className={`max-h-[22rem] lg:max-h-none ${tab === 'players' ? '' : 'hidden'} lg:flex`}
        >
          <PlayerList state={state} />
        </Panel>

        <div className="relative flex min-h-0 flex-col gap-3">
          {inLobby ? (
            <Lobby state={state} isHost={isHost} />
          ) : (
            <>
              <TopBar state={state} />
              <div className="panel relative overflow-hidden p-1.5">
                <DrawBoard state={state} />
                {state.phase === 'picking' && state.youAreDrawing && <WordPicker state={state} />}
                {state.phase === 'picking' && !state.youAreDrawing && (
                  <WaitingForWord state={state} />
                )}
                {state.phase === 'turn-end' && turnEnd && (
                  <TurnEndCard state={state} turnEnd={turnEnd} />
                )}
                {showPodium && (
                  <Podium
                    gameEnd={gameEnd}
                    isHost={isHost}
                    suddenDeath={state.settings.mode === 'sudden-death'}
                  />
                )}
              </div>
              {state.youAreDrawing && state.phase === 'drawing' && <Toolbar state={state} />}
            </>
          )}
        </div>

        <Panel
          title={<span>Chat</span>}
          accent="punch"
          className={`min-h-64 ${tab === 'chat' ? '' : 'hidden'} lg:flex`}
        >
          <Chat state={state} />
        </Panel>
      </div>

      {/* Tab switcher, only needed when the columns are stacked. */}
      <nav className="flex gap-2 lg:hidden">
        <Button
          tone={tab === 'players' ? 'aqua' : 'chalk'}
          size="sm"
          block
          onClick={() => setTab('players')}
        >
          Players
        </Button>
        <Button
          tone={tab === 'chat' ? 'punch' : 'chalk'}
          size="sm"
          block
          onClick={() => setTab('chat')}
        >
          Chat
        </Button>
      </nav>
    </div>
  );
}
