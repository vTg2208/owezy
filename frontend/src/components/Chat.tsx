import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ChatMessage } from '../types';

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
    });
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
      <div className="flex-1 space-y-3 overflow-y-auto border-y border-gray-300 bg-gray-50 p-4">
        {nextCursor && <button type="button" onClick={() => void load(nextCursor)} className="block mx-auto px-4 py-2 text-indigo-700">Load older messages</button>}
        {messages.length === 0 && <p className="text-center text-gray-500">No messages yet. Start the conversation.</p>}
        {messages.map((message) => {
          const mine = message.member_id === currentUserId;
          return (
            <article key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md px-4 py-2 ${mine ? 'bg-green-900 text-white' : 'border border-gray-300 bg-white'}`}>
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
        <button type="submit" disabled={!draft.trim() || busy} className="button button-primary px-6">{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </section>
  );
}
