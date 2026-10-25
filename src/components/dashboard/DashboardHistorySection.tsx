'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ArrowRight, TrendingUp } from 'lucide-react';
import { DashboardAnalyticsProvider } from '@/components/dashboard/DashboardAnalyticsProvider';
import {
  DashboardAnalyticsHeatmap,
  DashboardPerformanceAnalytics,
  DashboardTeamLoadAnalytics,
} from '@/components/dashboard/DashboardAnalyticsWidgets';

import type { HistoryQuery } from '@/lib/dashboard/live-incidents-shared';

type HistoryContextValue = {
  query: HistoryQuery;
  setQuery: (patch: Partial<HistoryQuery>) => void;
};
const HistoryContext = createContext<HistoryContextValue | null>(null);

export function useHistoryQuery(): HistoryContextValue {
  const value = useContext(HistoryContext);
  if (!value) throw new Error('useHistoryQuery must be used within DashboardHistoryProvider');
  return value;
}

/**
 * Owns the dashboard reporting period (selected once, in the command strip). It lives in client
 * state and the URL (replaceState), so a change refetches the single analytics projection without
 * re-rendering the server page or touching live data. Deep filtering lives on /analytics.
 */
export function DashboardHistoryProvider({
  initialQuery,
  children,
}: {
  initialQuery: HistoryQuery;
  children: ReactNode;
}) {
  const [query, setQueryState] = useState(initialQuery);
  const queryRef = useRef(initialQuery);
  const setQuery = useCallback((patch: Partial<HistoryQuery>) => {
    const next = { ...queryRef.current, ...patch };
    queryRef.current = next;
    setQueryState(next);
    const url = new URL(window.location.href);
    if (next.range === '30') url.searchParams.delete('range');
    else url.searchParams.set('range', next.range);
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);
  const analyticsQuery = useMemo(() => ({ range: query.range }), [query.range]);
  const contextValue = useMemo(() => ({ query, setQuery }), [query, setQuery]);
  return (
    <HistoryContext.Provider value={contextValue}>
      <DashboardAnalyticsProvider query={analyticsQuery}>{children}</DashboardAnalyticsProvider>
    </HistoryContext.Provider>
  );
}

function useNearViewport<T extends Element>(rootMargin = '400px') {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, visible]);
  return { ref, visible };
}

export default function DashboardHistorySection() {
  const { query } = useHistoryQuery();
  const { ref, visible } = useNearViewport<HTMLDivElement>();

  return (
    <section
      aria-labelledby="dashboard-history-heading"
      data-testid="dashboard-history"
      className="space-y-3"
    >
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2
            id="dashboard-history-heading"
            className="flex items-center gap-2 text-sm font-bold text-foreground"
          >
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
            Trends · last {query.range} days
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Uses the reporting period selected in the Command Center.
          </p>
        </div>
        <Link
          href={`/analytics?range=${query.range}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary"
        >
          Open full analytics
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
        </Link>
      </div>

      {/* Chart rendering is deferred until the section approaches the viewport. */}
      <div ref={ref} className="min-h-[22rem]">
        {visible ? (
          <div className="space-y-4 sm:space-y-5">
            <DashboardAnalyticsHeatmap />
            <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
              <DashboardPerformanceAnalytics />
              <DashboardTeamLoadAnalytics />
            </div>
          </div>
        ) : (
          <div className="h-[22rem] rounded-2xl border border-dashed border-border" aria-hidden />
        )}
      </div>
    </section>
  );
}
