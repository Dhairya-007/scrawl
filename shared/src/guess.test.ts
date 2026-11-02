import { describe, expect, it } from 'vitest';
import { editDistance, foldDigraphs, isCloseGuess, isExactGuess, leaksWord, normalizeGuess } from './guess.js';
import { LANGUAGES, acceptedSpellings, wordPool } from './words/index.js';

describe('normalizeGuess', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeGuess('  Ice-Cream! ')).toBe('icecream');
    expect(normalizeGuess('pingüino')).toBe('pinguino');
    expect(normalizeGuess('éclair')).toBe('eclair');
  });

  it('expands the German sharp s', () => {
    expect(normalizeGuess('Fuß')).toBe('fuss');
  });

  it('keeps Devanagari', () => {
    expect(normalizeGuess('बिल्ली')).toBe(normalizeGuess(' बिल्ली '));
    expect(normalizeGuess('बिल्ली').length).toBeGreaterThan(0);
  });
});

describe('isExactGuess', () => {
  it('accepts sloppy spacing and accents', () => {
    expect(isExactGuess('ice cream', 'ice cream')).toBe(true);
    expect(isExactGuess('icecream', 'ice cream')).toBe(true);
    expect(isExactGuess('ICE-CREAM', 'ice cream')).toBe(true);
  });

  it('rejects an empty guess', () => {
    expect(isExactGuess('', 'tree')).toBe(false);
    expect(isExactGuess('   ', 'tree')).toBe(false);
  });

  it('accepts German umlaut digraphs', () => {
    expect(isExactGuess('Kaese', 'Käse')).toBe(true);
    expect(isExactGuess('Käse', 'Käse')).toBe(true);
    expect(isExactGuess('Loewe', 'Löwe')).toBe(true);
  });

  it('accepts a romanised spelling listed as an alternate', () => {
    const entry = { word: 'बिल्ली', alts: ['billi', 'billee'] };
    expect(isExactGuess('billi', entry)).toBe(true);
    expect(isExactGuess('BILLEE', entry)).toBe(true);
    expect(isExactGuess('बिल्ली', entry)).toBe(true);
    expect(isExactGuess('kutta', entry)).toBe(false);
  });
});

describe('isCloseGuess', () => {
  it('flags a one-letter miss', () => {
    expect(isCloseGuess('treee', 'tree')).toBe(true);
    expect(isCloseGuess('hourse', 'horse')).toBe(true);
  });

  it('does not flag the right answer', () => {
    expect(isCloseGuess('tree', 'tree')).toBe(false);
  });

  it('leaves very short words alone, where everything is one edit away', () => {
    expect(isCloseGuess('bat', 'cat')).toBe(false);
    expect(isCloseGuess('sun', 'fun')).toBe(false);
  });

  it('allows two edits on long words', () => {
    expect(isCloseGuess('helicoptor', 'helicopter')).toBe(true);
    expect(isCloseGuess('skatebord', 'skateboard')).toBe(true);
  });

  it('is not fooled by something unrelated', () => {
    expect(isCloseGuess('elephant', 'tree')).toBe(false);
  });
});

describe('leaksWord', () => {
  it('catches the drawer naming the word', () => {
    expect(leaksWord('its a tree obviously', 'tree')).toBe(true);
    expect(leaksWord('TREE', 'tree')).toBe(true);
  });

  it('catches a near miss and a part of a multi-word answer', () => {
    expect(leaksWord('this is a trees', 'tree')).toBe(true);
    expect(leaksWord('think cream', 'ice cream')).toBe(true);
  });

  it('lets ordinary chatter through', () => {
    expect(leaksWord('come on you can see it', 'tree')).toBe(false);
    expect(leaksWord('nearly there', 'helicopter')).toBe(false);
  });

  it('checks alternates too', () => {
    const entry = { word: 'बिल्ली', alts: ['billi'] };
    expect(leaksWord('its a billi', entry)).toBe(true);
  });
});

describe('editDistance', () => {
  it('matches known values', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('stops early without reporting a smaller distance', () => {
    expect(editDistance('kitten', 'sitting', 1)).toBeGreaterThan(1);
  });
});

describe('word pools', () => {
  it('has a usable pool for every advertised language', () => {
    for (const language of LANGUAGES) {
      const pool = wordPool(language.id);
      expect(pool.length, language.id).toBeGreaterThan(100);
    }
  });

  it('has no duplicate or empty words in any pool', () => {
    for (const language of LANGUAGES) {
      const seen = new Set<string>();
      for (const entry of wordPool(language.id)) {
        const key = normalizeGuess(entry.word);
        expect(key.length, `${language.id}: ${entry.word}`).toBeGreaterThan(0);
        expect(seen.has(key), `${language.id}: duplicate ${entry.word}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('never lists an alternate that collides with its own display word', () => {
    for (const language of LANGUAGES) {
      for (const entry of wordPool(language.id)) {
        const spellings = acceptedSpellings(entry).map(normalizeGuess).map(foldDigraphs);
        expect(new Set(spellings).size, `${language.id}: ${entry.word}`).toBe(spellings.length);
      }
    }
  });
});
