'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DashboardAnalyticsSnapshot } from '@/lib/dashboard/dashboard-analytics-cache';

type AnalyticsState = {
  data: DashboardAnalyticsSnapshot | null;
  state: 'loading' | 'fresh' | 'updating' | 'unavailable';
};

const DashboardAnalyticsContext = createContext<AnalyticsState | null>(null);

export function DashboardAnalyticsProvider({
  query,
  children,
}: {
  query: Record<string, string | undefined>;
  children: React.ReactNode;
}) {
  const [analytics, setAnalytics] = useState<AnalyticsState>({ data: null, state: 'loading' });
  const requestRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const lastSuccessAtRef = useRef(0);
  const stableQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [query]);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setAnalytics(previous => ({
      data: previous.data,
      state: previous.data ? 'updating' : 'loading',
    }));
    try {
      const response = await fetch(`/api/dashboard/analytics?${stableQuery}`, {
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        const error = new Error(`analytics unavailable (${response.status})`) as Error & {
          retryAfterMs?: number;
        };
        if (response.status === 503) {
          const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? 5);
          error.retryAfterMs = Math.min(60_000, Math.max(1_000, retryAfterSeconds * 1_000));
        }
        throw error;
      }
      const payload = (await response.json()) as { data: DashboardAnalyticsSnapshot };
      lastSuccessAtRef.current = Date.now();
      setAnalytics({
        data: payload.data,
        state: payload.data.freshness === 'fresh' ? 'fresh' : 'updating',
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnalytics(previous => ({
        data: previous.data,
        state: previous.data ? 'updating' : 'unavailable',
      }));
      const retryAfterMs =
        error instanceof Error && 'retryAfterMs' in error
          ? Number((error as Error & { retryAfterMs?: number }).retryAfterMs)
          : 0;
      if (retryAfterMs > 0 && retryTimerRef.current === null) {
        const jitteredDelay = retryAfterMs + Math.floor(Math.random() * 1_000);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          if (document.visibilityState === 'visible') void load();
        }, jitteredDelay);
      }
    }
  }, [stableQuery]);

  useEffect(() => {
    void load();
    let reconciliationTimer: number | null = null;
    const scheduleReconciliation = () => {
      const delay = 5 * 60_000 + Math.floor(Math.random() * 2 * 60_000);
      reconciliationTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        scheduleReconciliation();
      }, delay);
    };
    scheduleReconciliation();
    const resume = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastSuccessAtRef.current >= 5 * 60_000
      ) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      requestRef.current?.abort();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      if (reconciliationTimer !== null) window.clearTimeout(reconciliationTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [load]);

  return (
    <DashboardAnalyticsContext.Provider value={analytics}>
      {children}
    </DashboardAnalyticsContext.Provider>
  );
}

export function useDashboardAnalytics() {
  const value = useContext(DashboardAnalyticsContext);
  if (!value)
    throw new Error('useDashboardAnalytics must be used within DashboardAnalyticsProvider');
  return value;
}
