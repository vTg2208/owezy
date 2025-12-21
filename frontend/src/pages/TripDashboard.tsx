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

    // Poll for updates every 2 seconds
    const interval = setInterval(fetchTripData, 2000);
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

  const handleUnlockRoom = async () => {
    try {
      await api.unlockRoom(tripId);
      fetchTripData();
    } catch (error) {
      console.error('Error unlocking room:', error);
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

  const handleLeaveTrip = async () => {
    if (confirm('Are you sure you want to leave this trip?')) {
      try {
        await api.removeParticipant(tripId, participantId);
        localStorage.removeItem('currentTrip');
        navigate('/dashboard');
      } catch (error: any) {
        console.error('Error leaving trip:', error);
        alert(error.message || 'Failed to leave trip. Please try again.');
      }
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
    <div className="min-h-screen p-3 sm:p-4 md:p-8 relative">
      {/* Back to Dashboard Arrow */}
      <button
        onClick={() => navigate('/dashboard')}
        className="absolute top-4 left-4 sm:top-6 sm:left-6 p-2 sm:p-3 bg-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-110 group z-10"
        title="Back to Dashboard"
      >
        <svg className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 group-hover:text-indigo-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>
      
      <div className="max-w-6xl mx-auto">
        {/* Trip Title on Background */}
        <div className="mb-4 sm:mb-6 md:mb-8 text-center">
          <h1 
            className="text-4xl sm:text-5xl md:text-7xl text-white mb-3 sm:mb-5 md:mb-7 drop-shadow-lg"
            style={{ fontFamily: 'Holiday, serif', textShadow: '2px 2px 4px rgba(0,0,0,0.5)' , color: 'black', fontWeight: 400}}
          >
            {capitalizedTripName}
          </h1>
          <p 
            className="text-xl sm:text-2xl md:text-3xl text-white drop-shadow-md"
            style={{ fontFamily: 'sans-serif', textShadow: '1px 1px 3px rgba(0,0,0,0.5)', color: 'black' }}
          >
            {trip.room_code}
          </p>
          
          {/* Action Buttons */}
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mt-4 sm:mt-6">
            {isAdmin && !trip.is_locked ? (
              <button
                onClick={handleLockRoom}
                className="bg-orange-500 text-white px-3 sm:px-5 py-2 sm:py-3 rounded-lg hover:bg-orange-600 transition flex items-center gap-2 shadow-lg text-sm sm:text-base"
              >
                <img src={lockIcon} alt="Lock" className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Lock Room</span>
                <span className="sm:hidden">Lock</span>
              </button>
            ) : null}
            {trip.is_locked ? (
              isAdmin ? (
                <button
                  onClick={handleUnlockRoom}
                  className="bg-green-500 text-white px-3 sm:px-5 py-2 sm:py-3 rounded-lg hover:bg-green-600 transition flex items-center gap-2 shadow-lg text-sm sm:text-base"
                >
                  <img src={lockIcon} alt="Unlock" className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="hidden sm:inline">Unlock Room</span>
                  <span className="sm:hidden">Unlock</span>
                </button>
              ) : (
                <span className="bg-red-100 text-red-700 px-3 sm:px-5 py-2 sm:py-3 rounded-lg font-semibold flex items-center gap-2 shadow-lg text-sm sm:text-base">
                  <img src={lockIcon} alt="Locked" className="w-4 h-4 sm:w-5 sm:h-5" />
                  Locked
                </span>
              )
            ) : null}
            <button
              onClick={handleLeaveTrip}
              className="bg-gray-500 text-white px-3 sm:px-5 py-2 sm:py-3 rounded-lg hover:bg-gray-600 transition shadow-lg text-sm sm:text-base"
              title="Leave Trip"
            >
              Leave Trip
            </button>
          </div>
        </div>

        {/* Participants Section */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-4 sm:mb-6">
          <ParticipantList
            participants={participants}
            isAdmin={isAdmin}
            isLocked={trip.is_locked === 1}
            onRemove={handleRemoveParticipant}
          />
        </div>

        {/* Add Expense */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-4 sm:mb-6">
          <AddExpense
            tripId={tripId}
            currentUserId={participantId}
            participants={participants}
            onExpenseAdded={handleExpenseAdded}
          />
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg overflow-hidden">
          <div className="flex border-b overflow-x-auto">
            <button
              onClick={() => setActiveTab('expenses')}
              className={`flex-1 py-3 sm:py-4 font-semibold transition flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base min-w-fit px-2 sm:px-4 ${
                activeTab === 'expenses'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <img src={expensesIcon} alt="" className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Expenses</span>
              <span className="sm:hidden">Exp.</span>
            </button>
            <button
              onClick={() => setActiveTab('balances')}
              className={`flex-1 py-3 sm:py-4 font-semibold transition flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base min-w-fit px-2 sm:px-4 ${
                activeTab === 'balances'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <img src={balanceIcon} alt="" className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Balances</span>
              <span className="sm:hidden">Bal.</span>
            </button>
            <button
              onClick={() => setActiveTab('settlement')}
              className={`flex-1 py-3 sm:py-4 font-semibold transition flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base min-w-fit px-2 sm:px-4 ${
                activeTab === 'settlement'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <img src={settlementIcon} alt="" className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Settlement</span>
              <span className="sm:hidden">Set.</span>
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-3 sm:py-4 font-semibold transition flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base min-w-fit px-2 sm:px-4 ${
                activeTab === 'chat'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="text-base sm:text-lg">💬</span>
              Chat
            </button>
          </div>

          <div className="p-4 sm:p-6">
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
