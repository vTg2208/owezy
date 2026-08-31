import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AddExpense from './AddExpense';

describe('AddExpense receipt availability', () => {
  it('does not offer a file upload when server-side receipt storage is unavailable', () => {
    render(<AddExpense
      tripId="trip-1"
      participants={[{
        id: 'member-1', trip_id: 'trip-1', name: 'One', is_admin: 1, created_at: '2026-08-31',
      }]}
      receiptUploadsEnabled={false}
      onExpenseAdded={() => undefined}
    />);

    expect(screen.queryByLabelText('Receipt image (optional)')).not.toBeInTheDocument();
    expect(screen.getByText(/Receipt uploads are unavailable/i)).toBeVisible();
  });
});
