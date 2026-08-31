import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { TripSnapshot } from '../types';

const FOCUS_REFRESH_AGE_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

export function useTripSnapshot(tripId: string) {
  const [snapshot, setSnapshot] = useState<TripSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const inFlight = useRef<Promise<void>>();
  const controller = useRef<AbortController>();
  const lastSuccess = useRef(0);
  const nextRetry = useRef(0);
  const failures = useRef(0);

  const load = useCallback((force = false) => {
    if (inFlight.current) return inFlight.current;
    if (!force && Date.now() < nextRetry.current) return Promise.resolve();
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const promise = api.getTrip(tripId, requestController.signal)
      .then((next) => {
        setSnapshot(next);
        setError(undefined);
        failures.current = 0;
        nextRetry.current = 0;
        lastSuccess.current = Date.now();
      })
      .catch((failure: unknown) => {
        if (requestController.signal.aborted) return;
        failures.current += 1;
        nextRetry.current = Date.now() + Math.min(1_000 * 2 ** failures.current, MAX_BACKOFF_MS);
        setError(failure instanceof Error ? failure.message : 'Failed to load trip');
      })
      .finally(() => {
        setLoading(false);
        if (inFlight.current === promise) inFlight.current = undefined;
      });
    inFlight.current = promise;
    return promise;
  }, [tripId]);

  useEffect(() => {
    setLoading(true);
    void load(true);
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible'
        && Date.now() - lastSuccess.current >= FOCUS_REFRESH_AGE_MS) {
        void load();
      }
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      controller.current?.abort();
      inFlight.current = undefined;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [load]);

  return { snapshot, loading, error, refresh: () => load(true) };
}
