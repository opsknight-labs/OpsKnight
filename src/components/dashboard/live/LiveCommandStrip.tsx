'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveClock from '@/components/dashboard/LiveClock';
import {
  LIVE_SCOPES,
  type LiveIncidentQuery,
  type LiveScope,
  type LiveSnapshot,
  type LiveSummary,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';

type Tone = 'rose' | 'amber' | 'emerald' | 'default';

type MetricEmphasis = 'critical' | 'warning' | 'none';

/**
 * One cell of the metrics row. Deliberately typographic: no per-tile chrome,
 * badges or charts. Colour is reserved for numbers that demand action.
 */
function Metric({
  label,
  value,
  context,
  emphasis,
  active,
  onClick,
  testId,
  title,
}: {
  label: string;
  value: number | null;
  context: React.ReactNode;
  emphasis: MetricEmphasis;
  active: boolean;
  onClick: () => void;
  testId: string;
  title: string;
}) {
  const valueClass =
    value === null || value === 0
      ? 'text-zinc-500'
      : emphasis === 'critical'
        ? 'text-rose-400 font-bold'
        : emphasis === 'warning'
          ? 'text-amber-300 font-bold'
          : 'text-zinc-50 font-bold';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      title={title}
      data-icon-button
      className={cn(
        'group relative min-w-0 bg-[#0c0c0f] px-4 py-3.5 text-left sm:px-5 sm:py-4 outline-none transition-colors',
        'hover:bg-[#121216] focus-visible:bg-[#121216] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500',
        active && 'bg-[#141418]'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="block truncate text-[12px] font-medium text-zinc-400 group-hover:text-zinc-300">
          {label}
        </span>
        {emphasis === 'critical' && value !== null && value > 0 && (
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 motion-safe:animate-pulse" aria-hidden />
        )}
        {emphasis === 'warning' && value !== null && value > 0 && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        )}
      </div>
      <span
        className={cn(
          'mt-2 block font-display text-[30px] sm:text-[32px] leading-none tabular-nums tracking-[-0.03em]',
          valueClass
        )}
      >
        {value !== null && value < 10 && value > 0 ? `0${value}` : (value ?? '—')}
      </span>
      <span className="mt-2 block truncate text-[12px] text-zinc-500">{context}</span>
      {active && (
        <span aria-hidden className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-zinc-200" />
      )}
    </button>
  );
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.max(1, Math.round(value))}m`;
  if (value < 1440) return `${(value / 60).toFixed(1)}h`;
  return `${(value / 1440).toFixed(1)}d`;
}

type Fragment = {
  text: string;
  tone: 'rose' | 'amber' | 'muted';
  patch?: Partial<LiveIncidentQuery>;
};

/** Plain-language situation summary; each fragment focuses the feed on what it describes. */
export function buildNarrative(snapshot: LiveSnapshot | null): Fragment[] {
  if (!snapshot) return [{ text: 'Connecting to live data…', tone: 'muted' }];
  const { summary, trend } = snapshot;
  if (summary.active === 0) return [];
  const fragments: Fragment[] = [];
  const hotspot = snapshot.rail.servicesAtRisk.find(service => service.critical > 0);
  if (hotspot) {
    fragments.push({
      text: `${hotspot.critical} critical on ${hotspot.name}`,
      tone: 'rose',
      patch: { view: 'critical', serviceId: hotspot.id },
    });
  } else if (summary.critical > 0) {
    fragments.push({
      text: `${summary.critical} critical`,
      tone: 'rose',
      patch: { view: 'critical' },
    });
  }
  if (summary.slaRecentlyBreached > 0) {
    fragments.push({
      text: `${summary.slaRecentlyBreached} breached SLA this hour`,
      tone: 'rose',
      patch: { view: 'breaching' },
    });
  }
  if (summary.slaDueSoon > 0) {
    fragments.push({
      text: `${summary.slaDueSoon} due within 10 min`,
      tone: 'amber',
      patch: { view: 'breaching' },
    });
  }
  if (summary.unassignedCritical > 0) {
    fragments.push({
      text: `${summary.unassignedCritical} critical unowned`,
      tone: 'rose',
      patch: { view: 'unassigned', urgency: 'all' },
    });
  } else if (summary.unassigned > 0) {
    fragments.push({
      text: `${summary.unassigned} unassigned`,
      tone: 'muted',
      patch: { view: 'unassigned' },
    });
  }
  if (trend.createdLastHour > 0) {
    fragments.push({ text: `+${trend.createdLastHour} new this hour`, tone: 'muted' });
  }
  return fragments;
}

/** Back-compat helper used by the wallboard headline. */
export function buildInsight(summary: LiveSummary | null): { text: string; tone: Tone } {
  if (!summary) return { text: 'Connecting to live data…', tone: 'default' };
  if (summary.critical > 0)
    return {
      text: `${summary.critical} critical incident${summary.critical === 1 ? '' : 's'} need attention`,
      tone: 'rose',
    };
  if (summary.slaAtRisk > 0)
    return { text: `${summary.slaAtRisk} incidents at SLA risk`, tone: 'amber' };
  if (summary.unassigned > 0)
    return { text: `${summary.unassigned} active incidents are unassigned`, tone: 'amber' };
  if (summary.active > 0)
    return { text: `${summary.active} active, all owned and within SLA`, tone: 'amber' };
  return { text: 'All clear — no active incidents', tone: 'emerald' };
}

const SCOPE_LABEL = new Map<LiveScope, string>([
  ['all', 'All'],
  ['teams', 'My teams'],
  ['mine', 'Mine'],
]);

export default function LiveCommandStrip({
  scopeMode,
  timeZone,
}: {
  timeZone: string;
  scopeMode: 'GLOBAL' | 'SCOPED' | 'NONE';
}) {
  const router = useRouter();
  const { snapshot, query, setQuery } = useLiveDashboard();
  const summary = snapshot?.summary ?? null;
  const trend = snapshot?.trend ?? null;
  const narrative = buildNarrative(snapshot);

  const status =
    scopeMode === 'NONE'
      ? { label: 'No operational scope', dot: 'bg-zinc-500', text: 'text-zinc-400' }
      : !summary
        ? { label: 'Connecting', dot: 'bg-zinc-500', text: 'text-zinc-400' }
        : summary.critical > 0 || summary.slaDueSoon > 0 || summary.slaRecentlyBreached > 0
          ? { label: 'Critical', dot: 'bg-rose-500 motion-safe:animate-pulse', text: 'text-rose-300' }
          : summary.active > 0
            ? { label: 'Degraded', dot: 'bg-amber-400', text: 'text-amber-200' }
            : { label: 'Operational', dot: 'bg-emerald-400', text: 'text-emerald-300' };

  const isFocused = (patch: Partial<LiveIncidentQuery>) =>
    Object.entries(patch).every(([key, value]) => query[key as keyof LiveIncidentQuery] === value);
  const reset: Partial<LiveIncidentQuery> = { view: 'active', status: 'all', assignment: 'all' };
  const focus = (patch: Partial<LiveIncidentQuery>) =>
    setQuery(isFocused(patch) ? reset : { ...reset, ...patch });
  const lastHour = (count: number | undefined, verb: string) =>
    trend ? (count ? `+${count} ${verb} · last hour` : `None ${verb} · last hour`) : '\u00a0';

  return (
    <section
      data-testid="command-center"
      aria-label="Command center"
      className="overflow-hidden rounded-xl border border-border dark:border-zinc-800 shadow-xs"
    >
      {/* Top Header: Theme-aware surface (clean and integrated in light mode, sleek dark in dark mode) */}
      <div className="flex flex-col gap-3 bg-card px-5 pb-4 pt-4 text-card-foreground border-b border-border dark:border-zinc-800 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="dash-hero-title text-foreground">Command Center</h1>
            <span
              data-testid="command-status"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                status.dot.includes('rose')
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : status.dot.includes('amber')
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} aria-hidden />
              {status.label}
            </span>
          </div>
          <p
            data-testid="command-insight"
            aria-live="polite"
            className="mt-2 text-[13px] leading-6 text-muted-foreground"
          >
            {narrative.length === 0 ? (
              <span className="text-muted-foreground">
                No active incidents{query.scope !== 'all' ? ' in this scope' : ''}. Everything is
                quiet.
              </span>
            ) : (
              narrative.map((fragment, index) => (
                <span key={fragment.text}>
                  {index > 0 && (
                    <span aria-hidden className="mx-2 text-muted-foreground/40">
                      /
                    </span>
                  )}
                  {fragment.patch ? (
                    <button
                      type="button"
                      data-icon-button
                      onClick={() => setQuery({ ...reset, ...fragment.patch })}
                      className={cn(
                        'rounded-sm p-0 font-medium decoration-1 underline-offset-4 outline-none hover:underline focus-visible:underline',
                        fragment.tone === 'rose'
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : fragment.tone === 'amber'
                            ? 'text-amber-700 dark:text-amber-300 font-semibold'
                            : 'text-foreground font-semibold'
                      )}
                    >
                      {fragment.text}
                    </button>
                  ) : (
                    <span>{fragment.text}</span>
                  )}
                </span>
              ))
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline">
            <LiveClock timeZone={timeZone} variant="plain" />
          </span>
          <div
            role="radiogroup"
            aria-label="Incident scope"
            data-testid="scope-switch"
            className="inline-flex h-8 items-center rounded-lg border border-border dark:border-zinc-800 bg-muted/40 dark:bg-zinc-900/60 p-0.5 text-[12px] font-medium"
          >
            {LIVE_SCOPES.map(scope => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={query.scope === scope}
                data-testid={`scope-${scope}`}
                data-icon-button
                onClick={() => setQuery({ scope })}
                className={cn(
                  'h-full whitespace-nowrap rounded-md px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
                  query.scope === scope
                    ? 'bg-card text-foreground shadow-2xs font-semibold dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100'
                )}
              >
                {SCOPE_LABEL.get(scope)}
                {scope === 'mine' && summary ? (
                  <span className="ml-1.5 rounded-full bg-muted dark:bg-zinc-800/80 px-1.5 py-0.2 text-[10px] tabular-nums font-semibold text-muted-foreground dark:text-zinc-400">
                    {summary.mine}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <Link
            href="/wallboard"
            data-testid="command-wallboard"
            title="Full-screen operations command console for office TVs and NOC screens"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border dark:border-zinc-800 bg-card dark:bg-[#0c0c0f] px-2.5 text-[12px] font-medium text-foreground dark:text-zinc-300 shadow-2xs outline-none transition-colors hover:bg-muted dark:hover:bg-zinc-900 hover:text-foreground dark:hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Operations Console</span>
            <span className="sr-only sm:hidden">Operations Console</span>
          </Link>
        </div>
      </div>

      {/* Bottom Telemetry Strip: Dark avionics / instrument ribbon */}
      <div
        className="grid grid-cols-2 gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-3 xl:grid-cols-6"
        data-testid="command-center-counters"
      >
        <Metric
          testId="counter-triggered"
          label="Awaiting response"
          title="Show triggered incidents in the live feed"
          value={summary?.triggered ?? null}
          context={lastHour(trend?.createdLastHour, 'new')}
          emphasis="none"
          active={isFocused({ status: 'OPEN' })}
          onClick={() => focus({ status: 'OPEN' })}
        />
        <Metric
          testId="counter-critical"
          label="Critical"
          title="Show P1 / high-urgency incidents in the live feed"
          value={summary?.critical ?? null}
          context={lastHour(trend?.createdCriticalLastHour, 'new')}
          emphasis="critical"
          active={isFocused({ view: 'critical' })}
          onClick={() => focus({ view: 'critical' })}
        />
        <Metric
          testId="counter-sla"
          label="SLA at risk"
          title="Due within 30 minutes or breached in the last hour"
          value={summary?.slaAtRisk ?? null}
          context={
            summary?.slaDueSoon || summary?.slaRecentlyBreached ? (
              <span className="text-amber-200/90">
                {[
                  summary.slaRecentlyBreached
                    ? `${summary.slaRecentlyBreached} breached <1h`
                    : null,
                  summary.slaDueSoon ? `${summary.slaDueSoon} due <10m` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : summary ? (
              `${summary.slaBreached} breached overall`
            ) : (
              '\u00a0'
            )
          }
          emphasis="warning"
          active={isFocused({ view: 'breaching' })}
          onClick={() => focus({ view: 'breaching' })}
        />
        <Metric
          testId="counter-unassigned"
          label="Unassigned"
          title="Show incidents without an owner in the live feed"
          value={summary?.unassigned ?? null}
          context={
            summary?.unassignedCritical ? (
              <span className="text-rose-300/90">
                {summary.unassignedCritical} of them critical
              </span>
            ) : summary ? (
              'All critical work is owned'
            ) : (
              '\u00a0'
            )
          }
          emphasis={summary?.unassignedCritical ? 'warning' : 'none'}
          active={isFocused({ view: 'unassigned' })}
          onClick={() => focus({ view: 'unassigned' })}
        />
        <Metric
          testId="counter-acknowledged"
          label="Acknowledged"
          title="Show acknowledged incidents in the live feed"
          value={summary?.acknowledged ?? null}
          context={lastHour(trend?.acknowledgedLastHour, 'acked')}
          emphasis="none"
          active={isFocused({ status: 'ACKNOWLEDGED' })}
          onClick={() => focus({ status: 'ACKNOWLEDGED' })}
        />
        <Metric
          testId="counter-resolved"
          label="Resolved · 24h"
          title="Open resolved incidents"
          value={trend?.resolved24h ?? null}
          context={
            trend
              ? `MTTA ${formatMinutes(trend.mtta24h)} · MTTR ${formatMinutes(trend.mttr24h)}`
              : '\u00a0'
          }
          emphasis="none"
          active={false}
          onClick={() => router.push('/incidents?filter=resolved')}
        />
      </div>
    </section>
  );
}
