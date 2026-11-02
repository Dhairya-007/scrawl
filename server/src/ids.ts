import { randomBytes, randomUUID } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@scrawl/shared';

/**
 * Room codes are read aloud and typed by hand, so the alphabet leaves out the
 * characters people confuse (0/O, 1/I/L).
 */
export function newRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i]! % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function newPlayerId(): string {
  return randomUUID();
}

export function newMessageId(): string {
  return randomBytes(8).toString('hex');
}

/** Fisher-Yates, in place. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
