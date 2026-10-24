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
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { DashboardAnalyticsProvider } from '@/components/dashboard/DashboardAnalyticsProvider';
import {
  DashboardAnalyticsHeatmap,
  DashboardPerformanceAnalytics,
  DashboardTeamLoadAnalytics,
} from '@/components/dashboard/DashboardAnalyticsWidgets';

export type HistoryQuery = {
  range: '7' | '30' | '90' | 'all' | 'custom';
  startDate?: string;
  endDate?: string;
  service?: string;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
};

const RANGES: Array<{ value: HistoryQuery['range']; label: string }> = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

export function historyRangeLabel(query: HistoryQuery): string {
  if (query.range === 'all') return 'all time';
  if (query.range === 'custom') return 'custom range';
  return `${query.range}d`;
}

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
 * Owns the reporting-range filters. They live only in client state and the URL (replaceState),
 * so changing them refetches the single analytics projection without re-rendering the server
 * page or touching the live feed.
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
    for (const key of ['range', 'startDate', 'endDate', 'service', 'urgency'] as const) {
      const value = next[key];
      const keep =
        value &&
        !(key === 'range' && value === '30') &&
        !(next.range !== 'custom' && (key === 'startDate' || key === 'endDate'));
      if (keep) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);
  const analyticsQuery = useMemo(
    () => ({
      range: query.range,
      startDate: query.range === 'custom' ? query.startDate : undefined,
      endDate: query.range === 'custom' ? query.endDate : undefined,
      service: query.service,
      urgency: query.urgency,
    }),
    [query]
  );
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
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
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

export default function DashboardHistorySection({
  services,
}: {
  services: Array<{ id: string; name: string }>;
}) {
  const { query, setQuery } = useHistoryQuery();
  const { ref, visible } = useNearViewport<HTMLDivElement>();
  const triggerClass = 'h-8 text-xs bg-card border-border rounded-lg shadow-2xs';

  return (
    <section
      aria-labelledby="dashboard-history-heading"
      data-testid="dashboard-history"
      className="space-y-4"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <History className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h2 id="dashboard-history-heading" className="text-sm font-bold text-foreground">
              History &amp; Analytics
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Reporting filters apply to this section only — live data above is always current.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Reporting range"
            className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
          >
            {RANGES.map(range => (
              <button
                key={range.value}
                type="button"
                aria-pressed={query.range === range.value}
                data-testid={`history-range-${range.value}`}
                onClick={() => setQuery({ range: range.value })}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  query.range === range.value
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
          {query.range === 'custom' && (
            <>
              <Input
                type="date"
                aria-label="Start date"
                value={query.startDate?.slice(0, 10) ?? ''}
                onChange={event => setQuery({ startDate: event.target.value || undefined })}
                className={cn(triggerClass, 'w-36')}
              />
              <Input
                type="date"
                aria-label="End date"
                value={query.endDate?.slice(0, 10) ?? ''}
                onChange={event => setQuery({ endDate: event.target.value || undefined })}
                className={cn(triggerClass, 'w-36')}
              />
            </>
          )}
          <Select
            value={query.service ?? 'all'}
            onValueChange={value => setQuery({ service: value === 'all' ? undefined : value })}
          >
            <SelectTrigger className={cn(triggerClass, 'w-44')} aria-label="History service filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {services.map(service => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={query.urgency ?? 'all'}
            onValueChange={value =>
              setQuery({
                urgency: value === 'all' ? undefined : (value as HistoryQuery['urgency']),
              })
            }
          >
            <SelectTrigger className={cn(triggerClass, 'w-36')} aria-label="History urgency filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All urgencies</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Chart rendering is deferred until the section approaches the viewport. */}
      <div ref={ref} className="min-h-[24rem]">
        {visible ? (
          <div className="space-y-4 sm:space-y-5">
            <DashboardAnalyticsHeatmap />
            <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
              <DashboardPerformanceAnalytics />
              <DashboardTeamLoadAnalytics />
            </div>
          </div>
        ) : (
          <div className="h-[24rem] rounded-2xl border border-dashed border-border" aria-hidden />
        )}
      </div>
    </section>
  );
}
