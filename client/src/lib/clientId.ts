const KEY = 'scrawl.clientId';

/**
 * A browser-local identity. The server uses it to give a player their seat
 * back after a reload and to remember a kick, so it has to survive a refresh
 * but never needs to leave the device.
 */
export function clientId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private browsing can refuse storage; a per-tab id still plays fine.
    return crypto.randomUUID();
  }
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing here is important enough to interrupt a game over.
  }
}
