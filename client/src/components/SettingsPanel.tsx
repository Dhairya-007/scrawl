import { useEffect, useState } from 'react';
import {
  DRAW_TIME_CHOICES,
  GAME_MODES,
  LANGUAGES,
  MAX_CUSTOM_WORDS,
  MIN_CUSTOM_WORDS_EXCLUSIVE,
  SETTING_LIMITS,
  RAPID_MAX_DRAW_TIME,
  TWISTS,
  parseCustomWords,
  type GameMode,
  type RoomSettings,
  type StatePayload,
  type Twist,
} from '@scrawl/shared';
import { Select, SettingRow } from './ui.js';
import { actions } from '../state/store.js';

const MODE_INFO: Record<GameMode, { icon: string; label: string; blurb: string }> = {
  classic: {
    icon: '🎨',
    label: 'Classic',
    blurb: 'One word a turn. Pick it, draw it, everyone guesses.',
  },
  rapid: {
    icon: '⚡',
    label: 'Rapid Fire',
    blurb: 'No picking. The second someone gets it, the canvas wipes and the next word is up — how many can you clear before the clock dies?',
  },
  'sudden-death': {
    icon: '💀',
    label: 'Sudden Death',
    blurb: 'The lowest scorer is knocked out at the end of every round. Last one standing wins.',
  },
};

const TWIST_INFO: Record<Twist, { icon: string; label: string; blurb: string }> = {
  mirror: { icon: '🪞', label: 'Mirror', blurb: 'Your strokes come out backwards' },
  'no-takebacks': { icon: '🚫', label: 'No take-backs', blurb: 'No eraser, no undo, no clearing' },
  'one-colour': { icon: '🎯', label: 'One colour', blurb: 'One colour a turn, chosen for you' },
};

