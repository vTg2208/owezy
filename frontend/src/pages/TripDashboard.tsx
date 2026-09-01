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
import AuditTrail from '../components/AuditTrail';
import LoadingIndicator, { LoadingLabel } from '../components/LoadingIndicator';

type Tab = 'expenses' | 'balances' | 'settlement' | 'chat' | 'activity';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'balances', label: 'Balances' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
];

export default function TripDashboard({ tripId }: { tripId: string }) {
  const navigate = useNavigate();
  const { snapshot, loading, error, refresh, loadOlderExpenses } = useTripSnapshot(tripId);
  const [activeTab, setActiveTab] = useState<Tab>('expenses');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [actionError, setActionError] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const loadPayments = useCallback(async () => {
    try { setPayments(await api.listPayments(tripId)); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Failed to load payments'); }
  }, [tripId]);

  useEffect(() => { void loadPayments(); }, [loadPayments]);

  const refreshAll = async () => {
    await Promise.all([refresh(), loadPayments()]);
  };

  const mutation = async (action: string, work: () => Promise<unknown>) => {
    setActionError('');
    setBusyAction(action);
    try { await work(); await refreshAll(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Action failed'); }
    finally { setBusyAction(''); }
  };

  if (loading && !snapshot) return <main className="loading-screen"><LoadingIndicator label="Loading trip…" /></main>;
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
    <main className="min-h-screen">
      <div className="page-wrap">
        <nav className="app-bar" aria-label="Trip navigation">
          <button type="button" onClick={() => navigate('/dashboard')} className="back-link border-0 bg-transparent" aria-label="Back to dashboard">← Dashboard</button>
          <span className="brand-word text-4xl">Owezy</span>
        </nav>

        <div className="trip-shell">
        <header className="trip-banner">
          <div className="trip-banner-copy">
            <p className="eyebrow">Trip notebook</p>
            <h1 className="mt-2">{capitalizedName}</h1>
            <div className="trip-meta">
              <span className="font-mono font-semibold">Room {trip.room_code}</span>
              <span aria-hidden="true">·</span>
              <span>{trip.currency ?? 'INR'}</span>
              <span className="status-chip">{trip.is_locked ? 'Room closed' : 'Room open'}</span>
            </div>
            <div className="trip-actions">
              {isOwner && <button type="button" disabled={Boolean(busyAction)} onClick={() => void mutation('room', () => trip.is_locked ? api.unlockRoom(tripId) : api.lockRoom(tripId))} className="button button-secondary">{busyAction === 'room' ? <LoadingLabel label={trip.is_locked ? 'Opening room…' : 'Closing room…'} /> : (trip.is_locked ? 'Open room' : 'Close room')}</button>}
              <button type="button" onClick={() => setConfirmLeave(true)} className="button button-quiet text-red-800">Leave trip</button>
            </div>
          <p role="status" className="mt-3 max-w-xl text-sm text-muted">
            {trip.is_locked
              ? 'Room closed to new travellers. Existing travellers can keep adding expenses and settling balances.'
              : 'Room open. New travellers can join by room code or private invitation.'}
          </p>
          {confirmLeave && (
            <div className="notice notice-error mt-3 text-left">
              <p>Leave this trip? Your historical entries will remain.</p>
              <div className="mt-2 flex gap-2"><button type="button" disabled={busyAction === 'leave'} onClick={() => void mutation('leave', async () => { await api.removeParticipant(tripId, currentMemberId); navigate('/dashboard'); })} className="button button-danger">{busyAction === 'leave' ? <LoadingLabel label="Leaving…" /> : 'Confirm leave'}</button><button type="button" onClick={() => setConfirmLeave(false)} className="button button-quiet">Stay</button></div>
            </div>
          )}
          </div>
          <div className="trip-banner-image" role="img" aria-label="Palm trees and string lights beside the sea at sunset" />
        </header>
        {(error || actionError) && <p role="alert" className="notice notice-error m-4">{actionError || error}</p>}

        <section className="people-rail">
          <ParticipantList participants={participants} isAdmin={isOwner} currentUserId={currentMemberId} ownerId={trip.admin_id} onRemove={(memberId) => void mutation(`remove-${memberId}`, () => api.removeParticipant(tripId, memberId))} />
          {isOwner && (trip.is_locked
            ? <p role="status" className="notice text-sm">Open the room before creating a new invitation.</p>
            : <InvitePanel tripId={tripId} />)}
        </section>

        <section className="workspace">
          <div role="tablist" aria-label="Trip sections" className="tab-rail">
            {tabs.map((tab, index) => (
              <button
                key={tab.id} id={`tab-${tab.id}`} role="tab"
                aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)}
                className="tab-button"
              >{tab.label}</button>
            ))}
          </div>
          <div className="tab-panel">
            <div id="panel-expenses" role="tabpanel" aria-labelledby="tab-expenses" hidden={activeTab !== 'expenses'}>
              <div className="expense-workspace">
                <div className="expense-ledger">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <h2 className="text-2xl">Expenses</h2>
                    <span className="text-sm text-muted">{expenses.length} recorded</span>
                  </div>
                  <ExpenseList tripId={tripId} expenses={expenses} participants={participants} currentUserId={currentMemberId} ownerId={trip.admin_id} onChanged={refreshAll} nextCursor={snapshot.expense_next_cursor} onLoadOlder={loadOlderExpenses} />
                </div>
                <aside className="expense-composer">
                  <AddExpense tripId={tripId} participants={participants} onExpenseAdded={refreshAll} receiptUploadsEnabled={snapshot.capabilities?.receipt_uploads ?? false} />
                </aside>
              </div>
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
            <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={activeTab !== 'activity'}>
              {activeTab === 'activity' && <AuditTrail tripId={tripId} />}
            </div>
          </div>
        </section>
        </div>
      </div>
    </main>
  );
}
