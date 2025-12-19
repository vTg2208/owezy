import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Trip, Participant, Expense, Balance, Settlement } from '../types';
import AddExpense from '../components/AddExpense';
import ExpenseList from '../components/ExpenseList';
import BalanceSheet from '../components/BalanceSheet';
import SettlementPlan from '../components/SettlementPlan';
import ParticipantList from '../components/ParticipantList';
import Chat from '../components/Chat';
import lockIcon from '../assets/images/lock_room.png';
import expensesIcon from '../assets/images/expenses.png';
import balanceIcon from '../assets/images/balance-sheet.png';
import settlementIcon from '../assets/images/settlement.png';

interface TripDashboardProps {
  tripId: string;
  participantId: string;
}

export default function TripDashboard({ tripId, participantId }: TripDashboardProps) {
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [settlement, setSettlement] = useState<Settlement[]>([]);
  const [activeTab, setActiveTab] = useState<'expenses' | 'balances' | 'settlement' | 'chat'>('expenses');
  const [loading, setLoading] = useState(true);

  const fetchTripData = async () => {
    try {
      const [tripData, balancesData] = await Promise.all([
        api.getTrip(tripId),
        api.getBalances(tripId)
      ]);

      // Check if current participant still exists in the trip
      const currentParticipant = tripData.participants.find((p: Participant) => p.id === participantId);
      if (!currentParticipant) {
        // Participant was removed, redirect to home
        alert('You have been removed from this trip by the admin.');
        localStorage.removeItem('currentTrip');
        navigate('/');
        return;
      }

      setTrip(tripData.trip);
      setParticipants(tripData.participants);
      setExpenses(tripData.expenses);
      setBalances(balancesData);
      const settlements = await api.getSettlement(tripId);
      setSettlement(settlements);
    } catch (error) {
      console.error('Error fetching trip data:', error);
      // If 401/403, might be auth issue, redirect to login
      if (error instanceof Error && error.message.includes('401')) {
        alert('Session expired. Please login again.');
        navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTripData();

    // Poll for updates every 15 seconds
    const interval = setInterval(fetchTripData, 15000);
    return () => clearInterval(interval);
  }, [tripId]);

  const handleLockRoom = async () => {
    try {
      await api.lockRoom(tripId);
      fetchTripData();
    } catch (error) {
      console.error('Error locking room:', error);
    }
  };

  const handleRemoveParticipant = async (memberId: string) => {
    try {
      await api.removeParticipant(tripId, memberId);
      fetchTripData();
    } catch (error) {
      console.error('Error removing participant:', error);
    }
  };

  const handleExpenseAdded = () => {
    fetchTripData();
  };

  const handleLeaveTrip = () => {
    if (confirm('Are you sure you want to leave this trip?')) {
      localStorage.removeItem('currentTrip');
      navigate('/');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-red-600">Trip not found</div>
      </div>
    );
  }

  const isAdmin = trip.admin_id === participantId;

  // Capitalize first letter of trip name
  const capitalizedTripName = trip.name.charAt(0).toUpperCase() + trip.name.slice(1);

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Trip Title on Background */}
        <div className="mb-8 text-center">
          <h1 
            className="text-7xl md:text-7xl text-white mb-7 drop-shadow-lg"
            style={{ fontFamily: 'Holiday, serif', textShadow: '2px 2px 4px rgba(0,0,0,0.5)' , color: 'black', fontWeight: 400}}
          >
            {capitalizedTripName}
          </h1>
          <p 
            className="text-2xl md:text-3xl text-white drop-shadow-md"
            style={{ fontFamily: 'sans-serif', textShadow: '1px 1px 3px rgba(0,0,0,0.5)', color: 'black' }}
          >
            {trip.room_code}
          </p>
          
          {/* Action Buttons */}
          <div className="flex justify-center gap-3 mt-6">
            {isAdmin && !trip.is_locked ? (
              <button
                onClick={handleLockRoom}
                className="bg-orange-500 text-white px-5 py-3 rounded-lg hover:bg-orange-600 transition flex items-center gap-2 shadow-lg"
              >
                <img src={lockIcon} alt="Lock" className="w-5 h-5" />
                Lock Room
              </button>
            ) : null}
            {trip.is_locked ? (
              <span className="bg-red-100 text-red-700 px-5 py-3 rounded-lg font-semibold flex items-center gap-2 shadow-lg">
                <img src={lockIcon} alt="Locked" className="w-5 h-5" />
                Locked
              </span>
            ) : null}
            <button
              onClick={handleLeaveTrip}
              className="bg-gray-500 text-white px-5 py-3 rounded-lg hover:bg-gray-600 transition shadow-lg"
              title="Leave Trip"
            >
              Leave Trip
            </button>
          </div>
        </div>

        {/* Participants Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <ParticipantList
            participants={participants}
            isAdmin={isAdmin}
            isLocked={trip.is_locked === 1}
            onRemove={handleRemoveParticipant}
          />
        </div>

        {/* Add Expense */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <AddExpense
            tripId={tripId}
            currentUserId={participantId}
            participants={participants}
            onExpenseAdded={handleExpenseAdded}
          />
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('expenses')}
              className={`flex-1 py-4 font-semibold transition flex items-center justify-center gap-2 ${
                activeTab === 'expenses'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <img src={expensesIcon} alt="" className="w-5 h-5" />
              Expenses
            </button>
            <button
              onClick={() => setActiveTab('balances')}
              className={`flex-1 py-4 font-semibold transition flex items-center justify-center gap-2 ${
                activeTab === 'balances'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <img src={balanceIcon} alt="" className="w-5 h-5" />
              Balances
            </button>
            <button
              onClick={() => setActiveTab('settlement')}
              className={`flex-1 py-4 font-semibold transition flex items-center justify-center gap-2 ${
                activeTab === 'settlement'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <img src={settlementIcon} alt="" className="w-5 h-5" />
              Settlement
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-4 font-semibold transition flex items-center justify-center gap-2 ${
                activeTab === 'chat'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              💬
              Chat
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'expenses' && <ExpenseList expenses={expenses} />}
            {activeTab === 'balances' && <BalanceSheet balances={balances} currentUserId={participantId} />}
            {activeTab === 'settlement' && <SettlementPlan settlement={settlement} currentUserId={participantId} />}
            {activeTab === 'chat' && (
              <Chat 
                tripId={tripId} 
                currentUserId={participantId}
                participants={participants}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
