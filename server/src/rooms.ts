import type { RoomSettings } from '@scrawl/shared';
import { systemClock, type Clock } from './clock.js';
import { newRoomCode } from './ids.js';
import { Room } from './room.js';

/** A hard ceiling so one host cannot exhaust the process's memory. */
export const MAX_ROOMS = 500;

export class RoomRegistry {
  private rooms = new Map<string, Room>();

  constructor(private readonly clock: Clock = systemClock) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  create(settings?: Partial<RoomSettings>): Room | null {
    if (this.rooms.size >= MAX_ROOMS) return null;

    let code = newRoomCode();
    for (let attempt = 0; this.rooms.has(code) && attempt < 20; attempt++) {
      code = newRoomCode();
    }
    if (this.rooms.has(code)) return null;

    const room = new Room({
      code,
      settings,
      clock: this.clock,
      onEmpty: (emptied) => this.discard(emptied),
    });
    this.rooms.set(code, room);
    return room;
  }

  /**
   * Find a public room to drop a player into: the fullest one that still has
   * space, so games fill up rather than spreading thin across empty rooms.
   */
  findPublic(): Room | null {
    let best: Room | null = null;
    for (const room of this.rooms.values()) {
      if (!room.isPublic || !room.isJoinable) continue;
      if (!best || room.playerCount > best.playerCount) best = room;
    }
    return best;
  }

  discard(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.close();
    this.rooms.delete(code);
  }

  /** For the health endpoint. */
  stats(): { rooms: number; players: number; publicRooms: number } {
    let players = 0;
    let publicRooms = 0;
    for (const room of this.rooms.values()) {
      players += room.playerCount;
      if (room.isPublic) publicRooms++;
    }
    return { rooms: this.rooms.size, players, publicRooms };
  }
}
