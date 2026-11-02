import type { Avatar } from './types.js';

/**
 * Avatars are built from these option lists and drawn as SVG on the client, so
 * the wire format for a face is five small integers.
 */
export const AVATAR_COLORS = [
  '#ff4d8d',
  '#ff8a3d',
  '#ffd23f',
  '#6ee36e',
  '#2fd4c4',
  '#38a0ff',
  '#8b6cff',
  '#ff6bd6',
  '#f45b5b',
  '#b6e34d',
  '#4de2a0',
  '#c8a2ff',
];

export const AVATAR_COUNTS = {
  color: AVATAR_COLORS.length,
  /** Head outline: circle, rounded square, egg, blob. */
  face: 4,
  /** Eye style index, rendered in `AvatarFace`. */
  eyes: 8,
  mouth: 8,
  /** 0 means bare-headed. */
  hat: 7,
} as const;

export function randomAvatar(random: () => number = Math.random): Avatar {
  const pick = (n: number) => Math.floor(random() * n);
  return {
    color: pick(AVATAR_COUNTS.color),
    face: pick(AVATAR_COUNTS.face),
    eyes: pick(AVATAR_COUNTS.eyes),
    mouth: pick(AVATAR_COUNTS.mouth),
    hat: pick(AVATAR_COUNTS.hat),
  };
}

/** Clamp a client-supplied avatar into range so rendering cannot fall off. */
export function sanitizeAvatar(raw: unknown): Avatar {
  const input = (raw ?? {}) as Partial<Record<keyof Avatar, unknown>>;
  const wrap = (value: unknown, count: number) => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return ((Math.trunc(n) % count) + count) % count;
  };
  return {
    color: wrap(input.color, AVATAR_COUNTS.color),
    face: wrap(input.face, AVATAR_COUNTS.face),
    eyes: wrap(input.eyes, AVATAR_COUNTS.eyes),
    mouth: wrap(input.mouth, AVATAR_COUNTS.mouth),
    hat: wrap(input.hat, AVATAR_COUNTS.hat),
  };
}
