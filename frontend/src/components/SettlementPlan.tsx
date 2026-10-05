import { useState } from 'react';
import { api } from '../api';
import type { Payment, Settlement } from '../types';
import { LoadingLabel } from './LoadingIndicator';
import { moneyDecimal } from '../utils/money';

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
    <div className="mx-auto max-w-3xl space-y-10">
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <section aria-labelledby="suggested-settlements">
        <h2 id="suggested-settlements" className="mb-3 text-2xl">Suggested settlements</h2>
        {relevant.length === 0 ? <p className="notice notice-success">You’re all settled.</p> : (
          <div className="ledger-list">
            {relevant.map((item) => (
              <article key={`${item.from}-${item.to}`} className="ledger-row">
                <p><strong>{item.from === currentUserId ? 'You' : item.fromName}</strong> pay <strong>{item.to === currentUserId ? 'you' : item.toName}</strong></p>
                <p className="text-xl font-bold">₹{moneyDecimal(item.amount)}</p>
                {item.from === currentUserId && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void mutate(`create-${item.to}`, () => api.createPayment(
                      tripId, item.to, moneyDecimal(item.amount), 'Settlement',
                    ))}
                    className="button button-primary"
                  >{busy === `create-${item.to}` ? <LoadingLabel label="Recording…" /> : 'Record payment'}</button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="payment-history">
        <h2 id="payment-history" className="mb-3 text-2xl">Payment requests</h2>
        {myPayments.length === 0 ? <p className="text-muted">No payments recorded yet.</p> : (
          <div className="ledger-list">
            {myPayments.map((payment) => (
              <article key={payment.id} className="ledger-row">
                <div>
                  <p className="font-semibold">₹{payment.amount ?? '—'} {payment.currency ?? 'INR'}</p>
                  <p className="text-sm capitalize">{payment.status}</p>
                </div>
                {payment.status === 'pending' && (
                  <div className="flex gap-2">
                    {payment.payee_membership_id === currentUserId && (<>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void mutate(payment.id, () => api.transitionPayment(tripId, payment.id, 'confirm'))} className="button button-primary">{busy === payment.id ? <LoadingLabel label="Updating…" /> : 'Confirm'}</button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void mutate(payment.id, () => api.transitionPayment(tripId, payment.id, 'reject'))} className="button button-secondary">Reject</button>
                    </>)}
                    {payment.payer_membership_id === currentUserId && (
                      <button type="button" disabled={Boolean(busy)} onClick={() => void mutate(payment.id, () => api.transitionPayment(tripId, payment.id, 'cancel'))} className="button button-secondary">{busy === payment.id ? <LoadingLabel label="Updating…" /> : 'Cancel'}</button>
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
