/**
 * Points. Guessing early in the turn is worth much more than guessing late,
 * and being first is worth more than following someone else in, so that a game
 * is decided by reading the drawing rather than by racing the keyboard.
 */

export const GUESS_BASE_POINTS = 60;
export const GUESS_TIME_POINTS = 340;
/** Each player who already guessed shaves this much off the next one's score. */
export const ORDER_PENALTY = 0.08;
export const MIN_ORDER_MULTIPLIER = 0.5;

export const DRAWER_BASE_PER_GUESS = 25;
export const DRAWER_SHARE = 0.35;
/** A drawer cannot out-earn a perfect guesser, however big the room. */
export const DRAWER_TURN_CAP = 450;

export interface GuessAward {
  /** Seconds left on the clock when the guess landed. */
  secondsLeft: number;
  /** Full turn length in seconds. */
  drawTime: number;
  /** 0 for the first player to get it, 1 for the next, and so on. */
  order: number;
}

export function guessPoints({ secondsLeft, drawTime, order }: GuessAward): number {
  if (drawTime <= 0) return GUESS_BASE_POINTS;
  const fraction = Math.min(1, Math.max(0, secondsLeft / drawTime));
  const multiplier = Math.max(MIN_ORDER_MULTIPLIER, 1 - order * ORDER_PENALTY);
  return Math.round((GUESS_BASE_POINTS + GUESS_TIME_POINTS * fraction) * multiplier);
}

/**
 * The drawer is paid out of what the guessers earned, so a drawing nobody
 * reads is worth nothing and a drawing everybody reads quickly is worth a lot.
 */
export function drawerPoints(guesserScores: number[]): number {
  if (guesserScores.length === 0) return 0;
  const total = guesserScores.reduce(
    (sum, score) => sum + DRAWER_BASE_PER_GUESS + score * DRAWER_SHARE,
    0,
  );
  return Math.min(DRAWER_TURN_CAP, Math.round(total / Math.sqrt(guesserScores.length)));
}
