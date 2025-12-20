import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../api/auth';
import { Trip } from '../types';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTrips = async () => {
      if (!user) return;
      
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          const myTrips = await authAPI.getMyTrips(token);
          setTrips(myTrips);
        }
      } catch (error) {
        console.error('Failed to load trips:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTrips();
  }, [user]);

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 sm:mb-8 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Welcome, {user?.name}!</h1>
          </div>
          <button
            onClick={logout}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm sm:text-base w-full sm:w-auto"
          >
            Logout
          </button>
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-800">My Trips</h2>
            <Link
              to="/home"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create New Trip
            </Link>
          </div>

          {isLoading ? (
            <p className="text-gray-500 text-center py-8">Loading trips...</p>
          ) : trips.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">You haven't created any trips yet</p>
              <Link
                to="/home"
                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Your First Trip
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {trips.map((trip) => (
                <div key={trip.id} className="border border-gray-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
                  <h3 className="font-semibold text-lg mb-2">{trip.name}</h3>
                  <p className="text-sm text-gray-600 mb-2">Room Code: <span className="font-mono font-bold">{trip.room_code}</span></p>
                  <p className="text-xs text-gray-500 mb-3">Created {new Date(trip.created_at).toLocaleDateString()}</p>
                  <Link
                    to={`/trip/${trip.id}`}
                    state={{ participantId: trip.member_id }}
                    className="block text-center px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    Open Trip
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Quick Actions</h3>
          <div className="space-y-2 text-sm">
            <Link to="/home?mode=create" className="block text-blue-700 hover:underline">→ Create a new trip</Link>
            <Link to="/home?mode=join" className="block text-blue-700 hover:underline">→ Join an existing trip</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
