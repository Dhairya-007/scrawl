import { useGame } from '../state/store.js';

const TONE_CLASS = {
  info: 'bg-aqua',
  warn: 'bg-sun',
  error: 'bg-punch',
} as const;

/** Short-lived messages from the server, stacked in a corner. */
export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          className={`panel-bright animate-rise pointer-events-auto max-w-sm px-4 py-2 font-display text-ink ${
            TONE_CLASS[toast.tone]
          }`}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}
