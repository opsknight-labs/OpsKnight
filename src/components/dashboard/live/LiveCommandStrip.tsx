'use client';

import Link from 'next/link';
import { BarChart3, Monitor, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import LiveClock from '@/components/dashboard/LiveClock';
import { useRealtime } from '@/hooks/useRealtime';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { useDashboardAnalytics } from '@/components/dashboard/DashboardAnalyticsProvider';
import { historyRangeLabel, useHistoryQuery } from '@/components/dashboard/DashboardHistorySection';
import type { LiveIncidentQuery, LiveSummary } from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';

type Tone = 'rose' | 'amber' | 'emerald' | 'violet' | 'default';

const TONE: Record<Tone, string> = {
  rose: 'border-rose-500/35 bg-rose-950/25 text-rose-300',
  amber: 'border-amber-500/35 bg-amber-950/25 text-amber-300',
  emerald: 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300',
  violet: 'border-violet-500/30 bg-violet-950/20 text-violet-300',
  default: 'border-zinc-800/80 bg-zinc-900/60 text-white',
};

function Counter({
  label,
  value,
  hint,
  tone,
  active,
  onClick,
  href,
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone: Tone;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  testId: string;
}) {
  const body = (
    <>
      <span className="block text-2xl font-extrabold leading-tight tabular-nums">{value}</span>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {hint && <span className="block truncate text-[10px] text-slate-500">{hint}</span>}
    </>
  );
  const className = cn(
    'min-w-0 rounded-xl border px-3 py-2 text-left transition-colors outline-none',
    'hover:brightness-125 focus-visible:ring-2 focus-visible:ring-white/40',
    TONE[tone],
    active && 'ring-2 ring-white/40'
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

export function buildInsight(summary: LiveSummary | null): { text: string; tone: Tone } {
  if (!summary) return { text: 'Waiting for live data…', tone: 'default' };
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
  canCreate,
  timeZone,
}: {
  timeZone: string;
  scopeMode: 'GLOBAL' | 'SCOPED' | 'NONE';
  initialMuted: { snoozed: number; suppressed: number };
  canCreate: boolean;
}) {
  const { snapshot, query, setQuery } = useLiveDashboard();
  const { metrics } = useRealtime();
  const { openCreateIncident } = useCreateIncidentModal();
  const analytics = useDashboardAnalytics();
  const rangeLabel = historyRangeLabel(useHistoryQuery().query);
  const summary = snapshot?.summary ?? null;
  const snoozed = metrics?.snoozed ?? initialMuted.snoozed;
  const suppressed = metrics?.suppressed ?? initialMuted.suppressed;
  const insight = buildInsight(summary);

  const status =
    scopeMode === 'NONE'
      ? { label: 'NO OPERATIONAL SCOPE', variant: 'neutral' as const }
      : !summary
        ? { label: 'CONNECTING', variant: 'neutral' as const }
        : summary.critical > 0 || summary.slaBreached > 0
          ? { label: 'CRITICAL', variant: 'danger' as const }
          : summary.active > 0
            ? { label: 'DEGRADED', variant: 'warning' as const }
            : { label: 'OPERATIONAL', variant: 'success' as const };

  const isFocused = (patch: Partial<LiveIncidentQuery>) =>
    Object.entries(patch).every(([key, value]) => query[key as keyof LiveIncidentQuery] === value);
  const focus = (patch: Partial<LiveIncidentQuery>) => {
    const reset: Partial<LiveIncidentQuery> = { view: 'active', status: 'all', assignment: 'all' };
    setQuery(isFocused(patch) ? reset : { ...reset, ...patch });
    document.getElementById('live-incidents-heading')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  };

  return (
    <section
      data-testid="command-center"
      aria-label="Command center"
      className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-3 text-slate-100 shadow-xl ring-1 ring-white/5 md:p-4"
    >
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-extrabold tracking-tight text-white md:text-2xl">
              Command Center
            </h1>
            <LiveClock timeZone={timeZone} />
            <Badge variant={status.variant} size="xs" className="font-bold uppercase tracking-wide">
              {status.label}
            </Badge>
          </div>
          <p
            data-testid="command-insight"
            aria-live="polite"
            className={cn(
              'text-xs font-medium',
              insight.tone === 'rose'
                ? 'text-rose-300'
                : insight.tone === 'amber'
                  ? 'text-amber-300'
                  : insight.tone === 'emerald'
                    ? 'text-emerald-300'
                    : 'text-slate-400'
            )}
          >
            {insight.text}
            {scopeMode === 'SCOPED' && <span className="text-slate-500"> · your teams</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="hidden sm:flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-slate-300"
            title={`Mean time to acknowledge / resolve (${rangeLabel})`}
            data-testid="command-mtt"
          >
            <span>
              MTTA{' '}
              <strong className="text-white tabular-nums">
                {formatMinutes(analytics.data?.mtta)}
              </strong>
            </span>
            <span>
              MTTR{' '}
              <strong className="text-white tabular-nums">
                {formatMinutes(analytics.data?.mttr)}
              </strong>
            </span>
            <span className="text-slate-500">{rangeLabel}</span>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={() => openCreateIncident()}
              data-testid="command-create-incident"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-rose-500 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create incident
            </button>
          )}
          <Link
            href="/?view=wallboard"
            data-testid="command-wallboard"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-slate-200 hover:bg-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Monitor className="h-3.5 w-3.5" aria-hidden />
            Wallboard
          </Link>
          <Link
            href="/analytics"
            className="hidden md:inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-slate-200 hover:bg-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <BarChart3 className="h-3.5 w-3.5" aria-hidden />
            Analytics
          </Link>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
        data-testid="command-center-counters"
      >
        <Counter
          testId="counter-triggered"
          label="Triggered"
          value={summary?.triggered ?? '—'}
          tone={(summary?.triggered ?? 0) > 0 ? 'rose' : 'default'}
          active={isFocused({ status: 'OPEN' })}
          onClick={() => focus({ status: 'OPEN' })}
        />
        <Counter
          testId="counter-critical"
          label="Critical"
          value={summary?.critical ?? '—'}
          hint="High urgency or P1"
          tone={(summary?.critical ?? 0) > 0 ? 'rose' : 'default'}
          active={isFocused({ view: 'critical' })}
          onClick={() => focus({ view: 'critical' })}
        />
        <Counter
          testId="counter-acknowledged"
          label="Acknowledged"
          value={summary?.acknowledged ?? '—'}
          tone={(summary?.acknowledged ?? 0) > 0 ? 'amber' : 'default'}
          active={isFocused({ status: 'ACKNOWLEDGED' })}
          onClick={() => focus({ status: 'ACKNOWLEDGED' })}
        />
        <Counter
          testId="counter-unassigned"
          label="Unassigned"
          value={summary?.unassigned ?? '—'}
          tone={(summary?.unassigned ?? 0) > 0 ? 'amber' : 'default'}
          active={isFocused({ view: 'unassigned' })}
          onClick={() => focus({ view: 'unassigned' })}
        />
        <Counter
          testId="counter-sla"
          label="SLA risk"
          value={summary?.slaAtRisk ?? '—'}
          hint={summary ? `${summary.slaBreached} breached` : undefined}
          tone={
            (summary?.slaBreached ?? 0) > 0
              ? 'rose'
              : (summary?.slaAtRisk ?? 0) > 0
                ? 'amber'
                : 'default'
          }
          active={isFocused({ view: 'breaching' })}
          onClick={() => focus({ view: 'breaching' })}
        />
        <Counter
          testId="counter-muted"
          label="Muted"
          value={snoozed + suppressed}
          hint={`${snoozed} snoozed · ${suppressed} suppressed`}
          tone="default"
          href="/incidents?filter=muted"
        />
      </div>
    </section>
  );
}
