import { useCallback, useEffect, useRef } from 'react';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type DrawOp,
  type StatePayload,
  type StrokeOp,
} from '@scrawl/shared';
import { applyOp, floodFill, paintStroke, replay, resetCanvas } from '../lib/canvas.js';
import { actions, useGame } from '../state/store.js';

/** How often a stroke in progress is pushed out to the other players. */
const STREAM_INTERVAL_MS = 60;
const CURSOR_INTERVAL_MS = 80;

export function DrawBoard({ state }: { state: StatePayload }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ops = useGame((s) => s.ops);
  const opsEpoch = useGame((s) => s.opsEpoch);
  const brush = useGame((s) => s.brush);
  const cursor = useGame((s) => s.cursor);

  const canDraw = state.youAreDrawing && state.phase === 'drawing';

  /** How many ops from the store have been painted, and from which epoch. */
  const applied = useRef({ epoch: -1, count: 0 });

  /** The drag in progress: its group, the points not yet sent, and the clock. */
  const drag = useRef<{
    group: number;
    pending: number[];
    lastSent: number;
    lastCursor: number;
    active: boolean;
  }>({ group: 0, pending: [], lastSent: 0, lastCursor: 0, active: false });

  const context = useCallback((): CanvasRenderingContext2D | null => {
    return canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null;
  }, []);

  // Paint whatever is new. A fresh epoch means the op list was replaced
  // (a join, an undo or a clear), so the canvas is rebuilt from scratch.
  useEffect(() => {
    const ctx = context();
    if (!ctx) return;

    if (applied.current.epoch !== opsEpoch) {
      replay(ctx, ops);
      applied.current = { epoch: opsEpoch, count: ops.length };
      return;
    }
    if (ops.length > applied.current.count) {
      for (const op of ops.slice(applied.current.count)) applyOp(ctx, op);
      applied.current.count = ops.length;
    }
  }, [ops, opsEpoch, context]);

  // Start every turn on blank paper even before any op arrives.
  useEffect(() => {
    const ctx = context();
    if (ctx && ops.length === 0) resetCanvas(ctx);
  }, [state.drawerId, state.round, context, ops.length]);

  const mirrored = state.settings.twists.includes('mirror');

  function toCanvas(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
    // The mirror twist flips the drawer's hand, not the finished picture, so
    // the flip happens on the way in and everyone sees the same canvas.
    return { x: mirrored ? CANVAS_WIDTH - x : x, y };
  }

  /** Send the points gathered so far as one segment of the current stroke. */
  function flush(final = false): void {
    const current = drag.current;
    if (current.pending.length < 2) return;
    if (current.pending.length === 2 && !final) return;

    const op: Omit<StrokeOp, 'id'> = {
      kind: 'stroke',
      group: current.group,
      tool: brush.tool === 'eraser' ? 'eraser' : 'brush',
      color: brush.color,
      width: brush.width,
      points: [...current.pending],
    };
    actions.sendOps([op]);
    // Carry the last point over so the next segment joins onto this one.
    const tailX = current.pending[current.pending.length - 2]!;
    const tailY = current.pending[current.pending.length - 1]!;
    current.pending = final ? [] : [tailX, tailY];
    current.lastSent = performance.now();
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!canDraw) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = toCanvas(event);
    const ctx = context();

    if (brush.tool === 'fill') {
      if (ctx) floodFill(ctx, x, y, brush.color);
      actions.sendOps([{ kind: 'fill', color: brush.color, x, y }]);
      return;
    }

    drag.current = {
      group: drag.current.group + 1,
      pending: [x, y],
      lastSent: performance.now(),
      lastCursor: 0,
      active: true,
    };
    // Paint the dot straight away so a tap leaves a mark with no round trip.
    if (ctx) {
      paintStroke(ctx, {
        kind: 'stroke',
        id: -1,
        group: drag.current.group,
        tool: brush.tool === 'eraser' ? 'eraser' : 'brush',
        color: brush.color,
        width: brush.width,
        points: [x, y],
      });
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!canDraw) return;
    const { x, y } = toCanvas(event);
    const now = performance.now();

    // Let the others see roughly where the brush is, even between strokes.
    if (now - drag.current.lastCursor > CURSOR_INTERVAL_MS) {
      drag.current.lastCursor = now;
      actions.sendCursor({ x, y, tool: brush.tool, width: brush.width });
    }

    if (!drag.current.active || brush.tool === 'fill') return;

    const pending = drag.current.pending;
    const lastX = pending[pending.length - 2];
    const lastY = pending[pending.length - 1];
    // Drop points too close to the last one; they only cost bandwidth.
    if (lastX !== undefined && lastY !== undefined) {
      if (Math.abs(x - lastX) < 1.2 && Math.abs(y - lastY) < 1.2) return;
    }
    pending.push(x, y);

    // Draw the new piece locally for an instant line.
    const ctx = context();
    if (ctx && lastX !== undefined && lastY !== undefined) {
      paintStroke(ctx, {
        kind: 'stroke',
        id: -1,
        group: drag.current.group,
        tool: brush.tool === 'eraser' ? 'eraser' : 'brush',
        color: brush.color,
        width: brush.width,
        points: [lastX, lastY, x, y],
      });
    }

    if (now - drag.current.lastSent > STREAM_INTERVAL_MS) flush();
  }

  function onPointerUp(): void {
    if (!canDraw || !drag.current.active) return;
    flush(true);
    drag.current.active = false;
    actions.sendCursor(null);
  }

  // A turn can end mid-stroke, so never leave a drag hanging.
  useEffect(() => {
    if (!canDraw && drag.current.active) {
      drag.current.active = false;
      drag.current.pending = [];
    }
  }, [canDraw]);

  const showCursor = cursor && !state.youAreDrawing && state.phase === 'drawing';

  return (
    <div className="relative w-full" style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={`h-full w-full rounded-[calc(var(--radius-chunk)-4px)] bg-chalk ${
          canDraw
            ? brush.tool === 'fill'
              ? 'cursor-cell'
              : 'cursor-crosshair'
            : 'cursor-default'
        }`}
        style={{ touchAction: 'none' }}
        aria-label={canDraw ? 'Drawing canvas' : "The drawer's canvas"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      {/* Where the drawer's brush is, so guessers can follow the hand. */}
      {showCursor && (
        <span
          className="pointer-events-none absolute rounded-full border-2 border-ink/50"
          style={{
            left: `${(cursor.x / CANVAS_WIDTH) * 100}%`,
            top: `${(cursor.y / CANVAS_HEIGHT) * 100}%`,
            width: `${(cursor.width / CANVAS_WIDTH) * 100}%`,
            aspectRatio: '1',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(18, 8, 40, 0.12)',
          }}
        />
      )}
    </div>
  );
}

/** Replays the finished canvas for the turn-end card. */
export function CanvasThumb({ ops }: { ops: DrawOp[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d', { willReadFrequently: true });
    if (ctx) replay(ctx, ops);
  }, [ops]);
  return (
    <canvas
      ref={ref}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="w-full rounded-xl border-4 border-ink bg-chalk"
      aria-label="What was drawn"
    />
  );
}
