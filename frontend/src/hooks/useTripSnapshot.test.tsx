import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';
import type { TripSnapshot } from '../types';
import { useTripSnapshot } from './useTripSnapshot';

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error { constructor(public status: number) { super('Forbidden'); } },
  api: { getTrip: vi.fn(), getExpenses: vi.fn() },
}));

const snapshot: TripSnapshot = {
  trip: { id: 'trip-1', name: 'Goa', room_code: 'GOA123', admin_id: 'member-1', is_locked: 0, created_at: '2026-08-31', currency: 'INR' },
  current_member_id: 'member-1', participants: [], expenses: [], balances: [], settlements: [],
};

describe('useTripSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());
  it('recovers from the StrictMode setup abort instead of reporting a missing trip', async () => {
    vi.mocked(api.getTrip).mockImplementation((_tripId, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(snapshot); }, 0);
    }));
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useTripSnapshot('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.snapshot?.trip.id).toBe('trip-1'));
    expect(result.current.error).toBeUndefined();
    expect(api.getTrip).toHaveBeenCalledTimes(2);
  });

  it('appends a cursor page once without re-downloading the first page', async () => {
    vi.mocked(api.getTrip).mockResolvedValue({ ...snapshot, expense_next_cursor: 'cursor-1' });
    vi.mocked(api.getExpenses).mockResolvedValue({
      expenses: [{
        id: 'expense-2', trip_id: 'trip-1', paid_by: 'member-1', paid_by_name: 'One',
        amount: 5.05, description: 'Cab', split_type: 'equal', created_at: '2026-08-30',
      }],
    });
    const { result } = renderHook(() => useTripSnapshot('trip-1'));
    await waitFor(() => expect(result.current.snapshot?.expense_next_cursor).toBe('cursor-1'));

    await act(() => result.current.loadOlderExpenses());

    expect(result.current.snapshot?.expenses.map((expense) => expense.id)).toEqual(['expense-2']);
    expect(result.current.snapshot?.expense_next_cursor).toBeUndefined();
    expect(api.getExpenses).toHaveBeenCalledWith('trip-1', 'cursor-1', expect.any(AbortSignal));
    expect(api.getTrip).toHaveBeenCalledOnce();
  });

  it('removes a protected snapshot after authorization is denied', async () => {
    vi.mocked(api.getTrip).mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    const { result } = renderHook(() => useTripSnapshot('trip-1'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(() => result.current.refresh());

    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBe('Forbidden');
  });
});
