import { StrictMode, type PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { TripSnapshot } from '../types';
import { useTripSnapshot } from './useTripSnapshot';

vi.mock('../api', () => ({ api: { getTrip: vi.fn() } }));

const snapshot: TripSnapshot = {
  trip: { id: 'trip-1', name: 'Goa', room_code: 'GOA123', admin_id: 'member-1', is_locked: 0, created_at: '2026-08-31', currency: 'INR' },
  current_member_id: 'member-1', participants: [], expenses: [], balances: [], settlements: [],
};

describe('useTripSnapshot', () => {
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
});
