import { describe, expect, it } from 'vitest';
import { hintableIndices, hintsRevealedAt, lengthLabel, maskWord, maxHintsFor, planHints } from './hints.js';

describe('maskWord', () => {
  it('hides letters and shows structure', () => {
    expect(maskWord('ice cream', [])).toBe('___ _____');
    expect(maskWord("don't", [])).toBe("___'_");
  });

  it('turns over the revealed indices', () => {
    expect(maskWord('tree', [0])).toBe('t___');
    expect(maskWord('tree', [0, 3])).toBe('t__e');
  });
});

describe('maxHintsFor', () => {
  it('never reveals more than half a word', () => {
    expect(maxHintsFor('tree', 5)).toBe(2);
    expect(maxHintsFor('helicopter', 5)).toBe(5);
  });

  it('always leaves at least one letter hidden', () => {
    expect(maxHintsFor('ox', 5)).toBe(0);
    expect(maxHintsFor('cat', 5)).toBe(1);
  });

  it('honours a lower request', () => {
    expect(maxHintsFor('helicopter', 1)).toBe(1);
    expect(maxHintsFor('helicopter', 0)).toBe(0);
  });
});

describe('planHints', () => {
  it('picks the allowed number of distinct letter positions', () => {
    const plan = planHints('helicopter', 3, () => 0.5);
    expect(plan).toHaveLength(3);
    expect(new Set(plan).size).toBe(3);
    for (const index of plan) {
      expect(hintableIndices('helicopter')).toContain(index);
    }
  });

  it('never picks a space', () => {
    for (let i = 0; i < 50; i++) {
      for (const index of planHints('ice cream', 4)) {
        expect('ice cream'[index]).not.toBe(' ');
      }
    }
  });
});

describe('hintsRevealedAt', () => {
  it('shows nothing at the start and everything at the end', () => {
    expect(hintsRevealedAt(0, 80_000, 3)).toBe(0);
    expect(hintsRevealedAt(80_000, 80_000, 3)).toBe(3);
  });

  it('never goes backwards as the clock runs down', () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= 80_000; elapsed += 1_000) {
      const shown = hintsRevealedAt(elapsed, 80_000, 4);
      expect(shown).toBeGreaterThanOrEqual(previous);
      previous = shown;
    }
    expect(previous).toBe(4);
  });

  it('reveals a single hint at the halfway mark', () => {
    expect(hintsRevealedAt(39_000, 80_000, 1)).toBe(0);
    expect(hintsRevealedAt(41_000, 80_000, 1)).toBe(1);
  });

  it('reveals nothing when hints are switched off', () => {
    expect(hintsRevealedAt(79_000, 80_000, 0)).toBe(0);
  });
});

describe('lengthLabel', () => {
  it('reports the length of each part', () => {
    expect(lengthLabel('tree')).toBe('4');
    expect(lengthLabel('ice cream')).toBe('3 5');
  });

  it('reads the same off a word and off its mask', () => {
    for (const word of ['tree', 'ice cream', 'hot air balloon', "don't", 'merry-go-round']) {
      expect(lengthLabel(maskWord(word, [])), word).toBe(lengthLabel(word));
    }
  });

  it('does not report zero for a fully masked word', () => {
    expect(lengthLabel(maskWord('falling', []))).toBe('7');
  });
});
