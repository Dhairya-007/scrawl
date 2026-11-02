import { CANVAS_HEIGHT, CANVAS_WIDTH, type DrawOp } from '@scrawl/shared';

export const PAPER = '#fff8ec';

export function resetCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.restore();
}

/** Draw one stroke. Round caps and joins keep a fast scribble smooth. */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  op: Extract<DrawOp, { kind: 'stroke' }>,
): void {
  const { points, width } = op;
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = op.tool === 'eraser' ? PAPER : op.color;
  ctx.fillStyle = ctx.strokeStyle;

  if (points.length === 2) {
    // A tap is a dot, which a zero-length path would not render.
    ctx.beginPath();
    ctx.arc(points[0]!, points[1]!, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0]!, points[1]!);
  // Quadratic segments through the midpoints round off the polyline.
  for (let i = 2; i < points.length - 2; i += 2) {
    const midX = (points[i]! + points[i + 2]!) / 2;
    const midY = (points[i + 1]! + points[i + 3]!) / 2;
    ctx.quadraticCurveTo(points[i]!, points[i + 1]!, midX, midY);
  }
  ctx.lineTo(points[points.length - 2]!, points[points.length - 1]!);
  ctx.stroke();
  ctx.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Scanline flood fill. Every client runs the same ops on the same fixed-size
 * buffer, so the result is identical for everyone without sending pixels.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  color: string,
  tolerance = 32,
): void {
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);
  if (x0 < 0 || y0 < 0 || x0 >= CANVAS_WIDTH || y0 >= CANVAS_HEIGHT) return;

  const image = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const pixels = image.data;
  const start = (y0 * CANVAS_WIDTH + x0) * 4;
  const target = [pixels[start]!, pixels[start + 1]!, pixels[start + 2]!] as const;
  const [r, g, b] = hexToRgb(color);
  if (target[0] === r && target[1] === g && target[2] === b) return;

  const limit = tolerance * tolerance * 3;
  const matches = (index: number): boolean => {
    const dr = pixels[index]! - target[0];
    const dg = pixels[index + 1]! - target[1];
    const db = pixels[index + 2]! - target[2];
    return dr * dr + dg * dg + db * db <= limit;
  };

  const stack: number[] = [x0, y0];
  const seen = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    let left = x;
    let right = x;
    const row = y * CANVAS_WIDTH;

    while (left > 0 && matches((row + left - 1) * 4)) left--;
    while (right < CANVAS_WIDTH - 1 && matches((row + right + 1) * 4)) right++;

    for (let sx = left; sx <= right; sx++) {
      const index = (row + sx) * 4;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
      seen[row + sx] = 1;

      // Queue the spans above and below this one.
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= CANVAS_HEIGHT) continue;
        const nIndex = ny * CANVAS_WIDTH + sx;
        if (seen[nIndex] === 0 && matches(nIndex * 4)) {
          seen[nIndex] = 1;
          stack.push(sx, ny);
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
}

export function applyOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  switch (op.kind) {
    case 'clear':
      resetCanvas(ctx);
      return;
    case 'stroke':
      paintStroke(ctx, op);
      return;
    case 'fill':
      floodFill(ctx, op.x, op.y, op.color);
      return;
  }
}

/** Repaint the whole canvas from scratch, used on join, undo and clear. */
export function replay(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void {
  resetCanvas(ctx);
  for (const op of ops) applyOp(ctx, op);
}
