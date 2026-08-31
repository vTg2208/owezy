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
      <h2 id="add-expense-title" className="text-2xl font-bold text-gray-800 mb-4">Add expense</h2>
      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="expense-amount" className="block text-sm font-medium text-gray-700 mb-2">Amount (₹)</label>
            <input id="expense-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required className="w-full px-4 py-3 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label htmlFor="split-type" className="block text-sm font-medium text-gray-700 mb-2">Split type</label>
            <select id="split-type" value={splitType} onChange={(event) => changeMode(event.target.value as SplitMode)} className="w-full px-4 py-3 border border-gray-300 rounded-lg">
              <option value="equal">Equal split</option>
              <option value="custom">Custom amounts</option>
              <option value="percentage">Percentages</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="expense-description" className="block text-sm font-medium text-gray-700 mb-2">Description</label>
          <input id="expense-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} required className="w-full px-4 py-3 border border-gray-300 rounded-lg" />
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-2">Split between</legend>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {participants.map((participant) => (
              <label key={participant.id} className="flex items-center gap-2 min-h-11 rounded-lg border px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.includes(participant.id)}
                  onChange={() => selectMembers(selected.includes(participant.id)
                    ? selected.filter((id) => id !== participant.id)
                    : [...selected, participant.id])}
                />
                {participant.name}
              </label>
            ))}
          </div>
        </fieldset>
        {splitType !== 'equal' && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700">{splitType === 'custom' ? 'Custom amounts (₹)' : 'Percentages (%)'}</legend>
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
            <label htmlFor="receipt-file" className="block text-sm font-medium text-gray-700 mb-2">Receipt image (optional)</label>
            <input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} className="w-full px-4 py-3 border rounded-lg" />
          </div>
        ) : (
          <p role="status" className="notice text-sm text-muted">Receipt uploads are unavailable for this deployment. You can still add and split expenses normally.</p>
        )}
        <button type="submit" disabled={loading || selected.length === 0} className="w-full bg-indigo-600 text-white min-h-11 px-5 rounded-lg font-semibold disabled:opacity-50">
          {loading ? 'Adding…' : 'Add expense'}
        </button>
      </form>
    </section>
  );
}
