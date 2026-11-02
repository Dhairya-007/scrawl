/**
 * Hints. Guessers see the word as underscores; as the clock runs down a few
 * letters are turned over. Spaces and hyphens are always shown so the shape of
 * a multi-word answer is readable from the start.
 */

export const HINT_PLACEHOLDER = '_';

/** Positions that are structure rather than letters, revealed from the start. */
export function isFreeCharacter(ch: string): boolean {
  return /[\s\-'.]/.test(ch);
}

/** Indices of the letters in `word` that a hint could reveal. */
export function hintableIndices(word: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (!isFreeCharacter(word[i]!)) out.push(i);
  }
  return out;
}

/**
 * A word is never given away: at most half its letters are revealed, and at
 * least two are always left hidden, so a two-letter word gets no hints at all.
 */
export function maxHintsFor(word: string, requested: number): number {
  const letters = hintableIndices(word).length;
  return Math.max(0, Math.min(requested, Math.floor(letters / 2), letters - 2));
}

/**
 * Choose, up front, which letters will be revealed and in what order, so the
 * reveal does not depend on how often the server ticks.
 */
export function planHints(
  word: string,
  requested: number,
  random: () => number = Math.random,
): number[] {
  const pool = hintableIndices(word);
  const count = maxHintsFor(word, requested);
  // Fisher-Yates over a copy, then take the first `count`.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

/**
 * How many planned hints should be showing after `elapsed` of `drawTime`
 * milliseconds. Reveals are spread over the turn, the last one landing with a
 * little time still on the clock so it is worth something.
 */
export function hintsRevealedAt(elapsed: number, drawTime: number, total: number): number {
  if (total <= 0 || drawTime <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsed / drawTime));
  let shown = 0;
  for (let i = 0; i < total; i++) {
    // Spread across the window from 35% to 90% of the turn.
    const at = 0.35 + (0.55 * i) / Math.max(1, total - 1 || 1);
    if (progress >= (total === 1 ? 0.5 : at)) shown++;
  }
  return shown;
}

/** Render the word for a guesser, with `revealed` letter indices turned over. */
export function maskWord(word: string, revealed: Iterable<number>): string {
  const show = new Set(revealed);
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    out += isFreeCharacter(ch) || show.has(i) ? ch : HINT_PLACEHOLDER;
  }
  return out;
}

/**
 * The "3 8" style length tag shown next to the blanks. It counts every
 * non-space character, so a word and its mask always report the same figure:
 * the tag is rendered from whichever of the two the viewer is allowed to see.
 */
export function lengthLabel(wordOrMask: string): string {
  return wordOrMask
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => String(part.length))
    .join(' ');
}
