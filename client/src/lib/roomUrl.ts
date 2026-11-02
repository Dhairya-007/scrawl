import { isValidRoomCode, normalizeRoomCode } from '@scrawl/shared';
import { loadJSON, saveJSON } from './clientId.js';

const LAST_ROOM_KEY = 'scrawl.lastRoom';

/**
 * The address bar is the source of truth for which room a tab is looking at,
 * so an invite link can be shared and a reload lands back in the same game.
 */
export function readRoomCode(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('room') ?? params.get('r');
  const candidate = fromQuery ?? window.location.hash.replace('#', '');
  return isValidRoomCode(candidate) ? normalizeRoomCode(candidate) : '';
}

/** Write the room into the URL, or clear it when leaving. */
export function writeRoomCode(code: string | null): void {
  const target = code ? `${window.location.pathname}?room=${code}` : window.location.pathname;
  if (window.location.pathname + window.location.search !== target) {
    window.history.replaceState(null, '', target);
  }
}

/**
 * The last room this browser was seated in. It is what tells a fresh page load
 * apart: the same code means a reload or a return, and the seat can be
 * reclaimed silently; a different code is an invite from somebody else, which
 * should wait for the player to pick a name first.
 */
export function rememberRoom(code: string | null): void {
  saveJSON(LAST_ROOM_KEY, code);
}

export function lastRoom(): string | null {
  const stored = loadJSON<string | null>(LAST_ROOM_KEY, null);
  return typeof stored === 'string' && isValidRoomCode(stored) ? stored : null;
}
