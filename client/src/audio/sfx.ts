import { loadJSON, saveJSON } from '../lib/clientId.js';

/**
 * Game sounds, built with the Web Audio API. They are short musical cues
 * rather than recordings, so they add nothing to the download and stay in
 * tune with each other: every pitch below comes from one pentatonic scale.
 */

export type SfxName =
  | 'click'
  | 'join'
  | 'leave'
  | 'turnStart'
  | 'pick'
  | 'correct'
  | 'youCorrect'
  | 'close'
  | 'tick'
  | 'hurry'
  | 'turnEnd'
  | 'win'
  | 'error';

const MUTE_KEY = 'scrawl.muted';
const VOLUME_KEY = 'scrawl.volume';

/** C-major pentatonic, so any two cues played together still agree. */
const NOTE = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
} as const;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = loadJSON(MUTE_KEY, false);
let volume = loadJSON(VOLUME_KEY, 0.7);

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  // Browsers start the context suspended until a gesture unlocks it.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call from the first click so later cues are not swallowed. */
export function unlockAudio(): void {
  audio();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  saveJSON(MUTE_KEY, muted);
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}

export function getVolume(): number {
  return volume;
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  saveJSON(VOLUME_KEY, volume);
  if (master && ctx && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

interface ToneOptions {
  freq: number;
  /** Seconds from now. */
  at?: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency over the note, for a chirp or a drop. */
  sweepTo?: number;
}

/** One shaped note. The short attack and curved decay keep it from clicking. */
function tone({ freq, at = 0, duration = 0.18, type = 'triangle', gain = 0.3, sweepTo }: ToneOptions): void {
  const context = audio();
  if (!context || !master || muted) return;

  const start = context.currentTime + at;
  const osc = context.createOscillator();
  const env = context.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), start + duration);

  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, duration * 0.2));
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Filtered noise, for the soft thud under a reveal. */
function noise(duration = 0.2, gain = 0.12, cutoff = 1400): void {
  const context = audio();
  if (!context || !master || muted) return;

  const frames = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Fade the noise out across the buffer so it lands as one hit.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const env = context.createGain();
  env.gain.value = gain;

  source.connect(filter).connect(env).connect(master);
  source.start();
}

const CUES: Record<SfxName, () => void> = {
  click: () => tone({ freq: NOTE.G5, duration: 0.05, gain: 0.14, type: 'square' }),

  join: () => {
    tone({ freq: NOTE.G4, duration: 0.1, gain: 0.2 });
    tone({ freq: NOTE.C5, at: 0.07, duration: 0.14, gain: 0.22 });
  },

  leave: () => {
    tone({ freq: NOTE.E4, duration: 0.12, gain: 0.18 });
    tone({ freq: NOTE.C4, at: 0.08, duration: 0.16, gain: 0.18 });
  },

  // A rising arpeggio to open a turn.
  turnStart: () => {
    tone({ freq: NOTE.C5, duration: 0.12, gain: 0.22 });
    tone({ freq: NOTE.E5, at: 0.09, duration: 0.12, gain: 0.22 });
    tone({ freq: NOTE.G5, at: 0.18, duration: 0.18, gain: 0.24 });
  },

  pick: () => tone({ freq: NOTE.D5, duration: 0.09, gain: 0.2, type: 'sine' }),

  // Somebody else got it: a short two-note nod.
  correct: () => {
    tone({ freq: NOTE.E5, duration: 0.1, gain: 0.2, type: 'sine' });
    tone({ freq: NOTE.A5, at: 0.08, duration: 0.14, gain: 0.2, type: 'sine' });
  },

  // You got it: brighter, longer, with the octave on top.
  youCorrect: () => {
    tone({ freq: NOTE.C5, duration: 0.12, gain: 0.26, type: 'sine' });
    tone({ freq: NOTE.E5, at: 0.08, duration: 0.12, gain: 0.26, type: 'sine' });
    tone({ freq: NOTE.G5, at: 0.16, duration: 0.14, gain: 0.26, type: 'sine' });
    tone({ freq: NOTE.C6, at: 0.24, duration: 0.3, gain: 0.3, type: 'triangle' });
  },

  close: () => tone({ freq: NOTE.D4, duration: 0.14, gain: 0.18, sweepTo: NOTE.A4 }),

  tick: () => tone({ freq: NOTE.A4, duration: 0.04, gain: 0.1, type: 'square' }),

  // Last seconds: same tick, a fifth up and sharper.
  hurry: () => tone({ freq: NOTE.E5, duration: 0.05, gain: 0.2, type: 'square' }),

  turnEnd: () => {
    noise(0.22, 0.1, 900);
    tone({ freq: NOTE.G4, duration: 0.22, gain: 0.2, sweepTo: NOTE.C4 });
  },

  win: () => {
    const melody: Array<[number, number]> = [
      [NOTE.C5, 0],
      [NOTE.E5, 0.12],
      [NOTE.G5, 0.24],
      [NOTE.C6, 0.36],
      [NOTE.G5, 0.52],
      [NOTE.C6, 0.62],
    ];
    for (const [freq, at] of melody) {
      tone({ freq, at, duration: at < 0.5 ? 0.16 : 0.5, gain: 0.26, type: 'triangle' });
    }
    noise(0.4, 0.07, 2400);
  },

  error: () => tone({ freq: NOTE.D4, duration: 0.18, gain: 0.2, type: 'sawtooth', sweepTo: NOTE.C4 * 0.6 }),
};

export function play(name: SfxName): void {
  if (muted) return;
  try {
    CUES[name]();
  } catch {
    // Audio is a garnish; never let it break the game.
  }
}
