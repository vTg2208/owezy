import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import SettlementPlan from './SettlementPlan';

vi.mock('../api', () => ({
  api: {
    createPayment: vi.fn(async () => ({ id: 'new-payment', status: 'pending' })),
    transitionPayment: vi.fn(async () => ({ id: 'payment-1', status: 'confirmed' })),
  },
}));

describe('SettlementPlan payment workflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a suggested payment using exact decimal text', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<SettlementPlan
      tripId="trip-1"
      currentUserId="payer"
      settlement={[{ from: 'payer', to: 'payee', amount: 12.3, fromName: 'Payer', toName: 'Payee' }]}
      payments={[]}
      onChanged={changed}
    />);

    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(api.createPayment).toHaveBeenCalledWith('trip-1', 'payee', '12.30', 'Settlement');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('allows only the recipient-facing confirmation action shown by the component', async () => {
    const user = userEvent.setup();
    render(<SettlementPlan
      tripId="trip-1"
      currentUserId="payee"
      settlement={[]}
      payments={[{
        id: 'payment-1', status: 'pending', payer_membership_id: 'payer',
        payee_membership_id: 'payee', amount: '12.30', currency: 'INR',
      }]}
      onChanged={vi.fn()}
    />);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(api.transitionPayment).toHaveBeenCalledWith('trip-1', 'payment-1', 'confirm');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('announces payment progress while fresh balances are loading', async () => {
    const user = userEvent.setup();
    let finishRefresh!: () => void;
    const refreshed = new Promise<void>((resolve) => { finishRefresh = resolve; });
    render(<SettlementPlan
      tripId="trip-1"
      currentUserId="payer"
      settlement={[{ from: 'payer', to: 'payee', amount: 12.3, fromName: 'Payer', toName: 'Payee' }]}
      payments={[]}
      onChanged={() => refreshed}
    />);

    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    finishRefresh();
  });
});
