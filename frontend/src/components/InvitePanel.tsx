import { useState } from 'react';
import { api } from '../api';

export default function InvitePanel({ tripId }: { tripId: string }) {
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<{ id: string; token: string }>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.createInvite(tripId, email.trim());
      setInvite({ id: result.inviteId, token: result.token });
      setEmail('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invitation creation failed.'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!invite) return;
    try {
      const url = `${window.location.origin}/home#invite=${encodeURIComponent(invite.token)}`;
      await navigator.clipboard.writeText(url);
      setMessage('Private invitation link copied.');
    } catch { setError('Copy failed. Select and copy the token manually.'); }
  };

  const revoke = async () => {
    if (!invite) return;
    setBusy(true); setError('');
    try { await api.revokeInvite(tripId, invite.id); setInvite(undefined); setMessage('Invitation revoked.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Invitation revocation failed.'); }
    finally { setBusy(false); }
  };

  return (
    <details className="group">
      <summary className="button button-secondary w-fit list-none">Invite people</summary>
      <section aria-labelledby="invite-heading" className="mt-4 border-l-2 border-gray-300 pl-4">
      <h3 id="invite-heading" className="text-base">Invite a traveller</h3>
      <p className="mb-3 text-sm text-muted">Create a private link for one email address.</p>
      {error && <p role="alert" className="notice notice-error mb-3">{error}</p>}
      {message && <p role="status" className="notice notice-success mb-3">{message}</p>}
      <form onSubmit={create} className="flex flex-col gap-2">
        <label htmlFor="invite-email" className="sr-only">Traveller email address</label>
        <input id="invite-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="friend@example.com" className="flex-1" />
        <button type="submit" disabled={busy} className="button button-primary">{busy ? 'Creating…' : 'Create private link'}</button>
      </form>
      {invite && (
        <div className="notice mt-3">
          <p className="font-semibold">Copy this now. It is shown only once.</p>
          <code className="my-2 block break-all rounded bg-white p-2 text-sm select-all">{invite.token}</code>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="button button-secondary">Copy invitation link</button>
            <button type="button" onClick={() => void revoke()} disabled={busy} className="button button-quiet text-red-800">Revoke</button>
          </div>
        </div>
      )}
      </section>
    </details>
  );
}
