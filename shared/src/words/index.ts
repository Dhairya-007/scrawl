import type { LanguageId, PoolWord, WordEntry } from '../types.js';
import { EN_WORDS } from './en.js';
import { ES_WORDS } from './es.js';
import { FR_WORDS } from './fr.js';
import { DE_WORDS } from './de.js';
import { HI_WORDS } from './hi.js';
import { NL_WORDS } from './nl.js';

export interface LanguageInfo {
  id: LanguageId;
  /** Name in the language itself, as it appears in the settings menu. */
  label: string;
  flag: string;
}

export const LANGUAGES: LanguageInfo[] = [
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'es', label: 'Español', flag: '🇪🇸' },
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { id: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
];

const POOLS: Record<LanguageId, PoolWord[]> = {
  en: EN_WORDS,
  es: ES_WORDS,
  fr: FR_WORDS,
  de: DE_WORDS,
  nl: NL_WORDS,
  hi: HI_WORDS,
};

export function toWordEntry(word: PoolWord): WordEntry {
  return typeof word === 'string' ? { word } : word;
}

/** Every accepted spelling of a word, the displayed one first. */
export function acceptedSpellings(entry: WordEntry): string[] {
  return [entry.word, ...(entry.alts ?? [])];
}

export function wordPool(language: LanguageId): WordEntry[] {
  return (POOLS[language] ?? EN_WORDS).map(toWordEntry);
}

export function poolSize(language: LanguageId): number {
  return (POOLS[language] ?? EN_WORDS).length;
}
