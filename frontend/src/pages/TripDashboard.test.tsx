import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import TripDashboard from './TripDashboard';

vi.mock('../hooks/useTripSnapshot', () => ({
  useTripSnapshot: () => ({
    loading: false,
    error: undefined,
    refresh: vi.fn(async () => undefined),
    snapshot: {
      trip: { id: 'trip-1', name: 'goa', room_code: 'GOA123', admin_id: 'member-1', is_locked: 1, created_at: '2026-08-31', currency: 'INR' },
      current_member_id: 'member-1',
      participants: [
        { id: 'member-1', trip_id: 'trip-1', name: 'One', is_admin: 1, created_at: '2026-08-31' },
        { id: 'member-2', trip_id: 'trip-1', name: 'Two', is_admin: 0, created_at: '2026-08-31' },
      ],
      expenses: [], balances: [], settlements: [],
      capabilities: { receipt_uploads: false },
    },
  }),
}));

vi.mock('../api', () => ({
  api: {
    listPayments: vi.fn(async () => []),
    removeParticipant: vi.fn(), lockRoom: vi.fn(), unlockRoom: vi.fn(),
  },
}));

describe('TripDashboard direct navigation', () => {
  it('uses server-derived membership and exposes accessible trip tabs', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TripDashboard tripId="trip-1" /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Goa' })).toBeVisible();
    expect(screen.getByLabelText('Amount (₹)')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Expenses' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('One')).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: 'Expenses' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Balances' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Balances' })).toHaveAttribute('aria-selected', 'true');
  });

  it('describes room closure accurately and keeps existing-member actions available', async () => {
    const user = userEvent.setup();
    vi.mocked(api.unlockRoom).mockImplementation(() => new Promise(() => undefined));
    render(<MemoryRouter><TripDashboard tripId="trip-1" /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'Open room' })).toBeVisible();
    expect(screen.getByText(/Room closed to new travellers/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Two' })).toBeVisible();
    expect(screen.queryByLabelText('Receipt image (optional)')).not.toBeInTheDocument();
    expect(screen.getByText(/Receipt uploads are unavailable/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open room' }));
    expect(screen.getByRole('button', { name: 'Opening room…' })).toBeDisabled();
  });
});
