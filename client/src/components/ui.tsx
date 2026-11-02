import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { play, unlockAudio } from '../audio/sfx.js';

export type Tone = 'punch' | 'sun' | 'mint' | 'aqua' | 'grape' | 'chalk' | 'tangerine';

const TONE_CLASS: Record<Tone, string> = {
  punch: 'bg-punch',
  sun: 'bg-sun',
  mint: 'bg-mint',
  aqua: 'bg-aqua',
  grape: 'bg-grape text-chalk',
  chalk: 'bg-chalk',
  tangerine: 'bg-tangerine',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  size?: 'md' | 'sm';
  /** Stretch to the width of the parent. */
  block?: boolean;
}

export function Button({
  tone = 'sun',
  size = 'md',
  block = false,
  className = '',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn ${size === 'sm' ? 'btn-sm' : ''} ${TONE_CLASS[tone]} ${
        block ? 'w-full' : ''
      } ${className}`}
      onClick={(event) => {
        // The first gesture is also what unlocks the audio context.
        unlockAudio();
        play('click');
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({
  children,
  className = '',
  title,
  accent = 'grape',
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  accent?: Tone;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title !== undefined && (
        <header
          className={`flex items-center justify-between gap-2 rounded-t-[calc(var(--radius-chunk)-4px)] border-b-4 border-ink px-4 py-2 font-display text-lg text-ink ${TONE_CLASS[accent]}`}
        >
          {title}
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

export function Field({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`field ${className}`} {...rest} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`field cursor-pointer appearance-none ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** A labelled row used throughout the settings panel. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block font-display text-base text-chalk">{label}</span>
        {hint && <span className="block text-xs font-semibold text-chalk/55">{hint}</span>}
      </span>
      <span className="w-40 shrink-0">{children}</span>
    </label>
  );
}

export function Badge({
  children,
  tone = 'grape',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-[3px] border-ink px-2.5 py-0.5 font-display text-sm text-ink ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
