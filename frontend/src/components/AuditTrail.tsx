import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuditEvent } from '../types';

function readableAction(action: string) {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export default function AuditTrail({ tripId }: { tripId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.getAudit(tripId).then((result) => { if (active) setEvents(result); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Activity could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tripId]);

  if (loading) return <p role="status" className="text-muted">Loading activity…</p>;
  if (error) return <p role="alert" className="notice notice-error">{error}</p>;
  if (events.length === 0) return <p className="text-muted">No recorded activity yet.</p>;

  return (
    <ol className="mx-auto grid max-w-3xl list-none p-0">
      {events.map((event) => (
        <li key={event.id} className="border-b border-gray-300 pb-3">
          <div className="flex flex-wrap justify-between gap-2">
            <strong>{readableAction(event.action)}</strong>
            <time dateTime={event.created_at} className="text-sm text-muted">{new Date(event.created_at).toLocaleString()}</time>
          </div>
          <p className="text-sm text-muted">{event.entity_type} · {event.entity_id}</p>
        </li>
      ))}
    </ol>
  );
}