const WORD_MODE_LABELS: Record<RoomSettings['wordMode'], string> = {
  standard: 'Built-in',
  mixed: 'Built-in + mine',
  'custom-only': 'Only mine',
};

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function SettingsPanel({
  state,
  editable,
}: {
  state: StatePayload;
  editable: boolean;
}) {
  const { settings } = state;
  // The textarea is local while being typed, then parsed on blur.
  const [wordsDraft, setWordsDraft] = useState(settings.customWords.join(', '));

  useEffect(() => {
    setWordsDraft(settings.customWords.join(', '));
  }, [settings.customWords]);

  const parsed = parseCustomWords(wordsDraft);
  const notEnough =
    settings.wordMode === 'custom-only' && parsed.length < MIN_CUSTOM_WORDS_EXCLUSIVE;

  function update(patch: Partial<RoomSettings>) {
    if (!editable) return;
    actions.settings(patch);
  }

  const disabled = !editable;

  function toggleTwist(twist: Twist) {
    if (!editable) return;
    const next = settings.twists.includes(twist)
      ? settings.twists.filter((t) => t !== twist)
      : [...settings.twists, twist];
    update({ twists: next });
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
      <div className="mb-3 flex flex-col gap-2">
        <span className="font-display text-base text-chalk">Game mode</span>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {GAME_MODES.map((mode) => {
            const info = MODE_INFO[mode];
            const active = settings.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => update({ mode })}
                className={`flex flex-col items-center gap-0.5 rounded-xl border-[3px] border-ink px-2 py-2 text-center transition-transform disabled:opacity-60 ${
                  active ? 'bg-sun text-ink shadow-chunk-sm' : 'bg-night-800 hover:bg-night-600'
                }`}
              >
                <span className="text-xl" aria-hidden="true">
                  {info.icon}
                </span>
                <span className="font-display text-sm leading-tight">{info.label}</span>
              </button>
            );
          })}
        </div>
        <p className="rounded-xl border-[3px] border-ink/50 bg-night-900/60 px-3 py-2 text-xs font-semibold text-chalk/70">
          {MODE_INFO[settings.mode].blurb}
        </p>
      </div>

      <div className="mb-3 flex flex-col gap-1.5">
        <span className="font-display text-base text-chalk">
          Twists <span className="text-xs font-semibold text-chalk/50">stack on any mode</span>
        </span>
        {TWISTS.map((twist) => {
          const info = TWIST_INFO[twist];
          const active = settings.twists.includes(twist);
          return (
            <button
              key={twist}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => toggleTwist(twist)}
              className={`flex items-center gap-2 rounded-xl border-[3px] border-ink px-2.5 py-1.5 text-left transition-colors disabled:opacity-60 ${
                active ? 'bg-grape text-chalk' : 'bg-night-800 hover:bg-night-600'
              }`}
            >
              <span className="text-lg" aria-hidden="true">
                {info.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-sm leading-tight">{info.label}</span>
                <span className="block text-[11px] font-semibold opacity-70">{info.blurb}</span>
              </span>
              <span
                className={`h-5 w-5 shrink-0 rounded-md border-[3px] border-ink ${
                  active ? 'bg-sun' : 'bg-night-900'
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <SettingRow label="Players" hint="Room capacity">
        <Select
          value={settings.maxPlayers}
          disabled={disabled}
          onChange={(event) => update({ maxPlayers: Number(event.target.value) })}
        >
          {range(SETTING_LIMITS.maxPlayers.min, SETTING_LIMITS.maxPlayers.max).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label="Language" hint="Which word list">
        <Select
          value={settings.language}
          disabled={disabled}
          onChange={(event) => update({ language: event.target.value as RoomSettings['language'] })}
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.flag} {language.label}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow
        label="Draw time"
        hint={settings.mode === 'rapid' ? 'Seconds for the whole turn' : 'Seconds per turn'}
      >
        <Select
          value={settings.drawTime}
          disabled={disabled}
          onChange={(event) => update({ drawTime: Number(event.target.value) })}
        >
          {DRAW_TIME_CHOICES.filter(
            (n) => settings.mode !== 'rapid' || n <= RAPID_MAX_DRAW_TIME,
          ).map((n) => (
            <option key={n} value={n}>
              {n}s
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label="Rounds" hint="Turns each">
        <Select
          value={settings.rounds}
          disabled={disabled}
          onChange={(event) => update({ rounds: Number(event.target.value) })}
        >
          {range(SETTING_LIMITS.rounds.min, SETTING_LIMITS.rounds.max).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow
        label="Word choices"
        hint={settings.mode === 'rapid' ? 'Unused in rapid fire' : 'Options for the drawer'}
      >
        <Select
          value={settings.wordCount}
          disabled={disabled || settings.mode === 'rapid'}
          onChange={(event) => update({ wordCount: Number(event.target.value) })}
        >
          {range(SETTING_LIMITS.wordCount.min, SETTING_LIMITS.wordCount.max).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label="Hints" hint="Letters revealed">
        <Select
          value={settings.hints}
          disabled={disabled}
          onChange={(event) => update({ hints: Number(event.target.value) })}
        >
          {range(SETTING_LIMITS.hints.min, SETTING_LIMITS.hints.max).map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'None' : n}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label="Word source" hint="Where words come from">
        <Select
          value={settings.wordMode}
          disabled={disabled}
          onChange={(event) => update({ wordMode: event.target.value as RoomSettings['wordMode'] })}
        >
          {(Object.keys(WORD_MODE_LABELS) as Array<RoomSettings['wordMode']>).map((mode) => (
            <option key={mode} value={mode}>
              {WORD_MODE_LABELS[mode]}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label="Room" hint="Who can find it">
        <Select
          value={settings.isPrivate ? 'private' : 'public'}
          disabled={disabled}
          onChange={(event) => update({ isPrivate: event.target.value === 'private' })}
        >
          <option value="private">🔒 Invite only</option>
          <option value="public">🌍 Anyone can join</option>
        </Select>
      </SettingRow>

      <div className="mt-2 flex flex-col gap-1">
        <span className="font-display text-base text-chalk">Your own words</span>
        <span className="text-xs font-semibold text-chalk/55">
          Separate with commas. {parsed.length}/{MAX_CUSTOM_WORDS} ready.
        </span>
        <textarea
          className="scrollbar-thin h-24 w-full resize-none rounded-xl border-4 border-ink bg-chalk px-3 py-2 text-sm font-bold text-ink placeholder:text-ink/35 focus:outline-none disabled:opacity-60"
          value={wordsDraft}
          disabled={disabled}
          placeholder="pizza, my neighbour's cat, Monday mornings…"
          aria-label="Custom words"
          onChange={(event) => setWordsDraft(event.target.value)}
          onBlur={() => update({ customWords: parseCustomWords(wordsDraft) })}
        />
        {notEnough && (
          <span className="text-xs font-bold text-punch">
            Add at least {MIN_CUSTOM_WORDS_EXCLUSIVE} words to play on yours alone.
          </span>
        )}
      </div>

      {!editable && (
        <p className="mt-2 text-xs font-bold text-chalk/45">
          Only the host can change these.
        </p>
      )}
    </div>
  );
}
