import { useState } from 'react';
import { api } from '../api';

export default function InvitePanel({ tripId }: { tripId: string }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const invite = await api.createInvite(tripId, email);
      setToken(invite.token);
      setEmail('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to create invitation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="invite-heading" className="border-t pt-4 mt-4">
      <h3 id="invite-heading" className="font-semibold mb-2">Invite a traveller</h3>
      {error && <p role="alert" className="text-red-700 mb-2">{error}</p>}
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <label htmlFor="invite-email" className="sr-only">Email address</label>
        <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="friend@example.com" className="flex-1 min-w-56 px-3 py-2 border rounded-lg" />
        <button type="submit" disabled={busy} className="px-4 py-2 bg-indigo-700 text-white rounded-lg disabled:opacity-50">{busy ? 'Creating…' : 'Create invite'}</button>
      </form>
      {token && (
        <div role="status" className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-sm font-semibold">Copy this token now. It is shown only once.</p>
          <code className="block break-all mt-1 select-all">{token}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(token)} className="mt-2 text-indigo-700 underline">Copy token</button>
        </div>
      )}
    </section>
  );
}
