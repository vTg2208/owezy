import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../api';
import { useAuth } from '../contexts/AuthContext';
import type { Trip } from '../types';

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
      <header className="shelf-hero mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link to="/" className="brand-word text-5xl no-underline">Owezy</Link>
          <p className="eyebrow mt-3">Your travel shelf</p>
          <h1 className="mt-1 text-4xl">Hello, {user?.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void logout()} className="button button-secondary">Log out</button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="button button-quiet text-red-800">Delete account</button>
        </div>
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

      <section className="paper-card" aria-labelledby="my-trips-title">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><p className="eyebrow">Saved journeys</p><h2 id="my-trips-title">My trips</h2></div>
          <Link to="/home?mode=create" className="button button-primary">Create trip</Link>
        </div>

        {isLoading ? <p role="status" className="text-muted py-8 text-center">Loading trips…</p> : trips.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-muted mb-4">Your first trip page is ready when you are.</p>
            <Link to="/home?mode=create" className="button button-secondary">Create your first trip</Link>
          </div>
        ) : (
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <li key={trip.id} className="rounded-xl border border-gray-300 bg-white p-5">
                <p className="eyebrow">{trip.currency ?? 'INR'} trip</p>
                <h3 className="mt-1 text-xl">{trip.name}</h3>
                <p className="mt-3 text-sm text-muted">Room <span className="font-mono font-bold text-gray-900">{trip.room_code}</span></p>
                <p className="text-xs text-muted">Created {new Date(trip.created_at).toLocaleDateString()}</p>
                <Link to={`/trip/${trip.id}`} className="button button-secondary mt-5 w-full">Open trip</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav aria-label="Trip shortcuts" className="journey-shortcuts mt-5 flex flex-wrap gap-3">
        <Link to="/home?mode=join" className="button button-quiet">Join with room code →</Link>
        <Link to="/home" className="button button-quiet">Accept invitation →</Link>
      </nav>
    </main>
  );
}
