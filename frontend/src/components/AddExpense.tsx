import { useState } from 'react';
import { api } from '../api';
import type { Participant } from '../types';
import {
  buildPercentageSplits,
  buildSplits,
  reconcileSplitEntries,
  type SplitEntry,
  type SplitMode,
} from '../utils/splitBuilder';
import { LoadingLabel } from './LoadingIndicator';

interface AddExpenseProps {
  tripId: string;
  participants: Participant[];
  onExpenseAdded: () => void | Promise<void>;
  receiptUploadsEnabled?: boolean;
}

export default function AddExpense({
  tripId, participants, onExpenseAdded, receiptUploadsEnabled = true,
}: AddExpenseProps) {
  const allIds = participants.map((participant) => participant.id);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [splitType, setSplitType] = useState<SplitMode>('equal');
  const [entries, setEntries] = useState<SplitEntry[]>([]);
  const [selected, setSelected] = useState<string[]>(() => allIds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectMembers = (ids: string[]) => {
    setSelected(ids);
    setEntries((current) => reconcileSplitEntries(current, ids));
  };

  const changeMode = (mode: SplitMode) => {
    setSplitType(mode);
    setEntries(mode === 'percentage' && selected.length > 0
      ? buildPercentageSplits(selected)
      : reconcileSplitEntries([], selected));
  };

  const updateEntry = (participantId: string, value: string) => {
    setEntries((current) => reconcileSplitEntries(current, selected).map((entry) => (
      entry.participantId === participantId ? { ...entry, amount: value } : entry
    )));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (!description.trim()) throw new Error('Description is required');
      const splits = buildSplits(amount, selected, splitType, entries);
      let receiptId: string | undefined;
      if (receiptFile) receiptId = (await api.uploadReceipt(tripId, receiptFile)).receipt_id;
      await api.addExpense(tripId, {
        description: description.trim(), amount, splitType, splits,
        ...(receiptId ? { receiptId } : {}),
      });
      setAmount('');
      setDescription('');
      setReceiptFile(null);
      setSplitType('equal');
      setEntries([]);
      selectMembers(allIds);
      await onExpenseAdded();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-labelledby="add-expense-title">
      <h2 id="add-expense-title" className="mb-1 text-2xl">Add expense</h2>
      <p className="mb-5 text-sm text-muted">Record it now; adjust or void it later.</p>
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="expense-amount" className="field-label mb-2 block">Amount (₹)</label>
            <input id="expense-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
          </div>
          <div>
            <label htmlFor="split-type" className="field-label mb-2 block">Split type</label>
            <select id="split-type" value={splitType} onChange={(event) => changeMode(event.target.value as SplitMode)}>
              <option value="equal">Equal split</option>
              <option value="custom">Custom amounts</option>
              <option value="percentage">Percentages</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="expense-description" className="field-label mb-2 block">Description</label>
          <input id="expense-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} placeholder="Dinner, taxi, tickets…" required />
        </div>
        <fieldset>
          <legend className="field-label mb-2">Split between</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {participants.map((participant) => (
              <label key={participant.id} className="split-member">
                <input
                  type="checkbox"
                  checked={selected.includes(participant.id)}
                  onChange={() => selectMembers(selected.includes(participant.id)
                    ? selected.filter((id) => id !== participant.id)
                    : [...selected, participant.id])}
                />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{participant.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {splitType !== 'equal' && (
          <fieldset className="space-y-2">
            <legend className="field-label">{splitType === 'custom' ? 'Custom amounts (₹)' : 'Percentages (%)'}</legend>
            {selected.map((participantId) => {
              const participant = participants.find((item) => item.id === participantId);
              const entry = entries.find((item) => item.participantId === participantId);
              return (
                <label key={participantId} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                  <span>{participant?.name}</span>
                  <input aria-label={`${participant?.name} ${splitType === 'custom' ? 'amount' : 'percentage'}`} inputMode="decimal" value={entry?.amount ?? ''} onChange={(event) => updateEntry(participantId, event.target.value)} className="px-3 py-2 border rounded-lg" />
                </label>
              );
            })}
          </fieldset>
        )}
        {receiptUploadsEnabled ? (
          <div>
            <label htmlFor="receipt-file" className="field-label mb-2 block">Receipt image (optional)</label>
            <input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} className="w-full px-4 py-3 border rounded-lg" />
          </div>
        ) : (
          <p role="status" className="subtle-note">Receipt uploads are unavailable here. Expense splitting still works normally.</p>
        )}
        <button type="submit" disabled={loading || selected.length === 0} className="button button-primary w-full">
          {loading ? <LoadingLabel label="Adding…" /> : 'Add expense'}
        </button>
      </form>
    </section>
  );
}
