'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
      if (!response.ok) throw new Error(`analytics unavailable (${response.status})`);
      const payload = (await response.json()) as { data: DashboardAnalyticsSnapshot };
      setAnalytics({
        data: payload.data,
        state: payload.data.freshness === 'fresh' ? 'fresh' : 'updating',
      });
    } catch (_error) {
      if (controller.signal.aborted) return;
      setAnalytics(previous => ({ data: previous.data, state: previous.data ? 'updating' : 'unavailable' }));
    }
  }, [stableQuery]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    const resume = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      requestRef.current?.abort();
      window.clearInterval(interval);
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
  if (!value) throw new Error('useDashboardAnalytics must be used within DashboardAnalyticsProvider');
  return value;
}
