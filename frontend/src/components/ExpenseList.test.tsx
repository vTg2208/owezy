import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ExpenseList from './ExpenseList';

vi.mock('../api', () => ({ api: { readReceipt: vi.fn(async () => new Blob(['image'])) } }));

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
});
