import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Activity, ArrowRight, BarChart3 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
import MobileTime from '@/components/mobile/MobileTime';
import { IncidentStatusBadge, IncidentUrgencyBadge } from '@/components/incident/IncidentSemanticBadge';
import { logger } from '@/lib/logger';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { getResponderAnalyticsSnapshot } from '@/lib/dashboard/responder-analytics-snapshot';

export const dynamic = 'force-dynamic';

type RangeDays = 7 | 30 | 90;

function normalizeRange(value?: string): RangeDays {
  return value === '7' ? 7 : value === '30' ? 30 : 90;
}

function formatDuration(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return '--';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  return `${(rounded / 60).toFixed(1)}h`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
}

function ProgressLine({ value, tone = 'slate' }: { value: number; tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const width = Math.max(0, Math.min(100, value));
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'rose'
          ? 'bg-rose-500'
          : tone === 'blue'
            ? 'bg-blue-500'
            : 'bg-slate-600 dark:bg-slate-300';
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default async function MobileAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m/analytics');

  const params = await searchParams;
  const range = normalizeRange(params?.range);
  const snapshot = await getResponderAnalyticsSnapshot(context.actor, range).catch(error => {
    logger.error('mobile.analytics.snapshotUnavailable', {
      component: 'MobileAnalyticsPage',
      range,
      error,
    });
    return null;
  });

  if (!snapshot) {
    return (
      <div className="responsive-page space-y-4">
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100"
          role="alert"
        >
          <strong>Analytics are temporarily unavailable.</strong>
          <p className="mt-1 text-xs opacity-80">
            Unknown metrics are hidden instead of being presented as zero.
          </p>
        </div>
        <Link href="/m/incidents" className="inline-flex min-h-11 items-center text-sm font-semibold text-foreground">
          View incidents <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const { metrics } = snapshot;
  const dayMs = 24 * 60 * 60 * 1000;
  const effectiveWindowDays = Math.max(
    1,
    Math.ceil((metrics.effectiveEnd.getTime() - metrics.effectiveStart.getTime()) / dayMs)
  );
  const displayRange = metrics.isClipped ? effectiveWindowDays : range;
  const trendSeries = metrics.trendSeries.slice(-7);
  const trendMax = Math.max(1, ...trendSeries.map(point => point.count));
  const topServices = metrics.topServices.slice(0, 5);
  const assigneeLoad = metrics.assigneeLoad.slice(0, 5);
  const recentIncidents = (metrics.recentIncidents || []).slice(0, 6);

  return (
    <div className="responsive-page space-y-5">
      <section className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-0.5" aria-label="Analytics range">
          {([7, 30, 90] as const).map(days => (
            <Link
              key={days}
              href={days === 90 ? '/m/analytics' : `/m/analytics?range=${days}`}
              className={`inline-flex min-h-9 items-center rounded-md px-3 text-[11px] font-semibold transition-colors ${
                range === days
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-current={range === days ? 'page' : undefined}
            >
              {days}d
            </Link>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">
          <MobileTime value={snapshot.generatedAt} format="time" />
          {snapshot.freshness === 'stale' ? ' · refreshing' : ''}
        </span>
      </section>

      {metrics.isClipped && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
          Retention limits this view to the most recent {displayRange} days.
        </div>
      )}

      <section aria-labelledby="analytics-overview-heading" className="space-y-2">
        <h2 id="analytics-overview-heading" className="px-0.5 text-sm font-bold text-foreground">Response overview</h2>
        <Card className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border-border bg-card shadow-none">
          <Link href="/m/incidents?filter=all_open" className="p-3.5 transition-colors hover:bg-accent/40">
            <span className="block text-lg font-bold tabular-nums text-foreground">{metrics.activeIncidents}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">Active now</span>
          </Link>
          <div className="p-3.5">
            <span className="block text-lg font-bold tabular-nums text-foreground">{metrics.totalIncidents}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">New in {displayRange}d</span>
          </div>
          <div className="p-3.5">
            <span className="block text-lg font-bold tabular-nums text-foreground">{formatDuration(metrics.mttd)}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">MTTA</span>
          </div>
          <div className="p-3.5">
            <span className="block text-lg font-bold tabular-nums text-foreground">{formatDuration(metrics.mttr)}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">MTTR</span>
          </div>
        </Card>
      </section>

      <section aria-labelledby="analytics-sla-heading" className="space-y-2">
        <h2 id="analytics-sla-heading" className="px-0.5 text-sm font-bold text-foreground">SLA compliance</h2>
        <Card className="space-y-4 rounded-xl border-border bg-card p-3.5 shadow-none">
          <div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">Acknowledge</span>
              <span className="font-bold tabular-nums text-foreground">{formatPercent(metrics.ackCompliance)}</span>
            </div>
            <ProgressLine value={metrics.ackCompliance ?? 0} tone="blue" />
            <p className="mt-1 text-[10px] text-muted-foreground">{metrics.ackBreaches} breaches</p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">Resolve</span>
              <span className="font-bold tabular-nums text-foreground">{formatPercent(metrics.resolveCompliance)}</span>
            </div>
            <ProgressLine value={metrics.resolveCompliance ?? 0} tone="emerald" />
            <p className="mt-1 text-[10px] text-muted-foreground">{metrics.resolveBreaches} breaches</p>
          </div>
        </Card>
      </section>

      <section aria-labelledby="analytics-trend-heading" className="space-y-2">
        <h2 id="analytics-trend-heading" className="px-0.5 text-sm font-bold text-foreground">Incident trend</h2>
        <Card className="space-y-3 rounded-xl border-border bg-card p-3.5 shadow-none">
          {trendSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No trend data in this period.</p>
          ) : (
            trendSeries.map(point => (
              <div key={point.key}>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-muted-foreground">{point.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{point.count}</span>
                </div>
                <ProgressLine value={(point.count / trendMax) * 100} />
              </div>
            ))
          )}
        </Card>
      </section>

      <section aria-labelledby="analytics-breakdown-heading" className="space-y-2">
        <h2 id="analytics-breakdown-heading" className="px-0.5 text-sm font-bold text-foreground">Breakdown</h2>
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          <details open className="group border-b border-border/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              Urgency
              <span className="text-[10px] font-medium text-muted-foreground">{metrics.totalIncidents} incidents</span>
            </summary>
            <div className="grid grid-cols-3 border-t border-border/70 bg-muted/15">
              {[
                ['High', metrics.highUrgencyCount, 'text-rose-600 dark:text-rose-300'],
                ['Medium', metrics.mediumUrgencyCount, 'text-amber-600 dark:text-amber-300'],
                ['Low', metrics.lowUrgencyCount, 'text-blue-600 dark:text-blue-300'],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="px-2 py-3 text-center">
                  <strong className={`block text-base font-bold tabular-nums ${tone}`}>{String(value)}</strong>
                  <span className="text-[10px] text-muted-foreground">{String(label)}</span>
                </div>
              ))}
            </div>
          </details>

          <details className="group border-b border-border/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              Services
              <span className="text-[10px] font-medium text-muted-foreground">Top {topServices.length}</span>
            </summary>
            <div className="space-y-2 border-t border-border/70 px-3.5 py-3">
              {topServices.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No service data yet.</p>
              ) : (
                topServices.map(service => (
                  <div key={service.id} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="truncate text-muted-foreground">{service.name}</span>
                    <strong className="tabular-nums text-foreground">{service.count}</strong>
                  </div>
                ))
              )}
            </div>
          </details>

          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              Responders
              <span className="text-[10px] font-medium text-muted-foreground">Active load</span>
            </summary>
            <div className="space-y-2 border-t border-border/70 px-3.5 py-3">
              {assigneeLoad.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No assignee data yet.</p>
              ) : (
                assigneeLoad.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="truncate text-muted-foreground">{item.name}</span>
                    <strong className="tabular-nums text-foreground">{item.count}</strong>
                  </div>
                ))
              )}
            </div>
          </details>
        </Card>
      </section>

      <section aria-labelledby="analytics-recent-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="analytics-recent-heading" className="text-sm font-bold text-foreground">Recent incidents</h2>
          <Link href="/m/incidents" className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">View all</Link>
        </div>
        {recentIncidents.length === 0 ? (
          <EmptyState
            icon={<BarChart3 aria-hidden="true" />}
            title="No incidents in this period"
            description="The selected range has no incident activity."
            size="sm"
          />
        ) : (
          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {recentIncidents.map((incident, index) => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className={`block px-3.5 py-3 transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <IncidentStatusBadge status={incident.status} />
                  <IncidentUrgencyBadge urgency={incident.urgency} />
                  <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">{incident.title}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{incident.service.name}</p>
              </Link>
            ))}
          </Card>
        )}
      </section>

      <p className="flex items-center gap-1.5 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
        <Activity className="h-3 w-3 shrink-0" aria-hidden="true" />
        Metrics cover the selected authorized window and respect retention limits.
      </p>
    </div>
  );
}
