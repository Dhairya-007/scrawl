import { CANVAS_HEIGHT, CANVAS_WIDTH, type DrawOp, type Tool } from './types.js';

/**
 * The brush palette. The server only accepts colours from this list, so a
 * crafted client cannot smuggle arbitrary strings into everyone's canvas.
 */
export const PALETTE: string[] = [
  '#ffffff', '#c8d0dc', '#8a93a3', '#4c566b', '#222935', '#000000',
  '#ffd1dc', '#ff6b9d', '#ff2e63', '#b3003c', '#7a0029', '#3d0016',
  '#ffe0b8', '#ffb347', '#ff7a00', '#d14600', '#8f2c00', '#4d1700',
  '#fff5b8', '#ffe44d', '#ffcc00', '#d1a000', '#8f6b00', '#4d3900',
  '#d4f7c5', '#8ae06b', '#3fbf3f', '#1f8c2e', '#0f5c22', '#063314',
  '#c5f5f7', '#5fd8e0', '#17b8c9', '#0d8794', '#075a63', '#03323a',
  '#cfe0ff', '#7aa8ff', '#2b6eff', '#1a47b8', '#0f2b7a', '#06163d',
  '#e6d4ff', '#b48aff', '#8042ff', '#5a1fcc', '#3b0f8f', '#1f0750',
  '#f7d9c4', '#d9a877', '#a8713f', '#7a4d26', '#523317', '#2b1a0b',
];

export const BRUSH_SIZES = [4, 10, 20, 36, 60] as const;
export const TOOLS: Tool[] = ['brush', 'eraser', 'fill'];

/** Per-turn ceilings. They bound memory and the size of a canvas resync. */
export const MAX_OPS_PER_TURN = 6000;
export const MAX_POINTS_PER_STROKE = 600;

const PALETTE_SET = new Set(PALETTE.map((c) => c.toLowerCase()));

export function isPaletteColor(color: unknown): color is string {
  return typeof color === 'string' && PALETTE_SET.has(color.toLowerCase());
}

function clampCoord(value: unknown, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  // A little slack outside the canvas keeps strokes that run off the edge.
  return Math.min(max + 64, Math.max(-64, Math.round(n * 10) / 10));
}

/**
 * Turn whatever a client sent into an operation the engine is willing to
 * broadcast, or null if it cannot be made sense of. Coordinates are clamped
 * rather than rejected so a stroke dragged off the canvas still lands.
 */
export function sanitizeDrawOp(raw: unknown, id: number): DrawOp | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const op = raw as Record<string, unknown>;

  if (op.kind === 'clear') return { kind: 'clear', id };

  if (op.kind === 'fill') {
    if (!isPaletteColor(op.color)) return null;
    const x = clampCoord(op.x, CANVAS_WIDTH);
    const y = clampCoord(op.y, CANVAS_HEIGHT);
    if (x === null || y === null) return null;
    // A fill outside the canvas would do nothing but cost everyone a redraw.
    if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return null;
    return { kind: 'fill', id, color: op.color, x, y };
  }

  if (op.kind === 'stroke') {
    const group = Number(op.group);
    if (!Number.isInteger(group) || group < 0 || group > Number.MAX_SAFE_INTEGER) return null;
    const tool = op.tool === 'eraser' ? 'eraser' : 'brush';
    if (tool === 'brush' && !isPaletteColor(op.color)) return null;
    const width = BRUSH_SIZES.includes(op.width as (typeof BRUSH_SIZES)[number])
      ? (op.width as number)
      : null;
    if (width === null) return null;
    if (!Array.isArray(op.points) || op.points.length < 2 || op.points.length % 2 !== 0) return null;

    const points: number[] = [];
    const limit = Math.min(op.points.length, MAX_POINTS_PER_STROKE * 2);
    for (let i = 0; i < limit; i += 2) {
      const x = clampCoord(op.points[i], CANVAS_WIDTH);
      const y = clampCoord(op.points[i + 1], CANVAS_HEIGHT);
      if (x === null || y === null) return null;
      points.push(x, y);
    }
    return {
      kind: 'stroke',
      id,
      group,
      tool,
      color: tool === 'eraser' ? '#ffffff' : (op.color as string),
      width,
      points,
    };
  }

  return null;
}
