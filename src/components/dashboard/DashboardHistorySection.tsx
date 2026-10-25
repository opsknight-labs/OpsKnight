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
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CheckCircle2,
  Clock3,
  MessageSquare,
  RotateCcw,
  Target,
  Timer,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DashboardAnalyticsProvider,
  useActivateDashboardAnalytics,
  useDashboardAnalytics,
} from '@/components/dashboard/DashboardAnalyticsProvider';
import { DashboardAnalyticsHeatmap } from '@/components/dashboard/DashboardAnalyticsWidgets';
import CompactTeamLoad from '@/components/dashboard/compact/CompactTeamLoad';
import {
  HISTORY_RANGES,
  formatIncidentAge,
  type HistoryQuery,
  type LiveActivityItem,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './live/LiveDashboardProvider';

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

export function useOptionalHistoryQuery(): HistoryContextValue | null {
  return useContext(HistoryContext);
}

/**
 * Owns the dashboard reporting period. It lives in client state and the URL (replaceState), so a
 * change refetches the single analytics projection without re-rendering the server page or
 * touching live data. Deep filtering lives on /analytics.
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

const card = 'rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.05)]';

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.max(1, Math.round(value))}m`;
  if (value < 1440) return `${(value / 60).toFixed(1)}h`;
  return `${(value / 1440).toFixed(1)}d`;
}

/** Lower is better for MTTA/MTTR: a decrease is good news. */
function TimeDelta({
  current,
  previous,
  range,
}: {
  current: number | null;
  previous: number | null;
  range: string;
}) {
  if (current === null || previous === null || previous <= 0) {
    return <p className="text-[11px] text-muted-foreground">No prior-period sample</p>;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 1) {
    return <p className="text-[11px] text-muted-foreground">No change vs prior {range}d</p>;
  }
  const better = diff < 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums border shadow-2xs',
        better
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
      )}
    >
      <span>{better ? '▼' : '▲'}</span>
      <span>{formatMinutes(Math.abs(diff))}</span>
      <span className="font-normal opacity-75">vs prior {range}d</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  footer,
  testId,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: string;
  footer: ReactNode;
  testId: string;
  icon?: ReactNode;
  tone?: 'amber' | 'violet' | 'emerald' | 'blue' | 'primary';
}) {
  const toneBg =
    tone === 'amber'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      : tone === 'violet'
        ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20'
        : tone === 'emerald'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
          : tone === 'blue'
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
            : 'bg-primary/10 text-primary border-primary/20';

  return (
    <div
      className={cn(
        card,
        'group flex flex-col justify-between p-3.5 transition-all hover:border-slate-300 dark:hover:border-zinc-700 hover:shadow-xs'
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {icon && (
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border shadow-2xs',
              toneBg
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <p className="my-1 font-display text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <div>{footer}</div>
    </div>
  );
}

function ComplianceBar({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="mt-1 space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct >= 95
              ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
              : pct >= 80
                ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                : 'bg-gradient-to-r from-rose-500 to-rose-400'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Created vs resolved area chart in plain SVG (no chart runtime on the dashboard). */
function FlowChart({
  series,
}: {
  series: Array<{ label: string; count: number; resolveCount: number }>;
}) {
  if (series.length < 2) {
    return (
      <p className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        Not enough data in this period yet
      </p>
    );
  }
  const width = 600;
  const height = 150;
  const max = Math.max(1, ...series.map(point => Math.max(point.count, point.resolveCount)));
  const x = (index: number) => (index / (series.length - 1)) * width;
  const y = (value: number) => height - 8 - (value / max) * (height - 24);
  const line = (key: 'count' | 'resolveCount') =>
    series
      .map((point, index) => {
        const value = key === 'count' ? point.count : point.resolveCount;
        return `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      })
      .join(' ');
  const area = (key: 'count' | 'resolveCount') => `${line(key)} L${width},${height} L0,${height} Z`;
  const totalCreated = series.reduce((sum, point) => sum + point.count, 0);
  const totalResolved = series.reduce((sum, point) => sum + point.resolveCount, 0);
  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`${totalCreated} incidents created and ${totalResolved} resolved in this period`}
      >
        <defs>
          <linearGradient id="flow-created" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.36" />
            <stop offset="60%" stopColor="#f43f5e" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="flow-resolved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.30" />
            <stop offset="60%" stopColor="#10b981" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Reference guide gridlines */}
        <line
          x1="0"
          y1={height * 0.25}
          x2={width}
          y2={height * 0.25}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-border/40"
        />
        <line
          x1="0"
          y1={height * 0.5}
          x2={width}
          y2={height * 0.5}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-border/40"
        />
        <line
          x1="0"
          y1={height * 0.75}
          x2={width}
          y2={height * 0.75}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-border/40"
        />

        <path d={area('count')} fill="url(#flow-created)" />
        <path
          d={line('count')}
          fill="none"
          stroke="#f43f5e"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area('resolveCount')} fill="url(#flow-resolved)" />
        <path
          d={line('resolveCount')}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Pulse end markers */}
        {series.length > 0 && (
          <>
            <circle
              cx={x(series.length - 1)}
              cy={y(series.at(-1)?.count ?? 0)}
              r="3.5"
              fill="#f43f5e"
              className="stroke-card stroke-2"
            />
            <circle
              cx={x(series.length - 1)}
              cy={y(series.at(-1)?.resolveCount ?? 0)}
              r="3.5"
              fill="#10b981"
              className="stroke-card stroke-2"
            />
          </>
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{series[0]?.label}</span>
        <span>{series.at(-1)?.label}</span>
      </figcaption>
    </figure>
  );
}

const ACTIVITY_FILTERS = [
  { key: 'all', label: 'All', types: null },
  { key: 'ack', label: 'Acks', types: ['ACKNOWLEDGED'] },
  { key: 'esc', label: 'Escalations', types: ['ESCALATED'] },
  { key: 'sla', label: 'SLA', types: ['SLA_WARNING', 'SLA_BREACHED'] },
  { key: 'resolved', label: 'Resolved', types: ['AUTO_RESOLVED', 'MANUAL_RESOLVED'] },
] as const;

function activityIcon(type: string | null): { icon: LucideIcon; tone: string } {
  switch (type) {
    case 'ACKNOWLEDGED':
      return {
        icon: CheckCheck,
        tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
      };
    case 'ESCALATED':
      return {
        icon: ArrowUpRight,
        tone: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
      };
    case 'SLA_WARNING':
    case 'SLA_BREACHED':
      return {
        icon: Clock3,
        tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
      };
    case 'AUTO_RESOLVED':
    case 'MANUAL_RESOLVED':
      return {
        icon: CheckCircle2,
        tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
      };
    case 'ASSIGNMENT':
      return {
        icon: UserPlus,
        tone: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
      };
    case 'COMMENT':
      return {
        icon: MessageSquare,
        tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      };
    default:
      return {
        icon: AlertTriangle,
        tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      };
  }
}

function ActivityTimeline() {
  const { snapshot, now } = useLiveDashboard();
  const [filter, setFilter] = useState<(typeof ACTIVITY_FILTERS)[number]['key']>('all');
  const items: LiveActivityItem[] = snapshot?.rail.activity ?? [];
  const active = ACTIVITY_FILTERS.find(option => option.key === filter);
  const visible = items
    .filter(
      item =>
        !active?.types ||
        (item.type !== null && (active.types as readonly string[]).includes(item.type))
    )
    .slice(0, 10);
  return (
    <div className={cn(card, 'flex flex-col h-[395px] p-4')} data-testid="rail-activity">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="dash-heading-sm">Recent activity</h3>
        <div role="radiogroup" aria-label="Activity type" className="flex flex-wrap gap-1">
          {ACTIVITY_FILTERS.map(option => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                filter === option.key
                  ? 'bg-foreground text-background'
                  : 'border border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div
          className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center"
          role="status"
          aria-label="No matching activity"
        >
          <div className="text-xs font-medium text-muted-foreground">No matching activity</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overscroll-contain pr-1">
          <ol className="flex flex-col gap-2" role="list" aria-label="Recent activity log">
            {visible.map(item => {
              const { icon: Icon, tone } = activityIcon(item.type);
              return (
                <li key={item.id} role="listitem">
                  <Link
                    href={`/incidents/${item.incidentId}`}
                    className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-2xs transition-all hover:border-slate-300 dark:bg-[#121216] dark:hover:border-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-2xs',
                        tone
                      )}
                      aria-hidden
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary"
                          title={item.message}
                        >
                          {item.message}
                        </p>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                          {formatIncidentAge(item.createdAt, now)} ago
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/80">{item.incidentTitle}</span>
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function InsightsContent() {
  const { data, state } = useDashboardAnalytics();
  const { query } = useHistoryQuery();
  if (!data) {
    return (
      <p className={cn(card, 'p-6 text-center text-sm text-muted-foreground')} role="status">
        {state === 'loading' ? 'Loading trends…' : 'Trends are temporarily unavailable.'}
      </p>
    );
  }
  const previous = data.previousPeriod?.available ? data.previousPeriod : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={cn(card, 'p-4 lg:col-span-2')} data-testid="insight-flow">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="dash-heading-sm">Incident flow</h3>
              <p className="text-[11px] text-muted-foreground">
                {data.totalIncidents} created in the last {query.range} days
                {previous ? ` · ${previous.totalIncidents} in the prior period` : ''}
              </p>
            </div>
            <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-rose-400" aria-hidden />
                Created
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-emerald-400" aria-hidden />
                Resolved
              </span>
            </span>
          </div>
          <FlowChart series={data.trendSeries ?? []} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            testId="insight-mtta"
            label="MTTA"
            value={formatMinutes(data.mtta)}
            icon={<Timer className="h-3.5 w-3.5" />}
            tone="amber"
            footer={
              <TimeDelta
                current={data.mtta}
                previous={previous?.mtta ?? null}
                range={query.range}
              />
            }
          />
          <Kpi
            testId="insight-mttr"
            label="MTTR"
            value={formatMinutes(data.mttr)}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            tone="violet"
            footer={
              <TimeDelta
                current={data.mttr}
                previous={previous?.mttr ?? null}
                range={query.range}
              />
            }
          />
          <Kpi
            testId="insight-ack-sla"
            label="Ack SLA"
            value={data.ackCompliance === null ? '—' : `${Math.round(data.ackCompliance)}%`}
            icon={<CheckCheck className="h-3.5 w-3.5" />}
            tone="emerald"
            footer={<ComplianceBar value={data.ackCompliance} />}
          />
          <Kpi
            testId="insight-resolve-sla"
            label="Resolve SLA"
            value={data.resolveCompliance === null ? '—' : `${Math.round(data.resolveCompliance)}%`}
            icon={<Target className="h-3.5 w-3.5" />}
            tone="blue"
            footer={<ComplianceBar value={data.resolveCompliance} />}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <ActivityTimeline />
        <div className={cn(card, 'flex flex-col h-[395px] p-4')} data-testid="insight-team-load">
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <h3 className="dash-heading-sm">Team load</h3>
            {data.assigneeLoad && data.assigneeLoad.length > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {data.assigneeLoad.filter(a => a.count > 0).length} active responder
                {data.assigneeLoad.filter(a => a.count > 0).length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain pr-1">
            <CompactTeamLoad assigneeLoad={data.assigneeLoad} />
          </div>
        </div>
      </div>
      <DashboardAnalyticsHeatmap />
    </div>
  );
}

export default function DashboardHistorySection() {
  const { query, setQuery } = useHistoryQuery();
  const { ref, visible } = useNearViewport<HTMLDivElement>();
  useActivateDashboardAnalytics(visible);
  return (
    <section
      aria-labelledby="dashboard-history-heading"
      data-testid="dashboard-history"
      className="space-y-3 pt-1"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2
            id="dashboard-history-heading"
            className="dash-heading flex items-center gap-2 font-display text-[15px] font-semibold text-foreground"
          >
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
            Trends &amp; insights
          </h2>
          <p className="text-[11px] text-muted-foreground">
            The reporting period applies to this section only; everything above is live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Reporting period"
            data-testid="command-period"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-card p-0.5 text-xs font-semibold shadow-2xs"
          >
            {HISTORY_RANGES.map(range => (
              <button
                key={range}
                type="button"
                role="radio"
                aria-checked={query.range === range}
                data-testid={`period-${range}`}
                onClick={() => setQuery({ range })}
                className={cn(
                  'h-full rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  query.range === range
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {range}d
              </button>
            ))}
          </div>
          <Link
            href={`/analytics?range=${query.range}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary"
          >
            Full analytics
            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
          </Link>
        </div>
      </div>
      <div ref={ref} className="min-h-[22rem]">
        {visible ? (
          <InsightsContent />
        ) : (
          <div className={cn(card, 'h-[22rem] border-dashed')} aria-hidden />
        )}
      </div>
    </section>
  );
}
