import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'choose' | 'create' | 'join' | 'accept';

function modeFromParams(params: URLSearchParams): Mode {
  const mode = params.get('mode');
  return mode === 'create' || mode === 'join' || mode === 'accept' ? mode : 'choose';
}

export function invitationFromLocation(_search: string, hash: string): string {
  if (!hash.startsWith('#')) return '';
  return new URLSearchParams(hash.slice(1)).get('invite')?.trim() ?? '';
}

export default function Home() {
  const location = useLocation();
  const initialInvite = invitationFromLocation(location.search, location.hash);
  const [mode, setMode] = useState<Mode>(() => initialInvite
    ? 'accept'
    : modeFromParams(new URLSearchParams(location.search)));
  const [tripName, setTripName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [inviteToken, setInviteToken] = useState(initialInvite);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const token = invitationFromLocation(location.search, location.hash);
    if (token) {
      setMode('accept');
      setInviteToken(token);
      navigate('/home?mode=accept', { replace: true });
      return;
    }
    setMode(modeFromParams(new URLSearchParams(location.search)));
  }, [location.hash, location.search, navigate]);

  const run = async (work: () => Promise<{ tripId: string }>) => {
    setLoading(true);
    setError('');
    try {
      const result = await work();
      navigate(`/trip/${result.tripId}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The trip could not be opened.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTrip = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    void run(() => api.createTrip(tripName.trim(), user.name));
  };

  const handleJoinTrip = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    void run(() => api.joinTrip(roomCode.trim().toUpperCase(), user.name));
  };

  const handleAcceptInvite = (event: React.FormEvent) => {
    event.preventDefault();
    void run(() => api.acceptInvite(inviteToken.trim()));
  };

  return (
    <main className="min-h-screen grid place-items-center p-4">
      <section className="paper-card relative w-full max-w-lg" aria-labelledby="trip-action-title">
        <Link to="/dashboard" className="back-link" aria-label="Back to dashboard">← Dashboard</Link>
        <header className="mb-8 pt-8 text-center">
          <p className="eyebrow">Start a page</p>
          <h1 id="trip-action-title">Plan the next trip</h1>
          <p className="text-muted mt-2">Signed in as {user?.name}</p>
        </header>

        {error && <p role="alert" className="notice notice-error mb-4">{error}</p>}

        {mode === 'choose' && (
          <div className="grid gap-3">
            <button type="button" onClick={() => setMode('create')} className="button button-primary">Create a new trip</button>
            <button type="button" onClick={() => setMode('join')} className="button button-secondary">Join with a room code</button>
            <button type="button" onClick={() => setMode('accept')} className="button button-quiet">Accept an invitation</button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreateTrip} className="form-stack">
            <label htmlFor="trip-name">Trip name</label>
            <input id="trip-name" value={tripName} onChange={(event) => setTripName(event.target.value)} maxLength={100} placeholder="Monsoon in Goa" autoComplete="off" required />
            <button type="submit" disabled={loading || !tripName.trim()} className="button button-primary">{loading ? 'Creating…' : 'Create trip'}</button>
            <button type="button" onClick={() => setMode('choose')} className="button button-quiet">Back</button>
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoinTrip} className="form-stack">
            <label htmlFor="room-code">Room code</label>
            <input id="room-code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" required className="code-input" />
            <button type="submit" disabled={loading || roomCode.trim().length !== 6} className="button button-primary">{loading ? 'Joining…' : 'Join trip'}</button>
            <button type="button" onClick={() => setMode('choose')} className="button button-quiet">Back</button>
          </form>
        )}

        {mode === 'accept' && (
          <form onSubmit={handleAcceptInvite} className="form-stack">
            <label htmlFor="invite-token">Invitation token</label>
            <input id="invite-token" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} autoComplete="off" required aria-describedby="invite-help" />
            <p id="invite-help" className="help-text">Paste the private token sent by the trip owner.</p>
            <button type="submit" disabled={loading || !inviteToken.trim()} className="button button-primary">{loading ? 'Accepting…' : 'Accept invitation'}</button>
            <button type="button" onClick={() => setMode('choose')} className="button button-quiet">Back</button>
          </form>
        )}
      </section>
    </main>
  );
}
