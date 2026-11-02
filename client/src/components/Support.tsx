import { useState } from 'react';
import { Button } from './ui.js';

export const UPI_ID = 'ozadhairya73@oksbi';

/**
 * A UPI deep link. Phones with a UPI app installed open it straight into a
 * payment; on a desktop nothing will handle it, which is why the id is on
 * screen and copyable as well.
 */
const UPI_LINK = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(
  'Dhairya Oza',
)}&cu=INR&tn=${encodeURIComponent('Supporting Scrawl')}`;

export function SupportCard() {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the id is readable on screen anyway.
      setCopied(false);
    }
  }

  return (
    <section className="panel items-center gap-3 p-5 text-center">
      <h2 className="font-display text-2xl text-sun">Keep Scrawl free</h2>
      <p className="max-w-md text-sm text-chalk/70">
        No ads, no accounts, no paid tier — just a server that costs something to
        keep running. If you have had fun here, a little goes a long way.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => void copyId()}
          title="Copy the UPI id"
          className="rounded-2xl border-4 border-ink bg-chalk px-4 py-2 font-display text-lg text-ink shadow-chunk active:translate-y-1.5 active:shadow-none"
        >
          {UPI_ID}
        </button>
        <Button tone="mint" size="sm" onClick={() => void copyId()}>
          {copied ? '✓ Copied' : '📋 Copy UPI id'}
        </Button>
      </div>

      {/* Only of use on a phone, so it says so rather than silently failing. */}
      <a
        href={UPI_LINK}
        className="btn btn-sm bg-sun"
        aria-label="Pay with a UPI app"
      >
        📱 Pay with a UPI app
      </a>
      <p className="text-xs font-bold text-chalk/40">
        Opens your UPI app on a phone. On a computer, copy the id instead.
      </p>
    </section>
  );
}
