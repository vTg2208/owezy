import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../api';
import { useAuth } from '../contexts/AuthContext';
import type { Trip } from '../types';
import LoadingIndicator from '../components/LoadingIndicator';

export default function Dashboard() {
  const { user, logout, deleteAccount } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    if (!user) return () => controller.abort();
    authAPI.getMyTrips().then(setTrips).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Trips could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [user]);

  const handleDeleteAccount = async () => {
    setError('');
    try { await deleteAccount(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Account deletion failed.'); }
  };

  return (
    <main className="page-wrap">
      <nav className="app-bar" aria-label="Account navigation">
        <Link to="/" className="brand-word text-4xl no-underline">Owezy</Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void logout()} className="button button-secondary">Log out</button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="button button-quiet text-red-800">Delete account</button>
        </div>
      </nav>

      <header className="dashboard-head">
        <div>
          <p className="eyebrow">Your travel shelf</p>
          <h1 className="mt-2 text-4xl">Hello, {user?.name}</h1>
          <p className="mt-3 max-w-xl text-muted">Pick up where your group left off, or start a fresh page for the next journey.</p>
        </div>
        <Link to="/home?mode=create" className="button button-primary">Create trip</Link>
      </header>

      {error && <p role="alert" className="notice notice-error mb-5">{error}</p>}
      {confirmDelete && (
        <section className="notice notice-error mb-5" aria-labelledby="delete-account-title">
          <h2 id="delete-account-title" className="text-lg">Permanently delete your account?</h2>
          <p className="mt-1">This cannot be undone. Shared financial history remains for other trip members.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void handleDeleteAccount()} className="button button-danger">Delete permanently</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="button button-quiet">Keep account</button>
          </div>
        </section>
      )}

      <section aria-labelledby="my-trips-title">
        <div className="mb-5"><h2 id="my-trips-title">My trips</h2></div>

        {isLoading ? <LoadingIndicator label="Loading trips…" className="my-8" /> : trips.length === 0 ? (
          <div className="empty-state">
            <p className="text-muted mb-4">Your first trip page is ready when you are.</p>
            <Link to="/home?mode=create" className="button button-secondary">Create your first trip</Link>
          </div>
        ) : (
          <ul className="trip-list list-none p-0">
            {trips.map((trip) => (
              <li key={trip.id} className="trip-row">
                <div className="min-w-0">
                  <p className="eyebrow">{trip.currency ?? 'INR'} trip</p>
                  <h3 className="mt-1 text-xl">{trip.name}</h3>
                </div>
                <div className="text-sm text-muted">
                  <p>Room <span className="font-mono font-bold">{trip.room_code}</span></p>
                  <p className="text-xs">Created {new Date(trip.created_at).toLocaleDateString()}</p>
                </div>
                <Link to={`/trip/${trip.id}`} className="button button-secondary">Open trip</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav aria-label="Trip shortcuts" className="journey-shortcuts">
        <Link to="/home?mode=join" className="button button-quiet">Join with room code</Link>
        <Link to="/home" className="button button-quiet">Accept invitation</Link>
      </nav>
    </main>
  );
}
