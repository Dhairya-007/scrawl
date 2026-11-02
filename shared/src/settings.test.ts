import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_CUSTOM_WORDS,
  MIN_CUSTOM_WORDS_EXCLUSIVE,
  cleanName,
  parseCustomWords,
  sanitizeSettings,
} from './settings.js';
import { sanitizeAvatar } from './avatar.js';

describe('sanitizeSettings', () => {
  it('clamps numbers into range', () => {
    const settings = sanitizeSettings({ maxPlayers: 500, drawTime: 1, rounds: -4, hints: 99 });
    expect(settings.maxPlayers).toBe(20);
    expect(settings.drawTime).toBe(20);
    expect(settings.rounds).toBe(2);
    expect(settings.hints).toBe(5);
  });

  it('keeps the current value for a field it cannot read', () => {
    const current = { ...DEFAULT_SETTINGS, rounds: 7 };
    expect(sanitizeSettings({ rounds: 'lots' }, current).rounds).toBe(7);
    expect(sanitizeSettings({}, current).rounds).toBe(7);
  });

  it('rejects an unknown language', () => {
    expect(sanitizeSettings({ language: 'klingon' }).language).toBe(DEFAULT_SETTINGS.language);
  });

  it('refuses custom-only until there are enough words', () => {
    const few = sanitizeSettings({ wordMode: 'custom-only', customWords: 'one, two, three' });
    expect(few.wordMode).toBe('mixed');

    const none = sanitizeSettings({ wordMode: 'custom-only', customWords: '' });
    expect(none.wordMode).toBe('standard');

    const enough = Array.from({ length: MIN_CUSTOM_WORDS_EXCLUSIVE }, (_, i) => `word${i}`).join(',');
    expect(sanitizeSettings({ wordMode: 'custom-only', customWords: enough }).wordMode).toBe('custom-only');
  });

  it('does not trust a nonsense payload', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('parseCustomWords', () => {
  it('splits on commas, newlines and semicolons', () => {
    expect(parseCustomWords('cat, dog\nhorse; cow')).toEqual(['cat', 'dog', 'horse', 'cow']);
  });

  it('drops blanks, one-character entries and duplicates', () => {
    expect(parseCustomWords('cat,,  ,a,CAT,dog')).toEqual(['cat', 'dog']);
  });

  it('caps the list', () => {
    const huge = Array.from({ length: MAX_CUSTOM_WORDS + 50 }, (_, i) => `w${i}`).join(',');
    expect(parseCustomWords(huge)).toHaveLength(MAX_CUSTOM_WORDS);
  });
});

describe('cleanName', () => {
  it('trims, collapses whitespace and truncates', () => {
    expect(cleanName('  Dhairya   Oza ')).toBe('Dhairya Oza');
    expect(cleanName('x'.repeat(50))).toHaveLength(18);
  });

  it('strips control characters that would break the chat layout', () => {
    expect(cleanName('bad\u0000\u001bname')).toBe('bad name');
  });

  it('falls back when nothing usable is left', () => {
    expect(cleanName('   ')).toBe('Player');
    expect(cleanName(undefined)).toBe('Player');
  });
});

describe('sanitizeAvatar', () => {
  it('wraps out-of-range indices instead of failing', () => {
    const avatar = sanitizeAvatar({ color: 999, face: -1, eyes: 2.7, mouth: NaN, hat: '3' });
    expect(avatar.color).toBeGreaterThanOrEqual(0);
    expect(avatar.face).toBeGreaterThanOrEqual(0);
    expect(avatar.eyes).toBe(2);
    expect(avatar.mouth).toBe(0);
    expect(avatar.hat).toBe(3);
  });

  it('copes with junk', () => {
    expect(sanitizeAvatar(null)).toEqual({ color: 0, face: 0, eyes: 0, mouth: 0, hat: 0 });
  });
});
