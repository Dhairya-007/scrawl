import { useEffect, useRef } from 'react';
import { Home } from './screens/Home.js';
import { Room } from './screens/Room.js';
import { Toasts } from './components/Toasts.js';
import { useGame } from './state/store.js';
import { unlockAudio } from './audio/sfx.js';
import { AvatarFace } from './components/AvatarFace.js';

/** Shown for the moment it takes to reclaim a seat after a reload. */
function Booting() {
  const avatar = useGame((s) => s.profile.avatar);
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4">
      <AvatarFace avatar={avatar} className="h-20 w-20 animate-wobble" />
      <p className="font-display text-xl text-chalk/80">Getting you back in…</p>
    </main>
  );
}

export function App() {
  const screen = useGame((s) => s.screen);
  const state = useGame((s) => s.state);
  const booting = useGame((s) => s.booting);
  const boot = useGame((s) => s.boot);
  const booted = useRef(false);

  // Browsers keep audio suspended until a gesture, so arm it on the first one.
  useEffect(() => {
    const arm = () => unlockAudio();
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  // Reclaim the seat named by the address bar, once. The ref guards against
  // React's development double-invoke, which would otherwise join twice.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void boot();
  }, [boot]);

  // Warn before a reload that would drop you out of a live game.
  useEffect(() => {
    if (screen !== 'room' || !state || state.phase === 'lobby') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [screen, state]);

  if (booting) return <Booting />;

  return (
    <>
      {screen === 'room' && state ? <Room state={state} /> : <Home />}
      <Toasts />
    </>
  );
}
