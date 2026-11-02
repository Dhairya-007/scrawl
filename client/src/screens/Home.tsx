import { useEffect, useState } from 'react';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, isValidRoomCode } from '@scrawl/shared';
import { readRoomCode } from '../lib/roomUrl.js';
import { AvatarEditor } from '../components/AvatarEditor.js';
import { Button, Field, Panel } from '../components/ui.js';
import { SupportCard } from '../components/Support.js';
import { useGame } from '../state/store.js';

const ERRORS: Record<string, string> = {
  'room-not-found': 'No room with that code. Check it and try again.',
  'room-full': 'That room is full.',
  'room-closed': 'Could not reach the game server. Try again in a moment.',
  'name-taken': 'That name is taken in this room.',
  banned: 'You were removed from that room.',
  'rate-limited': 'Slow down a moment, then try again.',
  invalid: 'That does not look like a room code.',
};

const HOW_IT_WORKS = [
  { icon: '🎲', title: 'Get a word', text: 'Pick one of three and start scribbling.' },
  { icon: '💬', title: 'Guess fast', text: 'The quicker you type it, the more it is worth.' },
  { icon: '👑', title: 'Top the podium', text: 'Points add up over every round.' },
];

export function Home() {
  const profile = useGame((s) => s.profile);
  const setProfile = useGame((s) => s.setProfile);
  const join = useGame((s) => s.join);
  const connection = useGame((s) => s.connection);
  const joinError = useGame((s) => s.joinError);

  // An invite link arrives as `?room=CODE`; it stays in the address bar so
  // the link can be reloaded or shared on again.
  const [invited] = useState(readRoomCode);
  const [code, setCode] = useState(invited);
  const busy = connection === 'joining';
  const canJoinCode = isValidRoomCode(code);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center gap-6 px-4 py-8">
      <header className="flex flex-col items-center text-center">
        <h1 className="font-display text-6xl text-sun text-stroke sm:text-7xl">Scrawl</h1>
      </header>

      <div className="grid w-full gap-5 md:grid-cols-[1fr_1.1fr]">
        <Panel title={<span>Your look</span>} accent="grape">
          <div className="flex flex-col gap-4 p-4">
            <AvatarEditor
              avatar={profile.avatar}
              onChange={(avatar) => setProfile({ avatar })}
            />
            <label className="flex flex-col gap-1">
              <span className="font-display text-base text-chalk">Name</span>
              <Field
                value={profile.name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Who are you?"
                onChange={(event) => setProfile({ name: event.target.value })}
              />
            </label>
          </div>
        </Panel>

        <Panel title={<span>Play</span>} accent="mint">
          <div className="flex flex-col gap-4 p-4">
            {invited && (
              <div className="flex flex-col gap-2 rounded-2xl border-4 border-ink bg-mint/15 p-3">
                <p className="text-center font-display text-base text-mint">
                  You were invited to room {invited}
                </p>
                <Button
                  tone="mint"
                  block
                  className="text-xl"
                  disabled={busy}
                  onClick={() => void join('join', invited)}
                >
                  {busy ? 'Joining…' : `▶  Join ${invited}`}
                </Button>
                <p className="text-center text-xs font-bold text-chalk/55">
                  Set your name and avatar first if you like.
                </p>
              </div>
            )}

            <Button
              tone="punch"
              block
              className="text-2xl"
              disabled={busy}
              onClick={() => void join('quickplay')}
            >
              {busy ? 'Finding a game…' : '▶  Play now'}
            </Button>
            <p className="-mt-2 text-center text-xs font-bold text-chalk/50">
              Drops you into a public room with space, or opens a new one.
            </p>

            <div className="flex items-center gap-3">
              <span className="h-1 flex-1 rounded bg-chalk/15" />
              <span className="font-display text-sm text-chalk/40">or</span>
              <span className="h-1 flex-1 rounded bg-chalk/15" />
            </div>

            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (canJoinCode) void join('join', code);
              }}
            >
              <Field
                value={code}
                maxLength={ROOM_CODE_LENGTH}
                placeholder="ROOM CODE"
                aria-label="Room code"
                autoComplete="off"
                className="text-center tracking-[0.3em] uppercase"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
              <Button tone="aqua" type="submit" disabled={busy || !canJoinCode}>
                Join
              </Button>
            </form>

            <Button
              tone="sun"
              block
              disabled={busy}
              onClick={() => void join('create', undefined, { isPrivate: true })}
            >
              🔒 Create a private room
            </Button>

            {joinError && (
              <p
                className="rounded-xl border-[3px] border-ink bg-punch px-3 py-2 text-center text-sm font-bold text-ink"
                role="alert"
              >
                {ERRORS[joinError] ?? 'Something went wrong.'}
              </p>
            )}
          </div>
        </Panel>
      </div>

      <section className="grid w-full gap-3 sm:grid-cols-3">
        {HOW_IT_WORKS.map((step) => (
          <div key={step.title} className="panel items-start gap-1 p-4">
            <span className="text-3xl" aria-hidden="true">
              {step.icon}
            </span>
            <h2 className="font-display text-lg text-sun">{step.title}</h2>
            <p className="text-sm text-chalk/70">{step.text}</p>
          </div>
        ))}
      </section>

      <SupportCard />

      <footer className="mt-auto pt-4 text-center text-xs font-bold text-chalk/40">
        No accounts, no ads, no cost. Built by Dhairya Oza.
      </footer>
    </main>
  );
}
