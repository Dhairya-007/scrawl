import { useEffect, useState } from 'react';
import type { GameEndPayload, StatePayload, TurnEndPayload } from '@scrawl/shared';
import { AvatarFace } from './AvatarFace.js';
import { Button } from './ui.js';
import { actions, useGame } from '../state/store.js';

/** A dimmed sheet the game's big moments sit on top of. */
function Curtain({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-night-900/80 p-4 backdrop-blur-sm">
      {children}
    </div>
  );
}

/** Three words to choose from, with a countdown on the picker itself. */
export function WordPicker({ state }: { state: StatePayload }) {
  const choices = state.wordChoices;
  const skew = useGame((s) => s.skew);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (state.deadline === null) return;
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((state.deadline! - (Date.now() + skew)) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [state.deadline, skew]);

  if (!choices || choices.length === 0) return null;

  return (
    <Curtain>
      <div className="panel animate-pop w-full max-w-xl items-center gap-4 p-6 text-center">
        <h2 className="font-display text-3xl text-sun text-stroke">Pick your word</h2>
        <p className="text-sm text-chalk/60">
          {seconds}s before one is picked for you
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {choices.map((word, index) => (
            <Button
              key={`${word}-${index}`}
              tone={(['punch', 'mint', 'aqua', 'grape', 'tangerine'] as const)[index % 5]}
              onClick={() => actions.pickWord(index)}
              className="text-xl"
            >
              {word}
            </Button>
          ))}
        </div>
      </div>
    </Curtain>
  );
}

/** Everyone waits here while the drawer chooses. */
export function WaitingForWord({ state }: { state: StatePayload }) {
  const drawer = state.players.find((p) => p.id === state.drawerId);
  return (
    <Curtain>
      <div className="panel animate-pop flex-row items-center gap-4 p-6">
        {drawer && <AvatarFace avatar={drawer.avatar} className="h-16 w-16 animate-wobble" />}
        <div>
          <h2 className="font-display text-2xl text-chalk">
            {drawer?.name ?? 'Someone'} is choosing a word
          </h2>
          <p className="text-sm text-chalk/60">Get your guessing fingers ready…</p>
        </div>
      </div>
    </Curtain>
  );
}

const REASON_TEXT: Record<TurnEndPayload['reason'], string> = {
  time: 'Time was up!',
  'all-guessed': 'Everybody got it!',
  skipped: 'The turn was skipped',
  'drawer-left': 'The drawer disappeared',
};

export function TurnEndCard({
  state,
  turnEnd,
}: {
  state: StatePayload;
  turnEnd: TurnEndPayload;
}) {
  const rapid = state.settings.mode === 'rapid';
  // Only the players who actually scored, best first.
  const scored = state.players
    .filter((player) => (turnEnd.gains[player.id] ?? 0) > 0)
    .sort((a, b) => (turnEnd.gains[b.id] ?? 0) - (turnEnd.gains[a.id] ?? 0));

  return (
    <Curtain>
      <div className="panel animate-pop w-full max-w-md items-center gap-3 p-6 text-center">
        <p className="font-display text-lg text-chalk/70">
          {rapid && turnEnd.reason === 'time'
            ? 'Time!'
            : REASON_TEXT[turnEnd.reason]}
        </p>

        {rapid ? (
          <>
            <p className="font-display text-5xl text-sun text-stroke">
              {state.wordsCleared}
            </p>
            <p className="font-display text-lg text-chalk/80">
              word{state.wordsCleared === 1 ? '' : 's'} cleared
            </p>
            <p className="text-sm text-chalk/60">
              Last one was <span className="font-display text-sun">{turnEnd.word}</span>
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display text-xl text-chalk/80">The word was</h2>
            <p className="font-display text-4xl break-words text-sun text-stroke">{turnEnd.word}</p>
          </>
        )}

        {scored.length === 0 ? (
          <p className="text-sm text-chalk/55">Nobody scored that round.</p>
        ) : (
          <ul className="mt-1 flex w-full flex-col gap-1.5">
            {scored.map((player) => (
              <li
                key={player.id}
                className="flex items-center gap-2 rounded-xl border-[3px] border-ink bg-night-800 px-2.5 py-1.5"
              >
                <AvatarFace avatar={player.avatar} className="h-8 w-8" />
                <span className="min-w-0 flex-1 truncate text-left font-display">
                  {player.name}
                  {player.id === state.drawerId && ' ✏️'}
                </span>
                <span className="font-display text-mint">+{turnEnd.gains[player.id]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Curtain>
  );
}

const PODIUM = [
  { height: 'h-28', tone: 'bg-sun', medal: '🥇' },
  { height: 'h-20', tone: 'bg-chalk', medal: '🥈' },
  { height: 'h-14', tone: 'bg-tangerine', medal: '🥉' },
];

export function Podium({
  gameEnd,
  isHost,
  suddenDeath = false,
}: {
  gameEnd: GameEndPayload;
  isHost: boolean;
  suddenDeath?: boolean;
}) {
  const [first, second, third] = gameEnd.standings;
  // Second, first, third: the classic podium order reads better than 1-2-3.
  const order = [second, first, third];
  const rest = gameEnd.standings.slice(3);

  return (
    <Curtain>
      <div className="panel animate-pop max-h-full w-full max-w-2xl items-center gap-4 overflow-y-auto p-6 text-center">
        <h2 className="font-display text-4xl text-sun text-stroke">
          {suddenDeath ? 'Last one standing' : 'Final scores'}
        </h2>

        <div className="flex w-full items-end justify-center gap-2 sm:gap-4">
          {order.map((player, index) => {
            if (!player) return <div key={index} className="w-1/4" />;
            const place = PODIUM[index === 1 ? 0 : index === 0 ? 1 : 2]!;
            return (
              <div key={player.id} className="flex w-1/4 flex-col items-center gap-1">
                <AvatarFace avatar={player.avatar} className="h-16 w-16 sm:h-20 sm:w-20" />
                <span className="w-full truncate font-display text-sm text-chalk">
                  {player.name}
                </span>
                <span className="font-display text-lg text-mint">{player.score}</span>
                <div
                  className={`flex w-full items-start justify-center rounded-t-xl border-4 border-b-0 border-ink pt-1 text-2xl ${place.height} ${place.tone}`}
                >
                  {place.medal}
                </div>
              </div>
            );
          })}
        </div>

        {rest.length > 0 && (
          <ul className="flex w-full flex-col gap-1">
            {rest.map((player, index) => (
              <li
                key={player.id}
                className="flex items-center gap-2 rounded-lg border-[3px] border-ink bg-night-800 px-2 py-1 text-sm"
              >
                <span className="w-5 font-display text-chalk/55">{index + 4}</span>
                <AvatarFace avatar={player.avatar} className="h-7 w-7" />
                <span className="min-w-0 flex-1 truncate text-left font-display">{player.name}</span>
                <span className="font-display text-chalk/75">{player.score}</span>
              </li>
            ))}
          </ul>
        )}

        {isHost ? (
          <Button tone="mint" onClick={() => actions.start()} className="text-xl">
            Play again
          </Button>
        ) : (
          <p className="text-sm text-chalk/60">Waiting for the host to start another game…</p>
        )}
      </div>
    </Curtain>
  );
}
