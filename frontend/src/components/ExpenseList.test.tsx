import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ExpenseList from './ExpenseList';

vi.mock('../api', () => ({ api: {
  readReceipt: vi.fn(async () => new Blob(['image'])),
  correctExpense: vi.fn(async () => ({ kind: 'updated' })),
  voidExpense: vi.fn(async () => ({ kind: 'updated' })),
} }));

describe('ExpenseList receipt dialog', () => {
  it('closes on Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:receipt');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    render(<ExpenseList
      tripId="trip-1"
      currentUserId="member-1"
      ownerId="owner-1"
      participants={[]}
      expenses={[{
        id: 'expense-1', trip_id: 'trip-1', paid_by: 'member-2', paid_by_name: 'Two',
        amount: 12, description: 'Cab', split_type: 'equal', receipt_url: '/api/receipt',
        created_at: '2026-08-31', version: 1,
      }]}
      onChanged={vi.fn()}
    />);
    const trigger = screen.getByRole('button', { name: 'View receipt' });
    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Receipt preview' })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(api.readReceipt).toHaveBeenCalled();
  });

  it('keeps correction progress visible until refreshed data arrives', async () => {
    const user = userEvent.setup();
    let finishRefresh!: () => void;
    const refreshed = new Promise<void>((resolve) => { finishRefresh = resolve; });
    render(<ExpenseList
      tripId="trip-1"
      currentUserId="member-1"
      ownerId="member-1"
      participants={[{
        id: 'member-1', trip_id: 'trip-1', name: 'One', is_admin: 1, created_at: '2026-08-31',
      }]}
      expenses={[{
        id: 'expense-1', trip_id: 'trip-1', paid_by: 'member-1', paid_by_name: 'One',
        amount: 12, description: 'Cab', split_type: 'equal', created_at: '2026-08-31', version: 1,
      }]}
      onChanged={() => refreshed}
    />);

    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    finishRefresh();
  });
});
