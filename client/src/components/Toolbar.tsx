import { useEffect } from 'react';
import { BRUSH_SIZES, PALETTE, type StatePayload, type Tool } from '@scrawl/shared';
import { actions, useGame } from '../state/store.js';
import { play } from '../audio/sfx.js';

const TOOLS: Array<{ id: Tool; icon: string; label: string; key: string }> = [
  { id: 'brush', icon: '🖌️', label: 'Brush', key: 'B' },
  { id: 'eraser', icon: '🧽', label: 'Eraser', key: 'E' },
  { id: 'fill', icon: '🪣', label: 'Fill', key: 'F' },
];

export function Toolbar({ state }: { state: StatePayload }) {
  const brush = useGame((s) => s.brush);
  const setBrush = useGame((s) => s.setBrush);

  const noTakebacks = state.settings.twists.includes('no-takebacks');
  const locked = state.lockedColor;
  const tools = TOOLS.filter((tool) => !(noTakebacks && tool.id === 'eraser'));
  const colours = locked ? [locked] : PALETTE;

  // Under the one-colour twist the brush follows whatever the turn rolled.
  useEffect(() => {
    if (locked && brush.color !== locked) setBrush({ color: locked, tool: 'brush' });
  }, [locked, brush.color, setBrush]);

  // The drawer's hands are on the mouse, so the tools get shortcuts.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (!noTakebacks) {
          actions.undo();
          play('click');
        }
        return;
      }
      const key = event.key.toLowerCase();
      const tool = tools.find((t) => t.key.toLowerCase() === key);
      if (tool) {
        setBrush({ tool: tool.id });
        play('click');
        return;
      }
      const sizeIndex = Number(event.key) - 1;
      if (Number.isInteger(sizeIndex) && sizeIndex >= 0 && sizeIndex < BRUSH_SIZES.length) {
        setBrush({ width: BRUSH_SIZES[sizeIndex]! });
        play('click');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setBrush, noTakebacks, tools]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border-4 border-ink bg-night-800 p-2">
      {(locked || noTakebacks || state.settings.twists.includes('mirror')) && (
        <p className="w-full text-center font-display text-xs text-sun">
          {[
            locked ? '🎯 One colour this turn' : null,
            noTakebacks ? '🚫 No take-backs' : null,
            state.settings.twists.includes('mirror') ? '🪞 Your strokes are mirrored' : null,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </p>
      )}
      {/* Colours, six to a column so the whole palette reads as a block. */}
      <div
        className="grid grid-flow-col grid-rows-6 gap-[3px]"
        role="radiogroup"
        aria-label={locked ? 'Brush colour, locked for this turn' : 'Brush colour'}
      >
        {colours.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={brush.color === color}
            aria-label={color}
            title={color}
            onClick={() => {
              // Picking a colour implies you want to paint with it.
              setBrush({ color, tool: brush.tool === 'eraser' ? 'brush' : brush.tool });
              play('click');
            }}
            className={`h-5 w-5 border-2 transition-transform ${
              brush.color === color ? 'z-10 scale-125 border-chalk' : 'border-ink/60 hover:scale-110'
            }`}
            style={{ background: color }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5" role="radiogroup" aria-label="Tool">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="radio"
              aria-checked={brush.tool === tool.id}
              title={`${tool.label} (${tool.key})`}
              onClick={() => {
                setBrush({ tool: tool.id });
                play('click');
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border-[3px] border-ink text-lg shadow-chunk-sm transition-transform active:translate-y-1 active:shadow-none ${
                brush.tool === tool.id ? 'bg-sun' : 'bg-night-600 hover:bg-night-500'
              }`}
            >
              <span aria-hidden="true">{tool.icon}</span>
            </button>
          ))}
        </div>

        <div className={`flex gap-1.5 ${noTakebacks ? 'hidden' : ''}`}>
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            onClick={() => {
              actions.undo();
              play('click');
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border-[3px] border-ink bg-night-600 text-lg shadow-chunk-sm hover:bg-night-500 active:translate-y-1 active:shadow-none"
          >
            <span aria-hidden="true">↩️</span>
            <span className="sr-only">Undo</span>
          </button>
          <button
            type="button"
            title="Clear the canvas"
            onClick={() => {
              actions.clear();
              play('click');
            }}
            className="flex h-10 items-center justify-center gap-1 rounded-xl border-[3px] border-ink bg-punch px-2.5 font-display text-sm text-ink shadow-chunk-sm active:translate-y-1 active:shadow-none"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1" role="radiogroup" aria-label="Brush size">
        {BRUSH_SIZES.map((size, index) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={brush.width === size}
            title={`Size ${index + 1}`}
            onClick={() => {
              setBrush({ width: size });
              play('click');
            }}
            className={`flex h-5 w-14 items-center justify-center rounded-md border-2 ${
              brush.width === size ? 'border-sun bg-night-600' : 'border-ink/50 hover:bg-night-600'
            }`}
          >
            <span
              className="rounded-full bg-chalk"
              style={{
                // Scaled down to fit the swatch while keeping the ratios.
                width: `${Math.max(3, size * 0.32)}px`,
                height: `${Math.max(3, size * 0.32)}px`,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
