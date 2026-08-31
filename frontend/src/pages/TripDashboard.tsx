import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Payment } from '../types';
import { useTripSnapshot } from '../hooks/useTripSnapshot';
import AddExpense from '../components/AddExpense';
import BalanceSheet from '../components/BalanceSheet';
import Chat from '../components/Chat';
import ExpenseList from '../components/ExpenseList';
import InvitePanel from '../components/InvitePanel';
import ParticipantList from '../components/ParticipantList';
import SettlementPlan from '../components/SettlementPlan';

type Tab = 'expenses' | 'balances' | 'settlement' | 'chat';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'balances', label: 'Balances' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'chat', label: 'Chat' },
];

export default function TripDashboard({ tripId }: { tripId: string }) {
  const navigate = useNavigate();
  const { snapshot, loading, error, refresh } = useTripSnapshot(tripId);
  const [activeTab, setActiveTab] = useState<Tab>('expenses');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [actionError, setActionError] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);

  const loadPayments = useCallback(async () => {
    try { setPayments(await api.listPayments(tripId)); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Failed to load payments'); }
  }, [tripId]);

  useEffect(() => { void loadPayments(); }, [loadPayments]);

  const refreshAll = async () => {
    await Promise.all([refresh(), loadPayments()]);
  };

  const mutation = async (work: () => Promise<unknown>) => {
    setActionError('');
    try { await work(); await refreshAll(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Action failed'); }
  };

  if (loading && !snapshot) return <main className="min-h-screen grid place-items-center"><p role="status">Loading trip…</p></main>;
  if (!snapshot) return <main className="min-h-screen grid place-items-center"><p role="alert">{error ?? 'Trip not found'}</p></main>;

  const { trip, participants, expenses, balances, settlements } = snapshot;
  const currentMemberId = snapshot.current_member_id;
  const isOwner = trip.admin_id === currentMemberId;
  const capitalizedName = trip.name.charAt(0).toUpperCase() + trip.name.slice(1);

  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setActiveTab(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <button type="button" onClick={() => navigate('/dashboard')} className="mb-4 min-h-11 px-3 rounded-lg bg-white shadow" aria-label="Back to dashboard">← Dashboard</button>
        <header className="text-center mb-8">
          <p className="text-sm uppercase tracking-widest">Trip notebook</p>
          <h1 className="text-5xl md:text-7xl">{capitalizedName}</h1>
          <p className="font-mono text-xl mt-2">{trip.room_code} · {trip.currency ?? 'INR'}</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {isOwner && <button type="button" onClick={() => void mutation(() => trip.is_locked ? api.unlockRoom(tripId) : api.lockRoom(tripId))} className="px-4 py-2 bg-amber-700 text-white rounded-lg">{trip.is_locked ? 'Unlock trip' : 'Lock trip'}</button>}
            <button type="button" onClick={() => setConfirmLeave(true)} className="px-4 py-2 border border-red-300 text-red-800 rounded-lg">Leave trip</button>
          </div>
          {confirmLeave && (
            <div className="mt-3 inline-block rounded-lg bg-red-50 border border-red-200 p-3 text-left">
              <p>Leave this trip? Your historical entries will remain.</p>
              <div className="flex gap-2 mt-2"><button type="button" onClick={() => void mutation(async () => { await api.removeParticipant(tripId, currentMemberId); navigate('/dashboard'); })} className="px-3 py-2 bg-red-700 text-white rounded">Confirm leave</button><button type="button" onClick={() => setConfirmLeave(false)}>Stay</button></div>
            </div>
          )}
        </header>
        {(error || actionError) && <p role="alert" className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">{actionError || error}</p>}

        <section className="bg-white rounded-2xl shadow p-5 mb-6">
          <ParticipantList participants={participants} isAdmin={isOwner} isLocked={trip.is_locked === 1} currentUserId={currentMemberId} ownerId={trip.admin_id} onRemove={(memberId) => void mutation(() => api.removeParticipant(tripId, memberId))} />
          {isOwner && <InvitePanel tripId={tripId} />}
        </section>
        <section className="bg-white rounded-2xl shadow p-5 mb-6">
          <AddExpense tripId={tripId} participants={participants} onExpenseAdded={refreshAll} />
        </section>

        <section className="bg-white rounded-2xl shadow overflow-hidden">
          <div role="tablist" aria-label="Trip sections" className="flex overflow-x-auto border-b">
            {tabs.map((tab, index) => (
              <button
                key={tab.id} id={`tab-${tab.id}`} role="tab"
                aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)}
                className={`flex-1 min-h-12 px-4 font-semibold ${activeTab === tab.id ? 'bg-indigo-700 text-white' : 'bg-gray-50 text-gray-800'}`}
              >{tab.label}</button>
            ))}
          </div>
          <div className="p-5">
            <div id="panel-expenses" role="tabpanel" aria-labelledby="tab-expenses" hidden={activeTab !== 'expenses'}>
              <ExpenseList tripId={tripId} expenses={expenses} participants={participants} currentUserId={currentMemberId} ownerId={trip.admin_id} onChanged={refreshAll} />
            </div>
            <div id="panel-balances" role="tabpanel" aria-labelledby="tab-balances" hidden={activeTab !== 'balances'}>
              <BalanceSheet balances={balances} currentUserId={currentMemberId} />
            </div>
            <div id="panel-settlement" role="tabpanel" aria-labelledby="tab-settlement" hidden={activeTab !== 'settlement'}>
              <SettlementPlan tripId={tripId} settlement={settlements} payments={payments} currentUserId={currentMemberId} onChanged={refreshAll} />
            </div>
            <div id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" hidden={activeTab !== 'chat'}>
              {activeTab === 'chat' && <Chat tripId={tripId} currentUserId={currentMemberId} />}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
