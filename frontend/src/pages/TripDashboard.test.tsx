import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import TripDashboard from './TripDashboard';

vi.mock('../hooks/useTripSnapshot', () => ({
  useTripSnapshot: () => ({
    loading: false,
    error: undefined,
    refresh: vi.fn(async () => undefined),
    snapshot: {
      trip: { id: 'trip-1', name: 'goa', room_code: 'GOA123', admin_id: 'owner-1', is_locked: 0, created_at: '2026-08-31', currency: 'INR' },
      current_member_id: 'member-1',
      participants: [{ id: 'member-1', trip_id: 'trip-1', name: 'One', is_admin: 0, created_at: '2026-08-31' }],
      expenses: [], balances: [], settlements: [],
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
    render(<MemoryRouter><TripDashboard tripId="trip-1" /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Goa' })).toBeVisible();
    expect(screen.getByLabelText('Amount (₹)')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Expenses' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('One')).toHaveLength(2);
  });
});
