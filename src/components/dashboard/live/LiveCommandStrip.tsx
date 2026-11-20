'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import LiveClock from '@/components/dashboard/LiveClock';
import {
  LIVE_SCOPES,
  type LiveIncidentQuery,
  type LiveScope,
  type LiveSnapshot,
  type LiveSummary,
} from '@/lib/dashboard/live-incidents-shared';
import { enterFullscreen, isFullscreenSupported } from '@/lib/fullscreen';
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
  variant = 'primary',
  groupDivider = false,
}: {
  label: string;
  value: number | null;
  context: React.ReactNode;
  emphasis: MetricEmphasis;
  active: boolean;
  onClick: () => void;
  testId: string;
  title: string;
  variant?: 'primary' | 'secondary';
  groupDivider?: boolean;
}) {
  // Same anatomy as the PageHeader stat tile; colour only on numbers that demand action.
  const valueClass =
    value === null || value === 0
      ? 'text-muted-foreground'
      : emphasis === 'critical'
        ? toneClasses('critical').text
        : emphasis === 'warning'
          ? toneClasses('elevated').text
          : variant === 'secondary'
            ? 'text-muted-foreground'
            : 'text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      title={title}
      data-icon-button
      className={cn(
        'group relative block min-w-0 bg-card px-3 py-2.5 text-left outline-none transition-colors duration-150',
        'hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active && 'bg-muted shadow-[inset_0_-2px_0_hsl(var(--ui-foreground))]',
        groupDivider && 'xl:border-l xl:border-border'
      )}
    >
      <span className="flex items-center justify-between gap-1.5">
        <span className="block truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground">
          {label}
        </span>
        {emphasis === 'critical' && value !== null && value > 0 && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-critical motion-safe:animate-pulse"
            aria-hidden
          />
        )}
        {emphasis === 'warning' && value !== null && value > 0 && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-elevated" aria-hidden />
        )}
      </span>
      <span
        className={cn(
          'mt-0.5 block text-base font-semibold leading-tight tabular-nums',
          valueClass
        )}
      >
        {value ?? '—'}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{context}</span>
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
  scopeMode: _scopeMode,
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

  const isFocused = (patch: Partial<LiveIncidentQuery>) =>
    Object.entries(patch).every(([key, value]) => query[key as keyof LiveIncidentQuery] === value);
  const reset: Partial<LiveIncidentQuery> = { view: 'active', status: 'all', assignment: 'all' };
  const focus = (patch: Partial<LiveIncidentQuery>) =>
    setQuery(isFocused(patch) ? reset : { ...reset, ...patch });
  const lastHour = (count: number | undefined, verb: string) =>
    trend ? (count ? `+${count} ${verb} · last hour` : `None ${verb} · last hour`) : '\u00a0';

  const trendCreated = trend?.created;
  const trendCreatedCritical = trend?.createdCritical;
  const velocitySamples = useMemo(() => {
    if (!trendCreated || trendCreated.length === 0) return null;
    const slices = trendCreated.slice(-6);
    const criticalSlices = trendCreatedCritical ? trendCreatedCritical.slice(-6) : [];
    const max = Math.max(...slices, 1);
    return slices.map((count, i) => {
      const isCritical = (criticalSlices.at(i) ?? 0) > 0;
      return {
        count,
        isCritical,
        heightPct: Math.max(15, Math.round((count / max) * 100)),
      };
    });
  }, [trendCreated, trendCreatedCritical]);

  return (
    <section
      data-testid="command-center"
      aria-label="Command center"
      // Same always-dark band as PageHeader; `dark` keeps `dark:` variants (status pairs) on.
      className="ok-inverse-surface dark rounded-xl border border-border bg-card px-4 py-3.5 text-card-foreground shadow-sm sm:px-5 sm:py-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
            Live Operations
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="dash-hero-title text-foreground">Command Center</h1>
            <div
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-2xs font-mono text-muted-foreground"
              title={`Real-time incident arrival rate: ${trend?.createdLastHour ?? 0} created last hour`}
            >
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pulse
              </span>
              {velocitySamples && velocitySamples.length > 0 && (
                <div className="flex items-end gap-0.5 h-3" aria-hidden>
                  {velocitySamples.map((bar, idx) => (
                    <span
                      key={idx}
                      style={{ height: `${bar.heightPct}%` }}
                      className={cn(
                        'w-1 rounded-xs',
                        bar.isCritical
                          ? 'bg-status-critical'
                          : bar.count > 0
                            ? 'bg-muted-foreground'
                            : 'bg-muted'
                      )}
                      title={`${bar.count} in hour -${6 - idx}`}
                    />
                  ))}
                </div>
              )}
              <span className="tabular-nums font-semibold text-foreground">
                {trend?.createdLastHour ?? 0}/h
              </span>
            </div>
          </div>
          <p
            data-testid="command-insight"
            aria-live="polite"
            className="mt-1.5 text-sm leading-snug text-muted-foreground"
          >
            {narrative.length === 0 ? (
              <span className="text-foreground">
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
                          ? cn(toneClasses('critical').text, 'font-semibold')
                          : fragment.tone === 'amber'
                            ? cn(toneClasses('elevated').text, 'font-semibold')
                            : 'text-foreground font-medium'
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-2.5">
          <span className="hidden sm:inline">
            <LiveClock timeZone={timeZone} variant="plain" />
          </span>
          <div
            role="radiogroup"
            aria-label="Incident scope"
            data-testid="scope-switch"
            className="inline-flex h-8 items-center rounded-md border border-border bg-muted/60 p-0.5 text-xs font-medium"
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
                  'h-full whitespace-nowrap rounded-sm px-2.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                  query.scope === scope
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {SCOPE_LABEL.get(scope)}
                {scope === 'mine' && summary ? (
                  <span className="ml-1 tabular-nums opacity-75">{summary.mine}</span>
                ) : null}
              </button>
            ))}
          </div>
          <Link
            href="/wallboard"
            data-testid="command-wallboard"
            onClick={() => {
              if (isFullscreenSupported()) {
                void enterFullscreen(document.documentElement).catch(() => {});
              }
            }}
            title="Full-screen operations command console for office TVs and NOC screens"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Operations Console</span>
            <span className="sr-only sm:hidden">Operations Console</span>
          </Link>
        </div>
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-6"
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
              <span className={cn(toneClasses('elevated').text, 'font-medium')}>
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
              <span className={cn(toneClasses('critical').text, 'font-medium')}>
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
          variant="secondary"
          groupDivider={true}
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
          variant="secondary"
          active={false}
          onClick={() => router.push('/incidents?filter=resolved')}
        />
      </div>
    </section>
  );
}
