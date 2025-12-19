import { useState } from 'react';
import { api } from '../api';
import { Participant } from '../types';
import Calculator from './Calculator';
import calculatorIcon from '../assets/images/calculator.png';

interface AddExpenseProps {
  tripId: string;
  currentUserId: string;
  participants: Participant[];
  onExpenseAdded: () => void;
}

interface CustomSplitEntry {
  participantId: string;
  amount: string;
}

export default function AddExpense({ tripId, currentUserId, participants, onExpenseAdded }: AddExpenseProps) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [splitType, setSplitType] = useState<'equal' | 'custom' | 'percentage'>('equal');
  const [customSplits, setCustomSplits] = useState<CustomSplitEntry[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculatorTarget, setCalculatorTarget] = useState<string | null>(null);

  // Initialize with all participants selected
  useState(() => {
    setSelectedParticipants(participants.map(p => p.id));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!amount || !description) {
        throw new Error('Please fill in all required fields');
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid amount');
      }

      // Validate custom splits
      if (splitType === 'custom') {
        if (customSplits.length === 0 || customSplits.some(s => !s.amount)) {
          throw new Error('Please fill in all custom split amounts');
        }
        const totalSplit = customSplits.reduce((sum, split) => sum + parseFloat(split.amount || '0'), 0);
        if (Math.abs(totalSplit - amountNum) > 0.01) {
          throw new Error(`Custom splits (₹${totalSplit.toFixed(2)}) must equal total amount (₹${amountNum.toFixed(2)})`);
        }
      } else if (splitType === 'percentage') {
        if (customSplits.length === 0 || customSplits.some(s => !s.amount)) {
          throw new Error('Please fill in all percentage splits');
        }
        const totalPercentage = customSplits.reduce((sum, split) => sum + parseFloat(split.amount || '0'), 0);
        if (Math.abs(totalPercentage - 100) > 0.01) {
          throw new Error(`Percentages must add up to 100% (current: ${totalPercentage.toFixed(2)}%)`);
        }
      }

      // Validate at least one participant is selected
      if (selectedParticipants.length === 0) {
        throw new Error('Please select at least one participant');
      }

      // Filter splits to only include selected participants
      const splits = splitType !== 'equal' 
        ? customSplits
            .filter(s => selectedParticipants.includes(s.participantId))
            .map(s => ({
              participantId: s.participantId,
              amount: parseFloat(s.amount)
            }))
        : selectedParticipants.map(participantId => ({
            participantId,
            amount: amountNum / selectedParticipants.length
          }));

      await api.addExpense(tripId, {
        paidBy: currentUserId,
        description,
        amount: amountNum,
        splitType,
        splits
      });

      // Reset form
      setAmount('');
      setDescription('');
      setSplitType('equal');
      setCustomSplits([]);
      setSelectedParticipants(participants.map(p => p.id));
      onExpenseAdded();
    } catch (err: any) {
      setError(err.message || 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  const initializeCustomSplits = () => {
    const activeParticipants = participants.filter(p => selectedParticipants.includes(p.id));
    if (activeParticipants.length === 0) return;

    if (splitType === 'custom' && parseFloat(amount) > 0) {
      const splitAmount = (parseFloat(amount) / activeParticipants.length).toFixed(2);
      setCustomSplits(activeParticipants.map(p => ({
        participantId: p.id,
        amount: splitAmount
      })));
    } else if (splitType === 'percentage') {
      const splitPercentage = (100 / activeParticipants.length).toFixed(2);
      setCustomSplits(activeParticipants.map(p => ({
        participantId: p.id,
        amount: splitPercentage
      })));
    }
  };

  const toggleParticipant = (participantId: string) => {
    setSelectedParticipants(prev => {
      if (prev.includes(participantId)) {
        return prev.filter(id => id !== participantId);
      }
      return [...prev, participantId];
    });
  };

  const toggleAllParticipants = () => {
    if (selectedParticipants.length === participants.length) {
      setSelectedParticipants([]);
    } else {
      setSelectedParticipants(participants.map(p => p.id));
    }
  };

  const updateCustomSplit = (participantId: string, value: string) => {
    setCustomSplits(prev => {
      const existing = prev.find(s => s.participantId === participantId);
      if (existing) {
        return prev.map(s => s.participantId === participantId ? { ...s, amount: value } : s);
      }
      return [...prev, { participantId, amount: value }];
    });
  };

  const handleCalculatorValue = (value: string) => {
    if (calculatorTarget === 'amount') {
      setAmount(value);
    } else if (calculatorTarget) {
      updateCustomSplit(calculatorTarget, value);
    }
    setShowCalculator(false);
    setCalculatorTarget(null);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Add Expense</h2>
      
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amount (₹)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => {
                  setCalculatorTarget('amount');
                  setShowCalculator(!showCalculator);
                }}
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 font-semibold transition"
              >
                <img src={calculatorIcon} alt="Calculator" className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Split Type
            </label>
            <select
              value={splitType}
              onChange={(e) => {
                const newType = e.target.value as 'equal' | 'custom' | 'percentage';
                setSplitType(newType);
                if (newType !== 'equal') {
                  initializeCustomSplits();
                } else {
                  setCustomSplits([]);
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="equal">Equal Split</option>
              <option value="custom">Custom Amount</option>
              <option value="percentage">Percentage Split</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Dinner at restaurant"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Participant Selector */}
        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-3">
            <label className="block text-sm font-medium text-gray-700">
              Split Between
            </label>
            <button
              type="button"
              onClick={toggleAllParticipants}
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              {selectedParticipants.length === participants.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {participants.map((participant) => (
              <button
                key={participant.id}
                type="button"
                onClick={() => toggleParticipant(participant.id)}
                className={`px-3 py-2 rounded-lg border-2 transition ${
                  selectedParticipants.includes(participant.id)
                    ? 'bg-indigo-100 border-indigo-600 text-indigo-700'
                    : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {participant.name}
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-600 mt-2">
            {selectedParticipants.length} participant{selectedParticipants.length !== 1 ? 's' : ''} selected
            {selectedParticipants.length > 0 && amount && ` • ₹${(parseFloat(amount) / selectedParticipants.length).toFixed(2)} each`}
          </div>
        </div>

        {showCalculator && (
          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium text-gray-700">Calculator</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCalculator(false);
                  setCalculatorTarget(null);
                }}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Close
              </button>
            </div>
            <Calculator onUseValue={handleCalculatorValue} />
          </div>
        )}

        {splitType !== 'equal' && (
          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <label className="block text-sm font-medium text-gray-700">
                {splitType === 'custom' ? 'Custom Amounts (₹)' : 'Percentage Split (%)'}
              </label>
              <button
                type="button"
                onClick={initializeCustomSplits}
                className="text-sm text-indigo-600 hover:text-indigo-700"
              >
                Auto-fill equal
              </button>
            </div>
            <div className="space-y-2">
              {participants
                .filter(p => selectedParticipants.includes(p.id))
                .map((participant) => {
                  const split = customSplits.find(s => s.participantId === participant.id);
                  return (
                    <div key={participant.id} className="flex items-center gap-2">
                      <label className="flex-1 text-sm text-gray-700">
                        {participant.name}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={split?.amount || ''}
                        onChange={(e) => updateCustomSplit(participant.id, e.target.value)}
                        placeholder={splitType === 'percentage' ? '0.00' : '0.00'}
                        className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCalculatorTarget(participant.id);
                          setShowCalculator(true);
                        }}
                        className="px-2 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 transition"
                      >
                        <img src={calculatorIcon} alt="Calculator" className="w-5 h-5" />
                      </button>
                    </div>
                  );
                })}
              {splitType === 'custom' && (
                <div className="text-sm text-gray-600 mt-2">
                  Total: ₹{customSplits.reduce((sum, s) => sum + parseFloat(s.amount || '0'), 0).toFixed(2)}
                  {amount && ` / ₹${parseFloat(amount).toFixed(2)}`}
                </div>
              )}
              {splitType === 'percentage' && (
                <div className="text-sm text-gray-600 mt-2">
                  Total: {customSplits.reduce((sum, s) => sum + parseFloat(s.amount || '0'), 0).toFixed(2)}%
                </div>
              )}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {loading ? 'Adding...' : 'Add Expense'}
        </button>
      </form>
    </div>
  );
}
