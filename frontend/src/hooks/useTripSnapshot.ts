import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
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
  const olderInFlight = useRef<Promise<void>>();
  const olderController = useRef<AbortController>();
  const generation = useRef(0);

  const load = useCallback((force = false) => {
    if (inFlight.current) return inFlight.current;
    if (!force && Date.now() < nextRetry.current) return Promise.resolve();
    controller.current?.abort();
    const requestGeneration = ++generation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    const promise = api.getTrip(tripId, requestController.signal)
      .then((next) => {
        if (requestController.signal.aborted || requestGeneration !== generation.current) return;
        setSnapshot(next);
        setError(undefined);
        failures.current = 0;
        nextRetry.current = 0;
        lastSuccess.current = Date.now();
      })
      .catch((failure: unknown) => {
        if (requestController.signal.aborted || requestGeneration !== generation.current) return;
        if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
          olderController.current?.abort();
          setSnapshot(null);
        }
        failures.current += 1;
        nextRetry.current = Date.now() + Math.min(1_000 * 2 ** failures.current, MAX_BACKOFF_MS);
        setError(failure instanceof Error ? failure.message : 'Failed to load trip');
      })
      .finally(() => {
        if (requestGeneration === generation.current) setLoading(false);
        if (inFlight.current === promise) inFlight.current = undefined;
      });
    inFlight.current = promise;
    return promise;
  }, [tripId]);

  useEffect(() => {
    setSnapshot(null);
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
      generation.current += 1;
      controller.current?.abort();
      olderController.current?.abort();
      inFlight.current = undefined;
      olderInFlight.current = undefined;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [load]);

  const loadOlderExpenses = useCallback(() => {
    const cursor = snapshot?.expense_next_cursor;
    if (!cursor) return Promise.resolve();
    if (olderInFlight.current) return olderInFlight.current;
    const requestController = new AbortController();
    olderController.current = requestController;
    const requestGeneration = generation.current;
    const promise = api.getExpenses(tripId, cursor, requestController.signal).then((page) => {
      if (requestController.signal.aborted || requestGeneration !== generation.current) return;
      setSnapshot((current) => {
        if (!current || current.expense_next_cursor !== cursor) return current;
        const known = new Set(current.expenses.map((expense) => expense.id));
        return {
          ...current,
          expenses: [...current.expenses, ...page.expenses.filter((expense) => !known.has(expense.id))],
          expense_next_cursor: page.next_cursor,
        };
      });
    }).catch((failure: unknown) => {
      if (requestController.signal.aborted || requestGeneration !== generation.current) return;
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        controller.current?.abort();
        setSnapshot(null);
        setError(failure.message);
      }
      throw failure;
    }).finally(() => {
      if (olderInFlight.current === promise) olderInFlight.current = undefined;
    });
    olderInFlight.current = promise;
    return promise;
  }, [snapshot?.expense_next_cursor, tripId]);

  return { snapshot, loading, error, refresh: () => load(true), loadOlderExpenses };
}
