import { TWISTS, type GameMode, type LanguageId, type RoomSettings, type Twist, type WordMode } from './types.js';
import { LANGUAGES } from './words/index.js';

export const SETTING_LIMITS = {
  maxPlayers: { min: 2, max: 20 },
  drawTime: { min: 20, max: 240 },
  rounds: { min: 2, max: 10 },
  wordCount: { min: 1, max: 5 },
  hints: { min: 0, max: 5 },
} as const;

export const DRAW_TIME_CHOICES = [20, 30, 40, 50, 60, 80, 100, 120, 150, 180, 240];

export const MAX_CUSTOM_WORDS = 1000;
export const MAX_CUSTOM_WORD_LENGTH = 32;
/** `custom-only` needs enough words that a game cannot run dry. */
export const MIN_CUSTOM_WORDS_EXCLUSIVE = 10;

export const WORD_MODES: WordMode[] = ['standard', 'mixed', 'custom-only'];
export const GAME_MODES: GameMode[] = ['classic', 'rapid', 'sudden-death'];

/** Rapid fire is only fun at a brisk clip, so its turn length is capped. */
export const RAPID_MAX_DRAW_TIME = 120;
/**
 * Nominal seconds a single rapid-fire word is scored and hinted over. The
 * turn clock belongs to the whole turn, so each word needs a window of its
 * own for its hints and its points to mean anything.
 */
export const RAPID_WORD_WINDOW = 30;

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'classic',
  twists: [],
  maxPlayers: 12,
  language: 'en',
  drawTime: 80,
  rounds: 3,
  wordCount: 3,
  hints: 2,
  wordMode: 'standard',
  customWords: [],
  isPrivate: true,
};

export const MAX_NAME_LENGTH = 18;
export const MAX_CHAT_LENGTH = 180;

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Collapse whitespace and strip control characters from user text. */
export function cleanText(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function cleanName(raw: unknown): string {
  const name = cleanText(raw, MAX_NAME_LENGTH);
  return name.length > 0 ? name : 'Player';
}

/** Split a host's textarea into a clean, de-duplicated word list. */
export function parseCustomWords(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n;]/)) {
    const word = cleanText(part, MAX_CUSTOM_WORD_LENGTH);
    if (word.length < 2) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_CUSTOM_WORDS) break;
  }
  return out;
}

/**
 * Coerce anything a client sends into settings the engine can trust. Invalid
 * fields fall back to the current value rather than rejecting the whole update,
 * so one bad field cannot block a host from changing the rest.
 */
export function sanitizeSettings(raw: unknown, current: RoomSettings = DEFAULT_SETTINGS): RoomSettings {
  const input = (raw ?? {}) as Partial<Record<keyof RoomSettings, unknown>>;
  const L = SETTING_LIMITS;

  const language = LANGUAGES.some((l) => l.id === input.language)
    ? (input.language as LanguageId)
    : current.language;

  const customWords = Array.isArray(input.customWords)
    ? parseCustomWords(input.customWords.join('\n'))
    : typeof input.customWords === 'string'
      ? parseCustomWords(input.customWords)
      : current.customWords;

  let wordMode = WORD_MODES.includes(input.wordMode as WordMode)
    ? (input.wordMode as WordMode)
    : current.wordMode;
  // Exclusive custom words only make sense with a pool big enough to play on.
  if (wordMode === 'custom-only' && customWords.length < MIN_CUSTOM_WORDS_EXCLUSIVE) {
    wordMode = customWords.length > 0 ? 'mixed' : 'standard';
  }

  const mode = GAME_MODES.includes(input.mode as GameMode)
    ? (input.mode as GameMode)
    : current.mode;

  const twists = Array.isArray(input.twists)
    ? TWISTS.filter((twist) => (input.twists as unknown[]).includes(twist))
    : current.twists;

  let drawTime = clamp(input.drawTime, current.drawTime, L.drawTime.min, L.drawTime.max);
  if (mode === 'rapid') drawTime = Math.min(drawTime, RAPID_MAX_DRAW_TIME);

  return {
    mode,
    twists,
    maxPlayers: clamp(input.maxPlayers, current.maxPlayers, L.maxPlayers.min, L.maxPlayers.max),
    language,
    drawTime,
    rounds: clamp(input.rounds, current.rounds, L.rounds.min, L.rounds.max),
    wordCount: clamp(input.wordCount, current.wordCount, L.wordCount.min, L.wordCount.max),
    hints: clamp(input.hints, current.hints, L.hints.min, L.hints.max),
    wordMode,
    customWords,
    isPrivate: typeof input.isPrivate === 'boolean' ? input.isPrivate : current.isPrivate,
  };
}
