import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Expense, Participant } from '../types';
import { ReceiptObjectUrlLifecycle } from '../utils/receiptObjectUrl';
import { buildEqualSplits } from '../utils/splitBuilder';
import { LoadingLabel } from './LoadingIndicator';

interface ExpenseListProps {
  tripId: string;
  expenses: Expense[];
  participants: Participant[];
  currentUserId: string;
  ownerId: string;
  onChanged: () => void | Promise<void>;
  nextCursor?: string;
  onLoadOlder?: () => Promise<void>;
}

export default function ExpenseList({
  tripId, expenses, participants, currentUserId, ownerId, onChanged, nextCursor, onLoadOlder,
}: ExpenseListProps) {
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
  const [editing, setEditing] = useState<string>();
  const [confirmVoid, setConfirmVoid] = useState<string>();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [busyExpense, setBusyExpense] = useState<string>();
  const receiptUrls = useRef<ReceiptObjectUrlLifecycle>();
  const receiptTrigger = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const lifecycle = new ReceiptObjectUrlLifecycle();
    receiptUrls.current = lifecycle;
    return () => lifecycle.dispose();
  }, []);

  useEffect(() => {
    if (!viewingReceipt) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeReceipt(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [viewingReceipt]);

  const closeReceipt = () => {
    receiptUrls.current?.close();
    setViewingReceipt(null);
    requestAnimationFrame(() => receiptTrigger.current?.focus());
  };

  const viewReceipt = async (receiptUrl: string, trigger: HTMLButtonElement) => {
    receiptTrigger.current = trigger;
    setError('');
    try {
      const objectUrl = await receiptUrls.current?.load((signal) => api.readReceipt(receiptUrl, signal));
      if (objectUrl) setViewingReceipt(objectUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to load receipt');
    }
  };

  const beginCorrection = (expense: Expense) => {
    setEditing(expense.id);
    setDescription(expense.description);
    setAmount(expense.amount.toFixed(2));
    setConfirmVoid(undefined);
  };

  const correct = async (expense: Expense) => {
    setError('');
    setBusyExpense(expense.id);
    try {
      await api.correctExpense(tripId, expense.id, expense.version ?? 1, {
        description, amount, splitType: 'equal',
        splits: buildEqualSplits(amount, participants.map((participant) => participant.id)),
      });
      await onChanged();
      setEditing(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to correct expense');
    } finally {
      setBusyExpense(undefined);
    }
  };

  const voidExpense = async (expense: Expense) => {
    setError('');
    setBusyExpense(expense.id);
    try {
      await api.voidExpense(tripId, expense.id, expense.version ?? 1);
      await onChanged();
      setConfirmVoid(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to void expense');
    } finally {
      setBusyExpense(undefined);
    }
  };

  if (expenses.length === 0) return <p className="empty-state text-muted">No expenses yet. Add the first one while it’s fresh.</p>;

  return (
    <div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {expenses.map((expense) => {
        const canChange = expense.paid_by === currentUserId || ownerId === currentUserId;
        return (
          <article key={expense.id} className="expense-row">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="min-w-0"><h3 className="text-lg">{expense.description}</h3><p className="mt-1 text-sm text-muted">Paid by {expense.paid_by_name}</p></div>
              <div className="text-right"><p className="money text-xl">₹{expense.amount.toFixed(2)}</p><p className="text-xs capitalize text-muted">{expense.split_type} split · v{expense.version ?? 1}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {expense.receipt_url && <button type="button" onClick={(event) => void viewReceipt(expense.receipt_url!, event.currentTarget)} className="button button-quiet">View receipt</button>}
              {canChange && <button type="button" onClick={() => beginCorrection(expense)} className="button button-quiet">Correct</button>}
              {canChange && <button type="button" onClick={() => { setConfirmVoid(expense.id); setEditing(undefined); }} className="button button-quiet text-red-700">Void</button>}
            </div>
            {editing === expense.id && (
              <div className="editor-panel">
                <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} className="block w-full border rounded px-3 py-2" /></label>
                <label>Amount (₹)<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="block w-full border rounded px-3 py-2" /></label>
                <div className="flex gap-2"><button type="button" disabled={busyExpense === expense.id} onClick={() => void correct(expense)} className="button button-primary">{busyExpense === expense.id ? <LoadingLabel label="Saving…" /> : 'Save correction'}</button><button type="button" disabled={busyExpense === expense.id} onClick={() => setEditing(undefined)} className="button button-quiet">Cancel</button></div>
              </div>
            )}
            {confirmVoid === expense.id && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <p>Void this expense? The historical row will remain in the audit trail.</p>
                <div className="mt-2 flex gap-2"><button type="button" disabled={busyExpense === expense.id} onClick={() => void voidExpense(expense)} className="button button-danger">{busyExpense === expense.id ? <LoadingLabel label="Voiding…" /> : 'Confirm void'}</button><button type="button" disabled={busyExpense === expense.id} onClick={() => setConfirmVoid(undefined)} className="button button-quiet">Keep expense</button></div>
              </div>
            )}
          </article>
        );
      })}
      {nextCursor && onLoadOlder && (
        <button type="button" disabled={loadingOlder} onClick={() => {
          setLoadingOlder(true);
          setError('');
          void onLoadOlder().catch((failure) => {
            setError(failure instanceof Error ? failure.message : 'Older expenses could not be loaded.');
          }).finally(() => setLoadingOlder(false));
        }} className="button button-secondary w-full">
          {loadingOlder ? <LoadingLabel label="Loading…" /> : 'Load older expenses'}
        </button>
      )}
      {viewingReceipt && (
        <div role="dialog" aria-modal="true" aria-label="Receipt preview" className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReceipt(); }}>
          <div className="relative max-w-4xl max-h-[90vh]">
            <button ref={closeButton} type="button" onClick={closeReceipt} aria-label="Close receipt preview" className="absolute right-0 -top-12 min-h-11 min-w-11 text-white text-3xl">×</button>
            <img src={viewingReceipt} alt="Uploaded receipt" className="max-w-full max-h-[85vh] object-contain rounded-lg bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
