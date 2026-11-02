import { useState } from 'react';
import type { Player, StatePayload } from '@scrawl/shared';
import { AvatarFace } from './AvatarFace.js';
import { Badge } from './ui.js';
import { actions, useGame } from '../state/store.js';

const MEDALS = ['🥇', '🥈', '🥉'];

function Row({
  player,
  rank,
  state,
  youId,
  gain,
}: {
  player: Player;
  rank: number;
  state: StatePayload;
  youId: string | null;
  gain: number | undefined;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mutedPlayers = useGame((s) => s.mutedPlayers);
  const toggleMute = useGame((s) => s.toggleMutePlayer);

  const isYou = player.id === youId;
  const isDrawing = state.drawerId === player.id;
  const isMuted = mutedPlayers.includes(player.id);
  const youAreHost = state.hostId === youId;

  return (
    <li
      className={`relative flex items-center gap-1.5 border-b-[3px] border-ink/40 px-2.5 py-2 last:border-b-0 ${
        isDrawing ? 'bg-sun/25' : player.hasGuessed ? 'bg-mint/20' : ''
      } ${player.disconnected || player.eliminated ? 'opacity-45' : ''}`}
    >
      <span className="w-4 shrink-0 text-center font-display text-sm text-chalk/60">
        {MEDALS[rank] ?? rank + 1}
      </span>

      <div className="relative shrink-0">
        <AvatarFace avatar={player.avatar} className="h-9 w-9" title={`${player.name}'s avatar`} />
        {player.isHost && (
          <span className="absolute -top-1.5 -right-1.5 text-xs" title="Host">
            👑
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate font-display text-base ${isYou ? 'text-sun' : 'text-chalk'}`}
            title={player.name}
          >
            {player.name}
          </span>
          {isYou && <span className="shrink-0 text-xs font-bold text-sun/70">(you)</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap text-chalk/60">
          <span>{player.score} pts</span>
          {player.eliminated ? (
            <span className="text-punch">💀 out</span>
          ) : (
            player.spectating && <span className="text-aqua">watching</span>
          )}
          {player.disconnected && <span className="text-punch">offline</span>}
          {isMuted && <span title="Muted">🔇</span>}
        </div>
      </div>

      {/* Points earned on the turn being shown, as a floating tag. */}
      {gain !== undefined && gain > 0 && (
        <Badge tone="mint" className="animate-pop shrink-0 px-1.5 text-xs">
          +{gain}
        </Badge>
      )}
      {isDrawing && gain === undefined && (
        <span className="shrink-0 text-lg" title="Drawing">
          ✏️
        </span>
      )}
      {player.hasGuessed && !isDrawing && gain === undefined && (
        <span className="shrink-0 text-lg" title="Got the word">
          ✅
        </span>
      )}

      {!isYou && (
        <button
          type="button"
          className="shrink-0 px-1 font-display text-chalk/40 hover:text-chalk"
          aria-label={`Options for ${player.name}`}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
      )}

      {menuOpen && !isYou && (
        <div className="panel absolute top-full right-2 z-20 w-40 gap-1 p-1.5 text-sm">
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-left font-display hover:bg-night-500"
            onClick={() => {
              toggleMute(player.id);
              setMenuOpen(false);
            }}
          >
            {isMuted ? '🔊 Unmute' : '🔇 Mute'}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-left font-display text-tangerine hover:bg-night-500"
            onClick={() => {
              actions.voteKick(player.id);
              setMenuOpen(false);
            }}
          >
            🗳️ Vote to kick
          </button>
          {youAreHost && (
            <button
              type="button"
              className="rounded-lg px-2 py-1.5 text-left font-display text-punch hover:bg-night-500"
              onClick={() => {
                actions.hostKick(player.id);
                setMenuOpen(false);
              }}
            >
              🚫 Kick now
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function PlayerList({ state }: { state: StatePayload }) {
  const youId = useGame((s) => s.youId);
  const turnEnd = useGame((s) => s.turnEnd);

  // Ranked by score, but the list keeps a stable order for equal scores.
  const ranked = [...state.players].sort((a, b) => b.score - a.score);

  return (
    <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" aria-label="Players">
      {ranked.map((player, index) => (
        <Row
          key={player.id}
          player={player}
          rank={index}
          state={state}
          youId={youId}
          gain={turnEnd?.gains[player.id]}
        />
      ))}
    </ul>
  );
}
