import { useState } from 'react';
import { api } from '../api';
import type { Payment, Settlement } from '../types';

interface SettlementPlanProps {
  tripId: string;
  settlement: Settlement[];
  payments: Payment[];
  currentUserId: string;
  onChanged: () => void | Promise<void>;
}

export default function SettlementPlan({
  tripId, settlement, payments, currentUserId, onChanged,
}: SettlementPlanProps) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const relevant = settlement.filter((item) => item.from === currentUserId || item.to === currentUserId);
  const myPayments = payments.filter((payment) => (
    payment.payer_membership_id === currentUserId || payment.payee_membership_id === currentUserId
  ));

  const mutate = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try { await work(); await onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Payment action failed'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <section aria-labelledby="suggested-settlements">
        <h3 id="suggested-settlements" className="text-lg font-semibold mb-3">Suggested settlements</h3>
        {relevant.length === 0 ? <p className="text-green-700">You’re all settled.</p> : (
          <div className="space-y-3">
            {relevant.map((item) => (
              <article key={`${item.from}-${item.to}`} className="flex flex-wrap items-center justify-between gap-3 border rounded-lg p-4">
                <p><strong>{item.from === currentUserId ? 'You' : item.fromName}</strong> pay <strong>{item.to === currentUserId ? 'you' : item.toName}</strong></p>
                <p className="text-xl font-bold">₹{item.amount.toFixed(2)}</p>
                {item.from === currentUserId && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void mutate(`create-${item.to}`, () => api.createPayment(
                      tripId, item.to, item.amount.toFixed(2), 'Settlement',
                    ))}
                    className="px-4 py-2 bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                  >Record payment</button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="payment-history">
        <h3 id="payment-history" className="text-lg font-semibold mb-3">Payment requests</h3>
        {myPayments.length === 0 ? <p className="text-gray-600">No payments recorded yet.</p> : (
          <div className="space-y-3">
            {myPayments.map((payment) => (
              <article key={payment.id} className="border rounded-lg p-4 flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-semibold">₹{payment.amount ?? '—'} {payment.currency ?? 'INR'}</p>
                  <p className="text-sm capitalize">{payment.status}</p>
                </div>
                {payment.status === 'pending' && (
                  <div className="flex gap-2">
                    {payment.payee_membership_id === currentUserId && (<>
                      <button type="button" onClick={() => void mutate(payment.id, () => api.transitionPayment(tripId, payment.id, 'confirm'))} className="px-3 py-2 bg-green-700 text-white rounded-lg">Confirm</button>
                      <button type="button" onClick={() => void mutate(payment.id, () => api.transitionPayment(tripId, payment.id, 'reject'))} className="px-3 py-2 border rounded-lg">Reject</button>
                    </>)}
                    {payment.payer_membership_id === currentUserId && (
                      <button type="button" onClick={() => void mutate(payment.id, () => api.transitionPayment(tripId, payment.id, 'cancel'))} className="px-3 py-2 border rounded-lg">Cancel</button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
