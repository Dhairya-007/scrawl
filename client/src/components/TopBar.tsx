import { useEffect, useRef, useState } from 'react';
import { lengthLabel, type GameMode, type StatePayload } from '@scrawl/shared';
import { play } from '../audio/sfx.js';
import { actions, useGame } from '../state/store.js';
import { Badge, Button } from './ui.js';

/** Counts down against the server's deadline, corrected for clock skew. */
function useCountdown(deadline: number | null, skew: number): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (deadline === null) {
      setRemaining(0);
      return;
    }
    const update = () => setRemaining(Math.max(0, deadline - (Date.now() + skew)));
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [deadline, skew]);

  return remaining;
}

function Clock({ state }: { state: StatePayload }) {
  const skew = useGame((s) => s.skew);
  const remaining = useCountdown(state.deadline, skew);
  const seconds = Math.ceil(remaining / 1000);
  const lastBeep = useRef(-1);

  // One beep a second over the last stretch, sharper for the final five.
  useEffect(() => {
    if (state.phase !== 'drawing' || seconds > 10 || seconds <= 0) return;
    if (lastBeep.current === seconds) return;
    lastBeep.current = seconds;
    play(seconds <= 5 ? 'hurry' : 'tick');
  }, [seconds, state.phase]);

  const fraction = state.phaseLength ? Math.min(1, remaining / state.phaseLength) : 0;
  const urgent = state.phase === 'drawing' && seconds <= 10;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-ink font-display text-xl text-ink ${
          urgent ? 'animate-ring bg-punch' : 'bg-sun'
        }`}
        role="timer"
        aria-label={`${seconds} seconds left`}
      >
        {seconds}
      </div>
      <div className="hidden h-3 w-24 overflow-hidden rounded-full border-[3px] border-ink bg-night-900 sm:block">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            urgent ? 'bg-punch' : 'bg-mint'
          }`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/** The word, as blanks for guessers and in full for everyone who has it. */
function WordDisplay({ state }: { state: StatePayload }) {
  const pattern = state.wordPattern;
  if (pattern.length === 0) {
    return (
      <span className="font-display text-lg text-chalk/50">
        {state.phase === 'picking' ? 'Choosing a word…' : 'Waiting…'}
      </span>
    );
  }

  const known = state.youAreDrawing || state.youGuessed || state.phase === 'turn-end';

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="flex flex-wrap items-end justify-center gap-x-1.5 gap-y-1">
        {[...pattern].map((ch, index) =>
          ch === ' ' ? (
            <span key={index} className="w-2" />
          ) : ch === '_' ? (
            <span key={index} className="blank">
              &nbsp;
            </span>
          ) : (
            <span
              key={index}
              className={`font-display text-2xl leading-none tracking-wide ${
                known ? 'text-sun' : 'text-mint'
              }`}
            >
              {ch}
            </span>
          ),
        )}
      </div>
      {!known && (
        <span className="mt-0.5 text-[11px] font-bold tracking-widest text-chalk/45 uppercase">
          {lengthLabel(pattern)} letters
        </span>
      )}
    </div>
  );
}

const MODE_BADGE: Record<GameMode, { icon: string; label: string } | null> = {
  classic: null,
  rapid: { icon: '⚡', label: 'Rapid' },
  'sudden-death': { icon: '💀', label: 'Sudden death' },
};

export function TopBar({ state }: { state: StatePayload }) {
  const youId = useGame((s) => s.youId);
  const canSkip = state.phase === 'drawing' || state.phase === 'picking';
  const voted = youId !== null && state.skipVotes.includes(youId);
  const guessers = state.players.filter(
    (p) => !p.spectating && !p.disconnected && p.id !== state.drawerId,
  ).length;

  return (
    <div className="panel flex-row items-center gap-3 px-3 py-2">
      {state.deadline !== null && state.phase !== 'turn-end' ? (
        <Clock state={state} />
      ) : (
        <Badge tone="grape" className="shrink-0">
          {state.phase === 'turn-end' ? 'Time!' : 'Lobby'}
        </Badge>
      )}

      <div className="flex min-w-0 flex-1 justify-center">
        <WordDisplay state={state} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* In rapid fire the running word count is the thing worth watching. */}
        {state.settings.mode === 'rapid' && state.phase === 'drawing' && (
          <Badge tone="punch" className="animate-pop">
            ⚡ {state.wordsCleared} done
          </Badge>
        )}
        {MODE_BADGE[state.settings.mode] && (
          <Badge tone="grape" className="hidden md:inline-flex">
            {MODE_BADGE[state.settings.mode]!.icon} {MODE_BADGE[state.settings.mode]!.label}
          </Badge>
        )}
        <Badge tone="aqua" className="hidden sm:inline-flex">
          Round {Math.max(1, state.round)}/{state.settings.rounds}
        </Badge>
        {canSkip && !state.youAreDrawing && (
          <Button
            tone={voted ? 'mint' : 'tangerine'}
            size="sm"
            onClick={() => actions.voteSkip()}
            title="Vote to move on"
          >
            Skip {state.skipVotes.length > 0 && `${state.skipVotes.length}/${guessers}`}
          </Button>
        )}
        {canSkip && state.youAreDrawing && (
          <Button tone="tangerine" size="sm" onClick={() => actions.voteSkip()}>
            Give up
          </Button>
        )}
      </div>
    </div>
  );
}
