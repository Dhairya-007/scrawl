/**
 * Guess matching. Players type fast, without accents and in whichever script
 * is on their keyboard, so a guess is compared on a folded form rather than
 * character for character.
 */

import type { WordEntry } from './types.js';
import { acceptedSpellings } from './words/index.js';

/** Lower case, accents stripped, punctuation and spacing dropped. */
export function normalizeGuess(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9ऀ-ॿ]+/g, '');
}

/**
 * A second, looser fold applied to both sides of a comparison. German is
 * typed either with umlauts or with the `ae`/`oe`/`ue` digraphs, and after
 * accent stripping those two spellings differ; collapsing the digraphs makes
 * them meet. It is applied symmetrically, so the only effect on other
 * languages is that a handful of words match slightly more loosely.
 */
export function foldDigraphs(normalized: string): string {
  return normalized.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
}

function matches(guess: string, candidate: string): boolean {
  const g = normalizeGuess(guess);
  if (g.length === 0) return false;
  const c = normalizeGuess(candidate);
  return g === c || foldDigraphs(g) === foldDigraphs(c);
}

/** Whether a guess is any accepted spelling of the word. */
export function isExactGuess(guess: string, entry: WordEntry | string): boolean {
  const spellings = typeof entry === 'string' ? [entry] : acceptedSpellings(entry);
  return spellings.some((candidate) => matches(guess, candidate));
}

/** Levenshtein distance, bailing out as soon as it exceeds `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, curr[j]!);
    }
    if (rowMin > limit) return limit + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Whether a wrong guess was near enough to nudge the player with a "close!"
 * hint. Short words are excluded: at three letters almost everything is one
 * edit away, which would give the word away.
 */
export function isCloseGuess(guess: string, entry: WordEntry | string): boolean {
  const spellings = typeof entry === 'string' ? [entry] : acceptedSpellings(entry);
  const g = normalizeGuess(guess);
  if (g.length === 0) return false;
  if (isExactGuess(guess, entry)) return false;

  return spellings.some((candidate) => {
    const w = normalizeGuess(candidate);
    if (w.length < 4) return false;
    const tolerance = w.length >= 9 ? 2 : 1;
    return editDistance(g, w, tolerance) <= tolerance;
  });
}

/**
 * The drawer must not type the word, nor anything close to it, while drawing.
 * Checked against every accepted spelling, and token by token so that "a tree
 * over there" is caught for "tree".
 */
export function leaksWord(message: string, entry: WordEntry | string): boolean {
  const spellings = typeof entry === 'string' ? [entry] : acceptedSpellings(entry);
  const whole = normalizeGuess(message);
  if (whole.length === 0) return false;
  const tokens = message.split(/\s+/).map(normalizeGuess).filter((t) => t.length >= 4);

  for (const candidate of spellings) {
    const target = normalizeGuess(candidate);
    if (target.length === 0) continue;
    if (whole.includes(target)) return true;
    // Multi-word answers: mentioning any substantial part of them counts.
    for (const part of candidate.split(/\s+/)) {
      const p = normalizeGuess(part);
      if (p.length >= 4 && whole.includes(p)) return true;
    }
    for (const token of tokens) {
      if (editDistance(token, target, 1) <= 1) return true;
    }
  }
  return false;
}
