import { describe, expect, it } from 'vitest';
import {
  DRAWER_TURN_CAP,
  GUESS_BASE_POINTS,
  MIN_ORDER_MULTIPLIER,
  drawerPoints,
  guessPoints,
} from './scoring.js';

describe('guessPoints', () => {
  it('pays more for guessing early', () => {
    const early = guessPoints({ secondsLeft: 70, drawTime: 80, order: 0 });
    const late = guessPoints({ secondsLeft: 5, drawTime: 80, order: 0 });
    expect(early).toBeGreaterThan(late);
  });

  it('pays more for guessing first', () => {
    const first = guessPoints({ secondsLeft: 40, drawTime: 80, order: 0 });
    const fourth = guessPoints({ secondsLeft: 40, drawTime: 80, order: 3 });
    expect(first).toBeGreaterThan(fourth);
  });

  it('always pays something, even on the buzzer in a huge room', () => {
    const points = guessPoints({ secondsLeft: 0, drawTime: 80, order: 19 });
    expect(points).toBeGreaterThanOrEqual(Math.round(GUESS_BASE_POINTS * MIN_ORDER_MULTIPLIER));
  });

  it('never drops the order multiplier below the floor', () => {
    const many = guessPoints({ secondsLeft: 80, drawTime: 80, order: 50 });
    const atFloor = guessPoints({ secondsLeft: 80, drawTime: 80, order: 7 });
    expect(many).toBe(atFloor);
  });

  it('is monotonic in time remaining', () => {
    let previous = -1;
    for (let left = 0; left <= 80; left += 4) {
      const points = guessPoints({ secondsLeft: left, drawTime: 80, order: 0 });
      expect(points).toBeGreaterThanOrEqual(previous);
      previous = points;
    }
  });

  it('survives a zero-length turn without dividing by zero', () => {
    expect(guessPoints({ secondsLeft: 0, drawTime: 0, order: 0 })).toBe(GUESS_BASE_POINTS);
  });
});

describe('drawerPoints', () => {
  it('pays nothing when nobody got it', () => {
    expect(drawerPoints([])).toBe(0);
  });

  it('pays more when guesses come in fast', () => {
    expect(drawerPoints([380, 360])).toBeGreaterThan(drawerPoints([80, 70]));
  });

  it('rewards a second guesser', () => {
    expect(drawerPoints([300, 280])).toBeGreaterThan(drawerPoints([300]));
  });

  it('stays under the cap in a full room', () => {
    const everyone = Array.from({ length: 19 }, () => 400);
    expect(drawerPoints(everyone)).toBeLessThanOrEqual(DRAWER_TURN_CAP);
  });
});
