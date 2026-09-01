import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ChatMessage } from '../types';
import LoadingIndicator, { LoadingLabel } from './LoadingIndicator';

interface ChatProps { tripId: string; currentUserId: string }

function chronological(messages: ChatMessage[]) {
  return [...new Map(messages.map((message) => [message.id, message])).values()]
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
}

export default function Chat({ tripId, currentUserId }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async (cursor?: string) => {
    const page = await api.getMessages(tripId, cursor);
    setMessages((current) => chronological(cursor ? [...page.messages, ...current] : page.messages));
    setNextCursor(page.nextCursor);
  }, [tripId]);

  useEffect(() => {
    const controller = new AbortController();
    api.getMessages(tripId, undefined, controller.signal).then((page) => {
      setMessages(chronological(page.messages));
      setNextCursor(page.nextCursor);
      requestAnimationFrame(() => end.current?.scrollIntoView());
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Failed to load chat');
    }).finally(() => { if (!controller.signal.aborted) setInitialLoading(false); });
    return () => controller.abort();
  }, [tripId]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.sendMessage(tripId, draft.trim());
      setDraft('');
      await load();
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to send message');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Trip chat" className="mx-auto flex h-[32rem] max-w-3xl flex-col">
      {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
      <div className="chat-scroll">
        {nextCursor && <button type="button" onClick={() => void load(nextCursor)} className="button button-quiet mx-auto block">Load older messages</button>}
        {initialLoading ? <LoadingIndicator label="Loading messages…" className="my-8" /> : messages.length === 0 && <p className="empty-state text-muted">No messages yet. Start the conversation.</p>}
        {messages.map((message) => {
          const mine = message.member_id === currentUserId;
          return (
            <article key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`chat-bubble ${mine ? 'chat-bubble-mine' : 'chat-bubble-theirs'}`}>
                {!mine && <p className="text-xs font-semibold opacity-75">{message.member_name}</p>}
                <p className="break-words">{message.message}</p>
              </div>
            </article>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="mt-4 flex gap-2">
        <label htmlFor="chat-message" className="sr-only">Message</label>
        <input id="chat-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} disabled={busy} className="flex-1 px-4 py-3 border rounded-lg" placeholder="Write a message" />
        <button type="submit" disabled={!draft.trim() || busy} className="button button-primary px-6">{busy ? <LoadingLabel label="Sending…" /> : 'Send'}</button>
      </form>
    </section>
  );
}
