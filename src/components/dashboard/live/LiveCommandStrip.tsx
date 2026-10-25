'use client';

import Link from 'next/link';
import {
  AlertOctagon,
  BellRing,
  CheckCheck,
  Clock3,
  Monitor,
  UserX,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveClock from '@/components/dashboard/LiveClock';
import { useRealtime } from '@/hooks/useRealtime';
import { useDashboardAnalytics } from '@/components/dashboard/DashboardAnalyticsProvider';
import { useHistoryQuery } from '@/components/dashboard/DashboardHistorySection';
import {
  HISTORY_RANGES,
  type LiveIncidentQuery,
  type LiveSummary,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';

type Tone = 'rose' | 'amber' | 'emerald' | 'default';

function toneClasses(tone: Tone, active: boolean): { tile: string; value: string; icon: string } {
  const ring = active ? 'ring-2 ring-white/40' : '';
  switch (tone) {
    case 'rose':
      return {
        tile: cn(
          'border-rose-500/30 bg-rose-950/20 hover:border-rose-500/50 hover:bg-rose-950/30',
          ring
        ),
        value: 'text-rose-400',
        icon: 'text-rose-400/80',
      };
    case 'amber':
      return {
        tile: cn(
          'border-amber-500/30 bg-amber-950/20 hover:border-amber-500/50 hover:bg-amber-950/30',
          ring
        ),
        value: 'text-amber-400',
        icon: 'text-amber-400/80',
      };
    case 'emerald':
      return {
        tile: cn('border-emerald-500/30 bg-emerald-950/20', ring),
        value: 'text-emerald-400',
        icon: 'text-emerald-400/80',
      };
    default:
      return {
        tile: cn(
          'border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700/80 hover:bg-zinc-800/60',
          ring
        ),
        value: 'text-white',
        icon: 'text-slate-500',
      };
  }
}

function StatTile({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  active = false,
  onClick,
  href,
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone: Tone;
  icon: LucideIcon;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  testId: string;
}) {
  const classes = toneClasses(tone, active);
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', classes.icon)} aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          'mt-1.5 block text-3xl font-extrabold leading-none tabular-nums tracking-tight',
          classes.value
        )}
      >
        {value}
      </span>
      {hint && <span className="mt-1.5 block truncate text-[11px] text-slate-400">{hint}</span>}
    </>
  );
  const className = cn(
    'flex min-h-[6.25rem] min-w-0 flex-col items-start justify-center rounded-xl border px-4 py-3 text-left shadow-xs backdrop-blur-xs transition-all outline-none',
    'focus-visible:ring-2 focus-visible:ring-white/50',
    classes.tile
  );
  if (href) {
    return (
      <Link href={href} className={className} data-testid={testId}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Show ${label.toLowerCase()} incidents in the live feed`}
      className={className}
      data-testid={testId}
    >
      {body}
    </button>
  );
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.round(value)}m`;
  if (value < 1440) return `${(value / 60).toFixed(1)}h`;
  return `${(value / 1440).toFixed(1)}d`;
}

export function buildInsight(summary: LiveSummary | null): {
  text: string;
  tone: Tone;
} {
  if (!summary) return { text: 'Connecting to live data…', tone: 'default' };
  if (summary.slaBreached > 0)
    return {
      text: `${summary.slaBreached} incident${summary.slaBreached === 1 ? ' has' : 's have'} breached SLA`,
      tone: 'rose',
    };
  if (summary.critical > 0)
    return {
      text: `${summary.critical} critical incident${summary.critical === 1 ? '' : 's'} need attention`,
      tone: 'rose',
    };
  if (summary.unassigned > 0)
    return {
      text: `${summary.unassigned} active incident${summary.unassigned === 1 ? ' is' : 's are'} unassigned`,
      tone: 'amber',
    };
  if (summary.active > 0)
    return { text: `${summary.active} active, all owned and within SLA`, tone: 'amber' };
  return { text: 'All clear — no active incidents', tone: 'emerald' };
}

export default function LiveCommandStrip({
  scopeMode,
  initialMuted,
  timeZone,
}: {
  timeZone: string;
  scopeMode: 'GLOBAL' | 'SCOPED' | 'NONE';
  initialMuted: { snoozed: number; suppressed: number };
}) {
  const { snapshot, query, setQuery } = useLiveDashboard();
  const { metrics } = useRealtime();
  const analytics = useDashboardAnalytics();
  const history = useHistoryQuery();
  const summary = snapshot?.summary ?? null;
  const snoozed = metrics?.snoozed ?? initialMuted.snoozed;
  const suppressed = metrics?.suppressed ?? initialMuted.suppressed;
  const insight = buildInsight(summary);

  const status =
    scopeMode === 'NONE'
      ? { label: 'No operational scope', dot: 'bg-slate-400', text: 'text-slate-300' }
      : !summary
        ? { label: 'Connecting', dot: 'bg-slate-400', text: 'text-slate-300' }
        : summary.critical > 0 || summary.slaBreached > 0
          ? { label: 'Critical', dot: 'bg-rose-500', text: 'text-rose-300' }
          : summary.active > 0
            ? { label: 'Degraded', dot: 'bg-amber-400', text: 'text-amber-200' }
            : { label: 'Operational', dot: 'bg-emerald-400', text: 'text-emerald-300' };

  const isFocused = (patch: Partial<LiveIncidentQuery>) =>
    Object.entries(patch).every(([key, value]) => query[key as keyof LiveIncidentQuery] === value);
  const focus = (patch: Partial<LiveIncidentQuery>) => {
    const reset: Partial<LiveIncidentQuery> = { view: 'active', status: 'all', assignment: 'all' };
    setQuery(isFocused(patch) ? reset : { ...reset, ...patch });
  };
  const tone = (count: number | undefined, positive: Tone): Tone =>
    (count ?? 0) > 0 ? positive : 'default';

  return (
    <section
      data-testid="command-center"
      aria-label="Command center"
      className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 text-slate-100 shadow-xl ring-1 ring-white/5 md:p-5"
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Command Center
            </h1>
            <LiveClock timeZone={timeZone} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-300">
              {scopeMode === 'GLOBAL' ? 'System status:' : 'Your operational scope:'}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                status.text
              )}
              data-testid="command-status"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} aria-hidden />
              {status.label}
            </span>
            <span
              data-testid="command-insight"
              aria-live="polite"
              className={cn(
                'text-xs',
                insight.tone === 'rose'
                  ? 'text-rose-300'
                  : insight.tone === 'amber'
                    ? 'text-amber-200'
                    : insight.tone === 'emerald'
                      ? 'text-emerald-300'
                      : 'text-slate-400'
              )}
            >
              {insight.text}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex h-8 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 text-[11px] text-slate-400"
            title="Mean time to acknowledge / resolve for the reporting period"
            data-testid="command-mtt"
          >
            <span>
              MTTA{' '}
              <strong className="font-semibold tabular-nums text-white">
                {formatMinutes(analytics.data?.mtta)}
              </strong>
            </span>
            <span>
              MTTR{' '}
              <strong className="font-semibold tabular-nums text-white">
                {formatMinutes(analytics.data?.mttr)}
              </strong>
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label="Reporting period for MTTA, MTTR and trends"
            className="inline-flex h-8 items-center rounded-lg border border-zinc-800 bg-zinc-900/70 p-0.5"
            data-testid="command-period"
          >
            {HISTORY_RANGES.map(range => (
              <button
                key={range}
                type="button"
                role="radio"
                aria-checked={history.query.range === range}
                data-testid={`period-${range}`}
                onClick={() => history.setQuery({ range })}
                className={cn(
                  'h-full rounded-md px-2.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                  history.query.range === range
                    ? 'bg-zinc-700 text-white'
                    : 'text-slate-400 hover:text-white'
                )}
              >
                {range}d
              </button>
            ))}
          </div>
          <Link
            href="/wallboard"
            data-testid="command-wallboard"
            title="Full-screen view for office TVs and NOC screens"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-slate-200 hover:bg-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Wallboard
          </Link>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        data-testid="command-center-counters"
      >
        <StatTile
          testId="counter-triggered"
          label="Triggered"
          hint="Not yet acknowledged"
          icon={BellRing}
          value={summary?.triggered ?? '—'}
          tone={tone(summary?.triggered, 'rose')}
          active={isFocused({ status: 'OPEN' })}
          onClick={() => focus({ status: 'OPEN' })}
        />
        <StatTile
          testId="counter-critical"
          label="Critical"
          hint="High urgency or P1"
          icon={AlertOctagon}
          value={summary?.critical ?? '—'}
          tone={tone(summary?.critical, 'rose')}
          active={isFocused({ view: 'critical' })}
          onClick={() => focus({ view: 'critical' })}
        />
        <StatTile
          testId="counter-acknowledged"
          label="Acknowledged"
          hint="Being worked"
          icon={CheckCheck}
          value={summary?.acknowledged ?? '—'}
          tone={tone(summary?.acknowledged, 'amber')}
          active={isFocused({ status: 'ACKNOWLEDGED' })}
          onClick={() => focus({ status: 'ACKNOWLEDGED' })}
        />
        <StatTile
          testId="counter-unassigned"
          label="Unassigned"
          hint="No owner"
          icon={UserX}
          value={summary?.unassigned ?? '—'}
          tone={tone(summary?.unassigned, 'amber')}
          active={isFocused({ view: 'unassigned' })}
          onClick={() => focus({ view: 'unassigned' })}
        />
        <StatTile
          testId="counter-sla"
          label="SLA risk"
          hint={summary ? `${summary.slaBreached} breached` : undefined}
          icon={Clock3}
          value={summary?.slaAtRisk ?? '—'}
          tone={(summary?.slaBreached ?? 0) > 0 ? 'rose' : tone(summary?.slaAtRisk, 'amber')}
          active={isFocused({ view: 'breaching' })}
          onClick={() => focus({ view: 'breaching' })}
        />
        <StatTile
          testId="counter-muted"
          label="Muted"
          hint={`${snoozed} snoozed · ${suppressed} suppressed`}
          icon={VolumeX}
          value={snoozed + suppressed}
          tone="default"
          href="/incidents?filter=muted"
        />
      </div>
    </section>
  );
}
