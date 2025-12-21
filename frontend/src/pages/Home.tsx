import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

interface HomeProps {
  onTripJoin: (data: { tripId: string; participantId: string }) => void;
}

export default function Home({ onTripJoin }: HomeProps) {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'join' ? 'join' : searchParams.get('mode') === 'create' ? 'create' : 'choose';
  const [mode, setMode] = useState<'choose' | 'create' | 'join' | 'created'>(initialMode as 'choose' | 'create' | 'join');
  const [tripName, setTripName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdRoomCode, setCreatedRoomCode] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  // Update mode when URL parameter changes
  useEffect(() => {
    const urlMode = searchParams.get('mode');
    if (urlMode === 'join') {
      setMode('join');
    } else if (urlMode === 'create') {
      setMode('create');
    }
  }, [searchParams]);

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Check if user is logged in
    if (!user) {
      setError('You must be logged in to create a trip. Please login or register first.');
      setLoading(false);
      return;
    }

    try {
      const { tripId, roomCode, member } = await api.createTrip(tripName, user.name);
      setCreatedRoomCode(roomCode);
      // Auto-join as host
      onTripJoin({ tripId, participantId: member.id });
      navigate(`/trip/${tripId}`, { state: { participantId: member.id } });
    } catch (err: any) {
      console.error('Create trip error:', err);
      setError(err.message || 'Failed to create trip. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Check if user is logged in
    if (!user) {
      setError('You must be logged in to join a trip. Please login or register first.');
      setLoading(false);
      return;
    }

    try {
      const { tripId, member } = await api.joinTrip(roomCode.toUpperCase(), user.name);
      onTripJoin({ tripId, participantId: member.id });
      navigate(`/trip/${tripId}`, { state: { participantId: member.id } });
    } catch (err: any) {
      console.error('Join trip error:', err);
      setError(err.message || 'Failed to join trip. Please check the room code.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinAsHost = async () => {
    setLoading(true);
    setError('');

    if (!user) return;

    try {
      const { tripId, member } = await api.joinTrip(createdRoomCode, user.name);
      onTripJoin({ tripId, participantId: member.id });
      navigate(`/trip/${tripId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join trip.');
    } finally {
      setLoading(false);
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(createdRoomCode);
    alert('Room code copied to clipboard!');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      
      <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 max-w-md w-full relative">
        {/* Back to Dashboard Arrow */}
        {user && (
          <Link
            to="/dashboard"
            className="absolute top-4 left-4 p-2 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-all group"
            title="Back to Dashboard"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 group-hover:text-indigo-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
        )}
        <div className="text-center mb-6 sm:mb-8">
          
          {/* User Info */}
          {user ? (
            <div className="mt-4">
              <p className="text-base text-gray-700">Logged in as <span className="font-semibold">{user.name}</span></p>
            </div>
          ) : (
            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-xs sm:text-sm text-yellow-800 mb-2">You need to be logged in to create or join trips</p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link
                  to="/login"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700"
                >
                  Register
                </Link>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {mode === 'choose' && (
          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              className="w-full bg-indigo-600 text-white py-4 rounded-lg font-semibold hover:bg-indigo-700 transition"
            >
              Create New Trip
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full bg-gray-200 text-gray-800 py-4 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              Join Existing Trip
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreateTrip} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trip Name
              </label>
              <input
                type="text"
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
                placeholder="e.g., Goa Trip 2025"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Trip'}
            </button>
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="w-full text-gray-600 hover:text-gray-800"
            >
              Back
            </button>
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoinTrip} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Room Code
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Enter 6-digit code"
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-lg text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent uppercase"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Joining...' : 'Join Trip'}
            </button>
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="w-full text-gray-600 hover:text-gray-800"
            >
              Back
            </button>
          </form>
        )}

        {mode === 'created' && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6 mb-4">
                <p className="text-sm text-green-700 mb-2 font-semibold">Trip Created!</p>
                <p className="text-xs text-gray-600 mb-3">Share this code with your friends:</p>
                <div className="bg-white border-2 border-indigo-300 rounded-lg p-4 mb-3">
                  <p className="text-4xl font-bold text-indigo-600 tracking-widest font-mono">
                    {createdRoomCode}
                  </p>
                </div>
                <button
                  onClick={copyRoomCode}
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Copy Code
                </button>
              </div>
            </div>

            <button
              onClick={handleJoinAsHost}
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Joining...' : 'Continue to Trip'}
            </button>

            <div className="text-center text-sm text-gray-500">
              <p className="font-semibold">Tip: Open this app in 2 other browsers/tabs</p>
              <p>and use the room code to join as other members</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
