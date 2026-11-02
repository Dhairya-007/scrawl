import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH, type ChatMessage, type StatePayload } from '@scrawl/shared';
import { actions, useGame } from '../state/store.js';

/** Each kind of message gets its own colour so the log is readable at a glance. */
const STYLES: Record<ChatMessage['kind'], string> = {
  say: 'text-chalk',
  insider: 'text-aqua',
  system: 'text-chalk/55 italic',
  correct: 'bg-mint/25 text-mint font-display',
  close: 'bg-sun/20 text-sun font-display',
  join: 'text-mint/70 italic',
  leave: 'text-punch/70 italic',
};

function Line({ message }: { message: ChatMessage }) {
  const named = message.kind === 'say' || message.kind === 'insider';
  return (
    <li className={`rounded-lg px-2 py-1 text-sm leading-snug break-words ${STYLES[message.kind]}`}>
      {named && message.authorName && (
        <span className="font-display text-chalk/75">{message.authorName}: </span>
      )}
      {message.kind === 'insider' && <span title="Only players who guessed can see this">🔒 </span>}
      {message.text}
    </li>
  );
}

export function Chat({ state }: { state: StatePayload }) {
  const chat = useGame((s) => s.chat);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const pinnedToBottom = useRef(true);

  // Follow new messages, unless the player has scrolled up to read back.
  useEffect(() => {
    const list = listRef.current;
    if (list && pinnedToBottom.current) list.scrollTop = list.scrollHeight;
  }, [chat]);

  const guessing = state.phase === 'drawing' && !state.youAreDrawing && !state.youGuessed;
  const placeholder = state.youAreDrawing
    ? 'No spoilers!'
    : guessing
      ? 'Type your guess…'
      : state.youGuessed
        ? 'Chat with those who got it'
        : 'Say something…';

  function send() {
    const text = draft.trim();
    if (text.length === 0) return;
    actions.sendChat(text);
    setDraft('');
  }

  return (
    <>
      <ul
        ref={listRef}
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
        aria-live="polite"
        aria-label="Chat and guesses"
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat.length === 0 && (
          <li className="px-2 py-1 text-sm text-chalk/40 italic">
            Guesses and chat land here.
          </li>
        )}
        {chat.map((message) => (
          <Line key={message.id} message={message} />
        ))}
      </ul>

      <form
        className="flex gap-1.5 border-t-4 border-ink p-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-xl border-[3px] border-ink bg-chalk px-3 py-1.5 font-bold text-ink placeholder:text-ink/35 focus:outline-none"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          maxLength={MAX_CHAT_LENGTH}
          aria-label="Your message"
          autoComplete="off"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl border-[3px] border-ink bg-sun px-3 font-display text-ink shadow-chunk-sm active:translate-y-1 active:shadow-none"
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </>
  );
}
